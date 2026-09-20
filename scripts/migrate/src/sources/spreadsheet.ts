import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { CsvError, parseCsv } from "../csv";
import {
  DEFAULT_MAPPING_BY_KIND,
  type ImportMapping,
  type MappedRow,
  type MappingKind,
  mapTable,
  parseCivilDate,
  parseDecimal,
  parseInteger,
  parseMoney,
  resolveMapping,
} from "../mapping";
import type {
  BookingRecord,
  LeaseRecord,
  LoanRecord,
  MeterRecord,
  PersonRecord,
  RecordKind,
  Rejection,
  SourceName,
  SourceRead,
  SourceReader,
  SourceRecord,
} from "../model";
import { SourceUnreachable } from "../model";

export type SpreadsheetFile = { kind: MappingKind; path: string; mappingVersion?: string };

const RECORD_KIND_BY_MAPPING: Record<MappingKind, RecordKind> = {
  tenants: "person",
  leases: "lease",
  meters: "meter",
  loans: "loan",
  bookings: "booking",
  balances: "booking",
};

const LEASE_KINDS = new Set([
  "bare",
  "furnished",
  "mobility",
  "parking",
  "commercial",
  "professional",
  "tourist",
  "other",
]);
const LEASE_KIND_LABELS: Record<string, string> = {
  nu: "bare",
  vide: "bare",
  meuble: "furnished",
  mobilite: "mobility",
  parking: "parking",
  garage: "parking",
  commercial: "commercial",
  professionnel: "professional",
  touristique: "tourist",
  autre: "other",
};

const FLUIDS = new Set([
  "water_cold",
  "water_hot",
  "electricity",
  "gas",
  "heat",
  "pv_production",
  "other",
]);
const FLUID_LABELS: Record<string, string> = {
  eau: "water_cold",
  eaufroide: "water_cold",
  eauchaude: "water_hot",
  electricite: "electricity",
  elec: "electricity",
  gaz: "gas",
  chaleur: "heat",
  chauffage: "heat",
  photovoltaique: "pv_production",
  autre: "other",
};
const SCOPES = new Set(["individual", "sub_meter", "collective"]);
const SCOPE_LABELS: Record<string, string> = {
  individuel: "individual",
  divisionnaire: "sub_meter",
  collectif: "collective",
  general: "collective",
};

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function enumValue(
  raw: string,
  allowed: Set<string>,
  labels: Record<string, string>,
): string | null {
  const key = slug(raw);
  if (allowed.has(key)) return key;
  return labels[key] ?? null;
}

class RowRejected extends Error {
  constructor(
    readonly reason: Rejection["reason"],
    message: string,
  ) {
    super(message);
  }
}

type Cells = {
  text(field: string): string | null;
  need(field: string): string;
  date(field: string): string | null;
  money(field: string): string | null;
  decimal(field: string): string | null;
  integer(field: string): number | null;
};

function cellsOf(mapping: ImportMapping, row: MappedRow): Cells {
  const labelOf = (field: string) =>
    mapping.fields.find((spec) => spec.field === field)?.label ?? field;
  const text = (field: string) => row.values.get(field) ?? null;
  return {
    text,
    need(field) {
      const value = text(field);
      if (value === null) throw new RowRejected("missing_field", `${labelOf(field)} manquant`);
      return value;
    },
    date(field) {
      const value = text(field);
      if (value === null) return null;
      const parsed = parseCivilDate(value, mapping.dateOrder);
      if (parsed === null) {
        throw new RowRejected("invalid_date", `${labelOf(field)} illisible : « ${value} »`);
      }
      return parsed;
    },
    money(field) {
      const value = text(field);
      if (value === null) return null;
      const parsed = parseMoney(value, mapping.decimalMark);
      if (parsed === null) {
        throw new RowRejected("invalid_money", `${labelOf(field)} illisible : « ${value} »`);
      }
      return parsed;
    },
    decimal(field) {
      const value = text(field);
      if (value === null) return null;
      const parsed = parseDecimal(value, mapping.decimalMark);
      if (parsed === null) {
        throw new RowRejected("invalid_value", `${labelOf(field)} illisible : « ${value} »`);
      }
      return parsed;
    },
    integer(field) {
      const value = text(field);
      if (value === null) return null;
      const parsed = parseInteger(value);
      if (parsed === null) {
        throw new RowRejected("invalid_value", `${labelOf(field)} illisible : « ${value} »`);
      }
      return parsed;
    },
  };
}

function needMoney(cells: Cells, field: string): string {
  cells.need(field);
  const value = cells.money(field);
  if (value === null) throw new RowRejected("invalid_money", `${field} illisible`);
  return value;
}

function needDate(cells: Cells, field: string): string {
  cells.need(field);
  const value = cells.date(field);
  if (value === null) throw new RowRejected("invalid_date", `${field} illisible`);
  return value;
}

function mapRow(
  source: SourceName,
  mapping: ImportMapping,
  row: MappedRow,
  file: string,
): SourceRecord {
  const cells = cellsOf(mapping, row);
  const line = row.line;
  const ref = `${file}:${line}`;
  switch (mapping.kind) {
    case "tenants": {
      const displayName = cells.need("displayName");
      const record: PersonRecord = {
        source,
        kind: "person",
        ref: cells.text("ref") ?? ref,
        line,
        displayName,
        email: cells.text("email"),
        phone: cells.text("phone"),
        odooPartnerId: cells.integer("odooPartnerId"),
      };
      return record;
    }
    case "leases": {
      const rawKind = cells.text("kind") ?? "bare";
      const leaseKind = enumValue(rawKind, LEASE_KINDS, LEASE_KIND_LABELS);
      if (leaseKind === null) {
        throw new RowRejected("invalid_value", `Type de bail inconnu : « ${rawKind} »`);
      }
      const startsOn = needDate(cells, "startsOn");
      const endsOn = cells.date("endsOn");
      if (endsOn !== null && endsOn < startsOn) {
        throw new RowRejected("invalid_date", `Fin ${endsOn} avant début ${startsOn}`);
      }
      const paymentDay = cells.integer("paymentDay");
      if (paymentDay !== null && (paymentDay < 1 || paymentDay > 31)) {
        throw new RowRejected("invalid_value", `Jour de paiement hors 1–31 : ${paymentDay}`);
      }
      const record: LeaseRecord = {
        source,
        kind: "lease",
        ref: cells.need("reference"),
        line,
        entity: cells.need("entity"),
        reference: cells.need("reference"),
        tenantName: cells.need("tenantName"),
        unitCode: cells.text("unitCode"),
        leaseKind,
        startsOn,
        endsOn,
        rent: needMoney(cells, "rent"),
        charges: cells.money("charges") ?? "0.00",
        deposit: cells.money("deposit"),
        paymentDay,
      };
      return record;
    }
    case "meters": {
      const rawFluid = cells.need("fluid");
      const fluid = enumValue(rawFluid, FLUIDS, FLUID_LABELS);
      if (fluid === null)
        throw new RowRejected("invalid_value", `Fluide inconnu : « ${rawFluid} »`);
      const rawScope = cells.text("scope") ?? "individual";
      const scope = enumValue(rawScope, SCOPES, SCOPE_LABELS);
      if (scope === null)
        throw new RowRejected("invalid_value", `Portée inconnue : « ${rawScope} »`);
      const lastIndex = cells.decimal("lastIndex");
      const lastReadOn = cells.date("lastReadOn");
      if ((lastIndex === null) !== (lastReadOn === null)) {
        throw new RowRejected(
          "missing_field",
          "Un relevé porte un index et une date, jamais l’un sans l’autre",
        );
      }
      const record: MeterRecord = {
        source,
        kind: "meter",
        ref: cells.need("serialNumber"),
        line,
        entity: cells.need("entity"),
        buildingCode: cells.need("buildingCode"),
        fluid,
        scope,
        unitOfMeasure: cells.text("unitOfMeasure") ?? (fluid === "electricity" ? "kWh" : "m3"),
        serialNumber: cells.need("serialNumber"),
        prm: cells.text("prm"),
        pce: cells.text("pce"),
        lastIndex,
        lastReadOn,
      };
      return record;
    }
    case "loans": {
      const outstanding = cells.money("outstanding");
      const outstandingOn = cells.date("outstandingOn");
      if ((outstanding === null) !== (outstandingOn === null)) {
        throw new RowRejected("missing_field", "Un capital restant dû porte une date");
      }
      const record: LoanRecord = {
        source,
        kind: "loan",
        ref: cells.need("reference"),
        line,
        entity: cells.need("entity"),
        reference: cells.need("reference"),
        lender: cells.need("lender"),
        principal: needMoney(cells, "principal"),
        releasedOn: cells.date("releasedOn"),
        durationMonths: cells.integer("durationMonths"),
        nominalRate: cells.decimal("nominalRate"),
        outstanding,
        outstandingOn,
      };
      return record;
    }
    case "bookings": {
      const checkInOn = needDate(cells, "checkInOn");
      const checkOutOn = needDate(cells, "checkOutOn");
      if (checkOutOn <= checkInOn) {
        throw new RowRejected(
          "invalid_date",
          `Départ ${checkOutOn} au plus tard à l’arrivée ${checkInOn}`,
        );
      }
      const record: BookingRecord = {
        source,
        kind: "booking",
        ref: cells.need("externalBookingId"),
        line,
        externalBookingId: cells.need("externalBookingId"),
        listingExternalId: cells.text("listingExternalId"),
        checkInOn,
        checkOutOn,
        guestName: cells.text("guestName"),
        accommodationAmount: needMoney(cells, "accommodationAmount"),
        payoutNetAmount: cells.money("payoutNetAmount"),
      };
      return record;
    }
    case "balances":
      throw new RowRejected("unsupported", "Les soldes se lisent avec la commande balances");
  }
}

export async function readCsvFile(path: string, source: SourceName): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceUnreachable(source, `Fichier illisible : ${path} — ${message}`, {
      cause: error,
    });
  }
}

export type MappedFile = {
  file: SpreadsheetFile;
  mapping: ImportMapping;
  found: number;
  records: SourceRecord[];
  rejections: Rejection[];
  notes: string[];
};

export async function readMappedFile(
  file: SpreadsheetFile,
  source: SourceName,
): Promise<MappedFile> {
  const mapping = resolveMapping(file.mappingVersion ?? DEFAULT_MAPPING_BY_KIND[file.kind]);
  if (mapping.kind !== file.kind) {
    throw new SourceUnreachable(
      source,
      `Le mapping ${mapping.version} décrit des ${mapping.kind}, pas des ${file.kind}`,
    );
  }
  const text = await readCsvFile(file.path, source);
  let table: ReturnType<typeof parseCsv>;
  try {
    table = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvError) {
      throw new SourceUnreachable(source, `${file.path} : ${error.message}`, { cause: error });
    }
    throw error;
  }
  const mapped = mapTable(mapping, table);
  if (mapped.missingColumns.length > 0) {
    throw new SourceUnreachable(
      source,
      `${file.path} : colonnes obligatoires absentes pour ${mapping.version} — ${mapped.missingColumns.join(", ")}`,
    );
  }
  const kind = RECORD_KIND_BY_MAPPING[file.kind];
  const records: SourceRecord[] = [];
  const rejections: Rejection[] = [];
  const seen = new Map<string, number>();
  for (const row of mapped.rows) {
    try {
      const record = mapRow(source, mapping, row, file.path);
      const previous = seen.get(`${record.kind}:${record.ref}`);
      if (previous !== undefined) {
        throw new RowRejected("duplicate_reference", `${record.ref} déjà lu ligne ${previous}`);
      }
      seen.set(`${record.kind}:${record.ref}`, row.line);
      records.push(record);
    } catch (error) {
      if (!(error instanceof RowRejected)) throw error;
      rejections.push({
        source,
        kind,
        ref: `${file.path}:${row.line}`,
        line: row.line,
        reason: error.reason,
        detail: error.message,
      });
    }
  }
  const notes = [
    `${file.path} : ${mapping.version}, ${mapped.rows.length} lignes, colonnes reconnues ${mapped.mappedColumns.map((column) => column.header).join(", ")}`,
  ];
  if (mapped.unknownColumns.length > 0) {
    notes.push(`${file.path} : colonnes ignorées ${mapped.unknownColumns.join(", ")}`);
  }
  return { file, mapping, found: mapped.rows.length, records, rejections, notes };
}

function coverageOf(records: SourceRecord[]): { from: string | null; to: string | null } {
  const dates: string[] = [];
  for (const record of records) {
    if (record.kind === "lease") dates.push(record.startsOn);
    if (record.kind === "loan" && record.releasedOn) dates.push(record.releasedOn);
    if (record.kind === "meter" && record.lastReadOn) dates.push(record.lastReadOn);
    if (record.kind === "booking") dates.push(record.checkInOn);
  }
  dates.sort();
  return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
}

export function createSpreadsheetSource(
  files: SpreadsheetFile[],
  options: { name?: SourceName; label?: string; now?: () => Date } = {},
): SourceReader {
  const name = options.name ?? "spreadsheet";
  const now = options.now ?? (() => new Date());
  return {
    name,
    async read(): Promise<SourceRead> {
      const readAt = now().toISOString();
      if (files.length === 0) throw new SourceUnreachable(name, "Aucun fichier fourni");
      const read: SourceRead = {
        source: name,
        label: options.label ?? `Tableaux ${files.map((file) => basename(file.path)).join(", ")}`,
        found: 0,
        records: [],
        rejections: [],
        notes: [],
        coverage: { from: null, to: null },
        readAt,
      };
      for (const file of files) {
        const mapped = await readMappedFile(file, name);
        read.found += mapped.found;
        read.records.push(...mapped.records);
        read.rejections.push(...mapped.rejections);
        read.notes.push(...mapped.notes);
      }
      read.coverage = coverageOf(read.records);
      return read;
    },
  };
}

export function createPlatformSource(path: string, mappingVersion?: string): SourceReader {
  const file: SpreadsheetFile = mappingVersion
    ? { kind: "bookings", path, mappingVersion }
    : { kind: "bookings", path };
  return createSpreadsheetSource([file], {
    name: "platform",
    label: `Export plateforme ${basename(path)}`,
  });
}

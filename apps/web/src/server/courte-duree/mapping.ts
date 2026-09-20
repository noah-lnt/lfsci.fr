import "server-only";
import type { ListingPlatform } from "@lfsci/contracts";
import { decimal, toMoney } from "@lfsci/domain";
import { AppError } from "@lfsci/kernel";
import type { ImportKind, MappingDescriptor } from "@/lib/contracts/courte-duree";
import { type CsvTable, cellsByHeader, normaliseHeader } from "./csv";

export type FieldKind = "text" | "date" | "money" | "integer";

export type FieldSpec = {
  field: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  headers: string[];
};

/**
 * AIR-02: a mapping is a named version. Column order is never read, and the
 * date order and decimal mark belong to the version rather than to a guess.
 */
export type ImportMapping = {
  version: string;
  kind: ImportKind;
  platform: ListingPlatform;
  label: string;
  dateOrder: "dmy" | "mdy" | "ymd";
  decimalMark: "comma" | "point";
  fields: FieldSpec[];
};

const BOOKING_FIELDS: FieldSpec[] = [
  {
    field: "externalBookingId",
    label: "Code de confirmation",
    kind: "text",
    required: true,
    headers: [
      "Code de confirmation",
      "Confirmation code",
      "Référence de réservation",
      "Reservation id",
    ],
  },
  {
    field: "listingExternalId",
    label: "Annonce",
    kind: "text",
    required: false,
    headers: ["Annonce", "Listing", "Identifiant de l’annonce", "Listing id"],
  },
  {
    field: "checkInOn",
    label: "Arrivée",
    kind: "date",
    required: true,
    headers: ["Arrivée", "Date d’arrivée", "Start date", "Check-in"],
  },
  {
    field: "checkOutOn",
    label: "Départ",
    kind: "date",
    required: true,
    headers: ["Départ", "Date de départ", "End date", "Checkout", "Check-out"],
  },
  {
    field: "guestName",
    label: "Voyageur",
    kind: "text",
    required: false,
    headers: ["Voyageur", "Guest name", "Nom du voyageur"],
  },
  {
    field: "guestCount",
    label: "Nombre de voyageurs",
    kind: "integer",
    required: false,
    headers: ["Nombre de voyageurs", "Voyageurs", "# of guests", "Guests"],
  },
  {
    field: "accommodationAmount",
    label: "Hébergement",
    kind: "money",
    required: true,
    headers: ["Hébergement", "Montant du séjour", "Nightly rate total", "Gross earnings"],
  },
  {
    field: "cleaningAmount",
    label: "Frais de ménage",
    kind: "money",
    required: false,
    headers: ["Frais de ménage", "Cleaning fee", "Ménage"],
  },
  {
    field: "commissionAmount",
    label: "Frais de service",
    kind: "money",
    required: false,
    headers: ["Frais de service", "Commission", "Host service fee", "Service fee"],
  },
  {
    field: "refundAmount",
    label: "Remboursement",
    kind: "money",
    required: false,
    headers: ["Remboursement", "Refund", "Remboursements"],
  },
  {
    field: "touristTaxCollected",
    label: "Taxe de séjour collectée",
    kind: "money",
    required: false,
    headers: ["Taxe de séjour collectée", "Taxe de séjour", "Occupancy taxes"],
  },
  {
    field: "touristTaxRemitted",
    label: "Taxe de séjour reversée",
    kind: "money",
    required: false,
    headers: ["Taxe de séjour reversée", "Occupancy taxes remitted"],
  },
  {
    field: "depositAmount",
    label: "Dépôt",
    kind: "money",
    required: false,
    headers: ["Dépôt", "Dépôt de garantie", "Security deposit"],
  },
  {
    field: "currency",
    label: "Devise",
    kind: "text",
    required: false,
    headers: ["Devise", "Currency"],
  },
  {
    field: "payoutReference",
    label: "Versement",
    kind: "text",
    required: false,
    headers: ["Versement", "Référence du versement", "Payout", "Payout id"],
  },
  {
    field: "payoutPaidOn",
    label: "Date de versement",
    kind: "date",
    required: false,
    headers: ["Date de versement", "Payout date"],
  },
  {
    field: "payoutNetAmount",
    label: "Montant versé",
    kind: "money",
    required: false,
    headers: ["Montant versé", "Montant net du versement", "Payout amount", "Net payout"],
  },
];

const PAYOUT_FIELDS: FieldSpec[] = [
  {
    field: "externalPayoutId",
    label: "Référence du versement",
    kind: "text",
    required: true,
    headers: ["Référence du versement", "Versement", "Payout id", "Payout reference"],
  },
  {
    field: "paidOn",
    label: "Date de versement",
    kind: "date",
    required: true,
    headers: ["Date de versement", "Payout date", "Date"],
  },
  {
    field: "netAmount",
    label: "Montant versé",
    kind: "money",
    required: true,
    headers: ["Montant versé", "Montant net", "Payout amount", "Net amount"],
  },
  {
    field: "bookingReference",
    label: "Code de confirmation",
    kind: "text",
    required: false,
    headers: ["Code de confirmation", "Confirmation code", "Réservation"],
  },
  {
    field: "lineAmount",
    label: "Montant de la ligne",
    kind: "money",
    required: false,
    headers: ["Montant de la ligne", "Montant", "Amount", "Line amount"],
  },
  {
    field: "lineKind",
    label: "Nature",
    kind: "text",
    required: false,
    headers: ["Nature", "Type", "Type de ligne", "Kind"],
  },
  {
    field: "label",
    label: "Libellé",
    kind: "text",
    required: false,
    headers: ["Libellé", "Description", "Details"],
  },
  {
    field: "currency",
    label: "Devise",
    kind: "text",
    required: false,
    headers: ["Devise", "Currency"],
  },
];

export const IMPORT_MAPPINGS: ImportMapping[] = [
  {
    version: "airbnb-reservations-fr-v1",
    kind: "bookings",
    platform: "airbnb",
    label: "Airbnb — réservations (export français)",
    dateOrder: "dmy",
    decimalMark: "comma",
    fields: BOOKING_FIELDS,
  },
  {
    version: "airbnb-reservations-en-v1",
    kind: "bookings",
    platform: "airbnb",
    label: "Airbnb — reservations (English export)",
    dateOrder: "mdy",
    decimalMark: "point",
    fields: BOOKING_FIELDS,
  },
  {
    version: "generic-reservations-iso-v1",
    kind: "bookings",
    platform: "other",
    label: "Générique — réservations, dates ISO",
    dateOrder: "ymd",
    decimalMark: "point",
    fields: BOOKING_FIELDS,
  },
  {
    version: "airbnb-payouts-fr-v1",
    kind: "payouts",
    platform: "airbnb",
    label: "Airbnb — versements (export français)",
    dateOrder: "dmy",
    decimalMark: "comma",
    fields: PAYOUT_FIELDS,
  },
  {
    version: "generic-payouts-iso-v1",
    kind: "payouts",
    platform: "other",
    label: "Générique — versements, dates ISO",
    dateOrder: "ymd",
    decimalMark: "point",
    fields: PAYOUT_FIELDS,
  },
];

export function resolveMapping(version: string): ImportMapping {
  const mapping = IMPORT_MAPPINGS.find((candidate) => candidate.version === version);
  if (!mapping) {
    throw new AppError("VALIDATION", {
      message: "Version de mapping inconnue.",
      details: { version },
    });
  }
  return mapping;
}

export function describeMapping(mapping: ImportMapping): MappingDescriptor {
  return {
    version: mapping.version,
    kind: mapping.kind,
    platform: mapping.platform,
    label: mapping.label,
    columns: mapping.fields.map((field) => ({
      field: field.field,
      label: field.label,
      required: field.required,
      headers: field.headers,
    })),
  };
}

export type MappedRow = {
  line: number;
  values: Map<string, string>;
};

export type MappedTable = {
  mapping: ImportMapping;
  rows: MappedRow[];
  mappedColumns: { field: string; header: string }[];
  missingColumns: string[];
  unknownColumns: string[];
};

export function mapTable(mapping: ImportMapping, table: CsvTable): MappedTable {
  const headerByKey = new Map<string, string>();
  for (const header of table.headers) {
    const key = normaliseHeader(header);
    if (key !== "" && !headerByKey.has(key)) headerByKey.set(key, header);
  }

  const mappedColumns: { field: string; header: string }[] = [];
  const missingColumns: string[] = [];
  const claimed = new Set<string>();
  const fieldToKey = new Map<string, string>();

  for (const field of mapping.fields) {
    const match = field.headers
      .map((candidate) => normaliseHeader(candidate))
      .find((key) => headerByKey.has(key) && !claimed.has(key));
    if (match === undefined) {
      if (field.required) missingColumns.push(field.label);
      continue;
    }
    claimed.add(match);
    fieldToKey.set(field.field, match);
    mappedColumns.push({ field: field.field, header: headerByKey.get(match) ?? match });
  }

  const unknownColumns = table.headers.filter(
    (header) => normaliseHeader(header) !== "" && !claimed.has(normaliseHeader(header)),
  );

  const rows = table.records.map((record) => {
    const byName = cellsByHeader(table, record);
    const values = new Map<string, string>();
    for (const [field, key] of fieldToKey) {
      const raw = byName.get(key);
      if (raw !== undefined && raw !== "") values.set(field, raw);
    }
    return { line: record.line, values };
  });

  return { mapping, rows, mappedColumns, missingColumns, unknownColumns };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASHED = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})$/;

export function parseCivilDate(raw: string, order: ImportMapping["dateOrder"]): string | null {
  const value = raw.trim();
  const iso = ISO_DATE.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parts = SLASHED.exec(value);
  if (!parts) return null;
  const [, a, b, c] = parts;
  if (a === undefined || b === undefined || c === undefined) return null;
  const [year, month, day] = order === "ymd" ? [a, b, c] : order === "mdy" ? [c, a, b] : [c, b, a];
  const yearNumber = year.length === 2 ? 2000 + Number(year) : Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
  const padded = `${String(yearNumber).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
  const parsed = new Date(`${padded}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : padded;
}

const CLEAN_MONEY = /[\s  €$£]/g;

export function parseMoney(raw: string, mark: ImportMapping["decimalMark"]): string | null {
  let value = raw.trim().replace(CLEAN_MONEY, "");
  if (value === "") return null;
  let negative = false;
  if (value.startsWith("(") && value.endsWith(")")) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  }
  if (value.startsWith("+")) value = value.slice(1);
  value = mark === "comma" ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const amount = toMoney(decimal(value));
  return negative && amount !== "0.00" ? `-${amount}` : amount;
}

export function parseInteger(raw: string): number | null {
  const value = raw.trim().replace(/[\s ]/g, "");
  if (!/^\d{1,6}$/.test(value)) return null;
  return Number(value);
}

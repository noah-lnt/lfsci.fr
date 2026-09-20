import { decimal, toMoney } from "@lfsci/domain";
import { type CsvTable, cellsByHeader, normaliseHeader } from "./csv";

export type FieldKind = "text" | "date" | "money" | "integer" | "decimal";

export type FieldSpec = {
  field: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  headers: string[];
};

export type MappingKind = "tenants" | "leases" | "meters" | "loans" | "bookings" | "balances";

/**
 * A mapping is a named version, as in apps/web/src/server/courte-duree/mapping.ts:
 * column order is never read, the date order and decimal mark belong to the version.
 */
export type ImportMapping = {
  version: string;
  kind: MappingKind;
  label: string;
  dateOrder: "dmy" | "mdy" | "ymd";
  decimalMark: "comma" | "point";
  fields: FieldSpec[];
};

const TENANT_FIELDS: FieldSpec[] = [
  {
    field: "ref",
    label: "Référence",
    kind: "text",
    required: false,
    headers: ["Référence", "Ref", "Code"],
  },
  {
    field: "displayName",
    label: "Nom",
    kind: "text",
    required: true,
    headers: ["Nom", "Nom complet", "Locataire", "Name"],
  },
  {
    field: "email",
    label: "Email",
    kind: "text",
    required: false,
    headers: ["Email", "E-mail", "Courriel"],
  },
  {
    field: "phone",
    label: "Téléphone",
    kind: "text",
    required: false,
    headers: ["Téléphone", "Tel", "Mobile", "Phone"],
  },
  {
    field: "odooPartnerId",
    label: "Id partenaire Odoo",
    kind: "integer",
    required: false,
    headers: ["Id Odoo", "Odoo partner id", "Partenaire Odoo"],
  },
];

const LEASE_FIELDS: FieldSpec[] = [
  {
    field: "entity",
    label: "Société",
    kind: "text",
    required: true,
    headers: ["Société", "SCI", "Entité", "Company"],
  },
  {
    field: "reference",
    label: "Référence du bail",
    kind: "text",
    required: true,
    headers: ["Référence du bail", "Référence", "Bail", "Ref bail", "Lease"],
  },
  {
    field: "tenantName",
    label: "Locataire",
    kind: "text",
    required: true,
    headers: ["Locataire", "Nom du locataire", "Tenant"],
  },
  {
    field: "unitCode",
    label: "Lot",
    kind: "text",
    required: false,
    headers: ["Lot", "Code du lot", "Unit"],
  },
  {
    field: "kind",
    label: "Type de bail",
    kind: "text",
    required: false,
    headers: ["Type de bail", "Type", "Nature"],
  },
  {
    field: "startsOn",
    label: "Début",
    kind: "date",
    required: true,
    headers: ["Début", "Date de début", "Date d’effet", "Start"],
  },
  {
    field: "endsOn",
    label: "Fin",
    kind: "date",
    required: false,
    headers: ["Fin", "Date de fin", "End"],
  },
  {
    field: "rent",
    label: "Loyer hors charges",
    kind: "money",
    required: true,
    headers: ["Loyer hors charges", "Loyer HC", "Loyer", "Rent"],
  },
  {
    field: "charges",
    label: "Provision de charges",
    kind: "money",
    required: false,
    headers: ["Provision de charges", "Charges", "Provisions"],
  },
  {
    field: "deposit",
    label: "Dépôt de garantie",
    kind: "money",
    required: false,
    headers: ["Dépôt de garantie", "Dépôt", "Deposit"],
  },
  {
    field: "paymentDay",
    label: "Jour de paiement",
    kind: "integer",
    required: false,
    headers: ["Jour de paiement", "Jour", "Payment day"],
  },
];

const METER_FIELDS: FieldSpec[] = [
  {
    field: "entity",
    label: "Société",
    kind: "text",
    required: true,
    headers: ["Société", "SCI", "Entité"],
  },
  {
    field: "buildingCode",
    label: "Immeuble",
    kind: "text",
    required: true,
    headers: ["Immeuble", "Code immeuble", "Building"],
  },
  {
    field: "fluid",
    label: "Fluide",
    kind: "text",
    required: true,
    headers: ["Fluide", "Énergie", "Type"],
  },
  { field: "scope", label: "Portée", kind: "text", required: false, headers: ["Portée", "Scope"] },
  {
    field: "unitOfMeasure",
    label: "Unité",
    kind: "text",
    required: false,
    headers: ["Unité", "Unit"],
  },
  {
    field: "serialNumber",
    label: "Numéro de série",
    kind: "text",
    required: true,
    headers: ["Numéro de série", "N° série", "Compteur", "Serial"],
  },
  {
    field: "prm",
    label: "PRM / PDL",
    kind: "text",
    required: false,
    headers: ["PRM", "PDL", "PRM / PDL"],
  },
  { field: "pce", label: "PCE", kind: "text", required: false, headers: ["PCE"] },
  {
    field: "lastIndex",
    label: "Dernier index",
    kind: "decimal",
    required: false,
    headers: ["Dernier index", "Index", "Relevé"],
  },
  {
    field: "lastReadOn",
    label: "Date du relevé",
    kind: "date",
    required: false,
    headers: ["Date du relevé", "Date relevé", "Relevé le"],
  },
];

const LOAN_FIELDS: FieldSpec[] = [
  {
    field: "entity",
    label: "Société",
    kind: "text",
    required: true,
    headers: ["Société", "SCI", "Entité"],
  },
  {
    field: "reference",
    label: "Référence du prêt",
    kind: "text",
    required: true,
    headers: ["Référence du prêt", "Référence", "N° prêt", "Loan"],
  },
  {
    field: "lender",
    label: "Prêteur",
    kind: "text",
    required: true,
    headers: ["Prêteur", "Banque", "Lender"],
  },
  {
    field: "principal",
    label: "Capital emprunté",
    kind: "money",
    required: true,
    headers: ["Capital emprunté", "Capital", "Montant", "Principal"],
  },
  {
    field: "releasedOn",
    label: "Date de déblocage",
    kind: "date",
    required: false,
    headers: ["Date de déblocage", "Déblocage", "Début"],
  },
  {
    field: "durationMonths",
    label: "Durée (mois)",
    kind: "integer",
    required: false,
    headers: ["Durée (mois)", "Durée", "Mois"],
  },
  {
    field: "nominalRate",
    label: "Taux nominal",
    kind: "decimal",
    required: false,
    headers: ["Taux nominal", "Taux", "Rate"],
  },
  {
    field: "outstanding",
    label: "Capital restant dû",
    kind: "money",
    required: false,
    headers: ["Capital restant dû", "CRD", "Restant dû"],
  },
  {
    field: "outstandingOn",
    label: "CRD au",
    kind: "date",
    required: false,
    headers: ["CRD au", "Date CRD", "Restant dû au"],
  },
];

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
    field: "accommodationAmount",
    label: "Hébergement",
    kind: "money",
    required: true,
    headers: ["Hébergement", "Montant du séjour", "Nightly rate total", "Gross earnings"],
  },
  {
    field: "payoutNetAmount",
    label: "Montant versé",
    kind: "money",
    required: false,
    headers: ["Montant versé", "Montant net du versement", "Payout amount", "Net payout"],
  },
];

const BALANCE_FIELDS: FieldSpec[] = [
  {
    field: "entity",
    label: "Société",
    kind: "text",
    required: true,
    headers: ["Société", "SCI", "Entité", "Company"],
  },
  {
    field: "kind",
    label: "Nature",
    kind: "text",
    required: true,
    headers: ["Nature", "Type", "Kind"],
  },
  {
    field: "reference",
    label: "Référence",
    kind: "text",
    required: false,
    headers: ["Référence", "Tiers", "Compte", "Reference"],
  },
  {
    field: "amount",
    label: "Solde",
    kind: "money",
    required: true,
    headers: ["Solde", "Montant", "Balance", "Amount"],
  },
];

export const IMPORT_MAPPINGS: ImportMapping[] = [
  {
    version: "tenants-fr-v1",
    kind: "tenants",
    label: "Locataires — tableau du propriétaire",
    dateOrder: "dmy",
    decimalMark: "comma",
    fields: TENANT_FIELDS,
  },
  {
    version: "leases-fr-v1",
    kind: "leases",
    label: "Baux — tableau du propriétaire",
    dateOrder: "dmy",
    decimalMark: "comma",
    fields: LEASE_FIELDS,
  },
  {
    version: "meters-fr-v1",
    kind: "meters",
    label: "Compteurs — tableau du propriétaire",
    dateOrder: "dmy",
    decimalMark: "comma",
    fields: METER_FIELDS,
  },
  {
    version: "loans-fr-v1",
    kind: "loans",
    label: "Prêts — tableau du propriétaire",
    dateOrder: "dmy",
    decimalMark: "comma",
    fields: LOAN_FIELDS,
  },
  {
    version: "airbnb-reservations-fr-v1",
    kind: "bookings",
    label: "Airbnb — réservations (export français)",
    dateOrder: "dmy",
    decimalMark: "comma",
    fields: BOOKING_FIELDS,
  },
  {
    version: "airbnb-reservations-en-v1",
    kind: "bookings",
    label: "Airbnb — reservations (English export)",
    dateOrder: "mdy",
    decimalMark: "point",
    fields: BOOKING_FIELDS,
  },
  {
    version: "balances-fr-v1",
    kind: "balances",
    label: "Soldes — export de l’expert-comptable",
    dateOrder: "dmy",
    decimalMark: "comma",
    fields: BALANCE_FIELDS,
  },
];

export const DEFAULT_MAPPING_BY_KIND: Record<MappingKind, string> = {
  tenants: "tenants-fr-v1",
  leases: "leases-fr-v1",
  meters: "meters-fr-v1",
  loans: "loans-fr-v1",
  bookings: "airbnb-reservations-fr-v1",
  balances: "balances-fr-v1",
};

export function resolveMapping(version: string): ImportMapping {
  const mapping = IMPORT_MAPPINGS.find((candidate) => candidate.version === version);
  if (!mapping) throw new Error(`Version de mapping inconnue : ${version}`);
  return mapping;
}

export type MappedRow = { line: number; values: Map<string, string> };

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
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getUTCMonth() + 1 === monthNumber && parsed.getUTCDate() === dayNumber
    ? padded
    : null;
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

export function parseDecimal(raw: string, mark: ImportMapping["decimalMark"]): string | null {
  let value = raw.trim().replace(/[\s  %]/g, "");
  if (value === "") return null;
  value = mark === "comma" ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  return decimal(value).toString();
}

export function parseInteger(raw: string): number | null {
  const value = raw.trim().replace(/[\s ]/g, "");
  if (!/^\d{1,6}$/.test(value)) return null;
  return Number(value);
}

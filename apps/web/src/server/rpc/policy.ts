/**
 * SEC-01: who may call what. One table, applied once at the router root, so a
 * procedure nobody thought about is closed rather than open. Reads are the
 * procedures whose contract route is GET; everything else is a write.
 */

export const ROLES = ["owner_admin", "delegated_manager", "accountant", "partner_reader"] as const;
export type Role = (typeof ROLES)[number];

export type CallDescription = {
  path: readonly string[];
  method: string;
  role: string | null;
  session: boolean;
};

type Rule = {
  match: (path: string) => boolean;
  read: readonly string[] | "anyone" | "session";
  write: readonly string[] | "anyone" | "session";
};

const OWNER = ["owner_admin"] as const;
const OPERATORS = ["owner_admin", "delegated_manager"] as const;
const READERS = ["owner_admin", "delegated_manager", "accountant"] as const;
const EVERY_MEMBER = ROLES;

const prefix = (value: string) => (path: string) => path === value || path.startsWith(`${value}.`);
const exact = (value: string) => (path: string) => path === value;

/** First match wins; the last rule is the default. */
const RULES: readonly Rule[] = [
  { match: prefix("health"), read: "anyone", write: "anyone" },
  { match: prefix("me"), read: "session", write: "session" },
  { match: prefix("parametres"), read: "session", write: "session" },
  { match: prefix("ops"), read: OWNER, write: OWNER },
  { match: exact("commands.approvals.decide"), read: OWNER, write: OWNER },
  { match: exact("commands.submit"), read: OPERATORS, write: OPERATORS },
  // Spec §3: a delegated manager has no implicit access to the partners' accounts.
  { match: prefix("finance.cca"), read: ["owner_admin", "accountant"], write: OWNER },
  // Shared indicators are what a partner reader is entitled to; the action list names tenants.
  { match: exact("accueil.situation"), read: EVERY_MEMBER, write: EVERY_MEMBER },
  { match: prefix("assistant"), read: OPERATORS, write: OPERATORS },
  { match: () => true, read: READERS, write: OPERATORS },
];

function permits(allowed: Rule["read"], call: CallDescription): boolean {
  if (allowed === "anyone") return true;
  if (allowed === "session") return call.session;
  return call.role !== null && allowed.includes(call.role);
}

export function isAllowed(call: CallDescription): boolean {
  const joined = call.path.join(".");
  const rule = RULES.find((candidate) => candidate.match(joined));
  if (!rule) return false;
  const allowed = call.method.toUpperCase() === "GET" ? rule.read : rule.write;
  return permits(allowed, call);
}

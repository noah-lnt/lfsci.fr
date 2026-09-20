import { AppError, redactValue } from "@lfsci/kernel";

export type OdooFault = {
  name?: string;
  message?: string;
  arguments?: unknown[];
  context?: unknown;
  debug?: string;
};

export type CallContext = {
  model: string;
  method: string;
  idempotent: boolean;
};

export type MappedFailure = {
  error: AppError;
  transport: boolean;
};

const businessFaultNames = [
  "odoo.exceptions.UserError",
  "odoo.exceptions.AccessError",
  "odoo.exceptions.ValidationError",
  "odoo.exceptions.MissingError",
  "odoo.exceptions.RedirectWarning",
];

const lockDatePatterns = [
  /lock\s*date/i,
  /locked\s*period/i,
  /prior to and inclusive of/i,
  /date de verrouillage/i,
  /période\s+(close|verrouillée)/i,
  /verrouill/i,
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFault(body: unknown): OdooFault {
  if (!isRecord(body)) return {};
  const fault: OdooFault = {};
  if (typeof body.name === "string") fault.name = body.name;
  if (typeof body.message === "string") fault.message = body.message;
  if (Array.isArray(body.arguments)) fault.arguments = body.arguments;
  if (body.context !== undefined) fault.context = body.context;
  if (typeof body.debug === "string") fault.debug = body.debug;
  return fault;
}

export function faultText(fault: OdooFault): string {
  const parts = [fault.message ?? ""];
  for (const argument of fault.arguments ?? []) {
    if (typeof argument === "string") parts.push(argument);
  }
  return parts.join(" ");
}

export function isPeriodLocked(fault: OdooFault): boolean {
  const text = faultText(fault);
  return lockDatePatterns.some((pattern) => pattern.test(text));
}

function baseDetails(context: CallContext, fault: OdooFault, status: number | null) {
  const details: Record<string, unknown> = {
    model: context.model,
    method: context.method,
    odoo: redactValue(fault),
  };
  if (status !== null) details.status = status;
  if (fault.name !== undefined) details.name = fault.name;
  return details;
}

export function mapHttpFailure(status: number, body: unknown, context: CallContext): MappedFailure {
  const fault = parseFault(body);
  const details = baseDetails(context, fault, status);

  if (status === 429) {
    return { error: new AppError("QUOTA_EXCEEDED", { details }), transport: false };
  }
  if (status >= 500) {
    return { error: new AppError("UPSTREAM_UNAVAILABLE", { details }), transport: true };
  }
  if (status === 401 || status === 403) {
    return { error: new AppError("UPSTREAM_REJECTED", { details }), transport: false };
  }
  if (isPeriodLocked(fault)) {
    return { error: new AppError("PERIOD_LOCKED", { details }), transport: false };
  }
  if (fault.name !== undefined && businessFaultNames.includes(fault.name)) {
    return { error: new AppError("UPSTREAM_REJECTED", { details }), transport: false };
  }
  return { error: new AppError("UPSTREAM_REJECTED", { details }), transport: false };
}

export function mapNetworkFailure(cause: unknown, context: CallContext): MappedFailure {
  const details = baseDetails(context, {}, null);
  details.reason = "network";
  return {
    error: new AppError("UPSTREAM_UNAVAILABLE", { details, cause }),
    transport: true,
  };
}

export function mapTimeoutFailure(cause: unknown, context: CallContext): MappedFailure {
  const details = baseDetails(context, {}, null);
  details.reason = "timeout";
  if (context.idempotent) {
    return { error: new AppError("UPSTREAM_UNAVAILABLE", { details, cause }), transport: true };
  }
  return { error: new AppError("RESULT_UNKNOWN", { details, cause }), transport: false };
}

export function mapUnreadableBody(
  status: number,
  text: string,
  context: CallContext,
): MappedFailure {
  const details = baseDetails(context, {}, status);
  details.reason = "unreadable_body";
  details.bodyPreview = text.slice(0, 500);
  return { error: new AppError("UPSTREAM_REJECTED", { details }), transport: false };
}

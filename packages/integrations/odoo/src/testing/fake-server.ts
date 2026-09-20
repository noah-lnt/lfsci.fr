import type { Clock } from "../clock";

export type FakeRecord = Record<string, unknown> & { id: number };

export type FakeCall = {
  model: string;
  method: string;
  kwargs: Record<string, unknown>;
  headers: Record<string, string>;
  at: number;
  /** Set on the /jsonrpc route: the raw execute_kw envelope, api key blanked. */
  rpc?: { service: string; uid: number | null; args: unknown[]; kwargs: Record<string, unknown> };
};

type Directive =
  | { type: "fail"; status: number; payload: unknown }
  | { type: "fault"; payload: unknown }
  | { type: "delay"; ms: number }
  | { type: "drop" };

export type FakeOdooOptions = {
  baseUrl?: string;
  apiKey?: string;
  database?: string;
  login?: string;
  uid?: number;
  doc?: unknown;
  now?: () => number;
  /** Set false for a bare store: no company, chart, journal or analytic plan. */
  seedBaseline?: boolean;
};

export type MethodHandler = (
  kwargs: Record<string, unknown>,
  store: Map<string, FakeRecord[]>,
) => unknown;

/** French chart codes and journals measured on the local Odoo 18 (docs/odoo-poc.md). */
export const BASELINE_ACCOUNTS = [
  { id: 624, code: "708300", name: "Sundry rentals" },
  { id: 620, code: "706000", name: "Services supplied" },
  { id: 628, code: "708800", name: "Other income from ancillary activities" },
  { id: 140, code: "165100", name: "Deposits" },
  { id: 300, code: "455100", name: "Partners/associates - Current accounts - Principal" },
  { id: 330, code: "471000", name: "Suspense accounts" },
  { id: 282, code: "411100", name: "Customers - Sales of goods or services" },
  { id: 210, code: "401100", name: "Suppliers - Purchase of goods and services" },
];

export const BASELINE_JOURNALS = [
  { id: 8, code: "INV", name: "Customer Invoices", type: "sale" },
  { id: 9, code: "BILL", name: "Vendor Bills", type: "purchase" },
  { id: 10, code: "MISC", name: "Miscellaneous Operations", type: "general" },
  { id: 13, code: "BNK1", name: "Bank", type: "bank", current_statement_balance: 0 },
];

export type FakeOdoo = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly database: string;
  readonly login: string;
  readonly uid: number;
  readonly authCalls: number;
  readonly calls: FakeCall[];
  readonly fetch: typeof globalThis.fetch;
  seed(model: string, records: Record<string, unknown>[]): FakeRecord[];
  records(model: string): FakeRecord[];
  handle(model: string, method: string, handler: MethodHandler): void;
  setLockDates(patch: Record<string, string | false>): void;
  setDoc(doc: unknown): void;
  expireSession(): void;
  failNext(status: number, payload: unknown): void;
  faultNext(payload: unknown): void;
  delayNext(ms: number): void;
  dropNextResponse(): void;
};

export function createManualClock(start = 0): Clock & { advance(ms: number): void } {
  let current = start;
  return {
    now: () => current,
    sleep: (ms: number) => {
      current += Math.max(0, ms);
      return Promise.resolve();
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function leaf(field: string, operator: string, expected: unknown) {
  return (record: FakeRecord): boolean => {
    const actual = record[field];
    switch (operator) {
      case "=":
      case "==":
        return actual === expected;
      case "!=":
        return actual !== expected;
      case "in":
        return asArray(expected).includes(actual);
      case "not in":
        return !asArray(expected).includes(actual);
      case ">":
        return compare(actual, expected) > 0;
      case ">=":
        return compare(actual, expected) >= 0;
      case "<":
        return compare(actual, expected) < 0;
      case "<=":
        return compare(actual, expected) <= 0;
      case "ilike":
        return String(actual).toLowerCase().includes(String(expected).toLowerCase());
      case "like":
        return String(actual).includes(String(expected));
      default:
        throw new Error(`fake odoo: unsupported domain operator ${operator}`);
    }
  };
}

export function compileDomain(domain: unknown[]): (record: FakeRecord) => boolean {
  let index = 0;
  const node = (): ((record: FakeRecord) => boolean) => {
    const token = domain[index];
    index += 1;
    if (token === "&") {
      const left = node();
      const right = node();
      return (record) => left(record) && right(record);
    }
    if (token === "|") {
      const left = node();
      const right = node();
      return (record) => left(record) || right(record);
    }
    if (token === "!") {
      const inner = node();
      return (record) => !inner(record);
    }
    if (Array.isArray(token) && token.length === 3) {
      return leaf(String(token[0]), String(token[1]), token[2]);
    }
    throw new Error(`fake odoo: unsupported domain item ${JSON.stringify(token)}`);
  };
  const predicates: ((record: FakeRecord) => boolean)[] = [];
  while (index < domain.length) predicates.push(node());
  return (record) => predicates.every((predicate) => predicate(record));
}

function applyOrder(rows: FakeRecord[], order: unknown): FakeRecord[] {
  if (typeof order !== "string" || order.trim() === "") return rows;
  const keys = order.split(",").map((part) => {
    const [field = "id", direction = "asc"] = part.trim().split(/\s+/);
    return { field, descending: direction.toLowerCase() === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const delta = compare(a[key.field], b[key.field]);
      if (delta !== 0) return key.descending ? -delta : delta;
    }
    return 0;
  });
}

function project(record: FakeRecord, fields: unknown): FakeRecord {
  if (!Array.isArray(fields) || fields.length === 0) return { ...record };
  const out: FakeRecord = { id: record.id };
  for (const field of fields) {
    if (typeof field !== "string" || field === "id") continue;
    out[field] = record[field] ?? false;
  }
  return out;
}

export function createFakeOdoo(options: FakeOdooOptions = {}): FakeOdoo {
  const baseUrl = options.baseUrl ?? "https://odoo.test";
  const apiKey = options.apiKey ?? "test-api-key";
  const database = options.database ?? "lfsci-test";
  const login = options.login ?? "lfsci-bot";
  const uid = options.uid ?? 7;
  let authCalls = 0;
  let sessionValid = true;
  const now = options.now ?? Date.now;
  const store = new Map<string, FakeRecord[]>();
  const sequences = new Map<string, number>();
  const handlers = new Map<string, MethodHandler>();
  const directives: Directive[] = [];
  const calls: FakeCall[] = [];
  let doc: unknown = options.doc ?? null;

  function rows(model: string): FakeRecord[] {
    const existing = store.get(model);
    if (existing) return existing;
    const created: FakeRecord[] = [];
    store.set(model, created);
    return created;
  }

  function nextId(model: string): number {
    const value = (sequences.get(model) ?? 0) + 1;
    sequences.set(model, value);
    return value;
  }

  function insert(model: string, values: Record<string, unknown>): FakeRecord {
    const raw = values.id;
    const id = typeof raw === "number" ? raw : nextId(model);
    if (typeof raw === "number") {
      sequences.set(model, Math.max(sequences.get(model) ?? 0, raw));
    }
    const record: FakeRecord = { write_date: "2026-01-01 00:00:00", ...values, id };
    if (model === "account.move") {
      const total = lineAmounts(values.invoice_line_ids ?? values.line_ids);
      // Odoo takes an id on create and answers a `[id, label]` pair on read.
      for (const field of ["partner_id", "journal_id", "currency_id", "company_id"]) {
        const value = record[field];
        if (typeof value === "number") record[field] = [value, `${field}:${value}`];
      }
      record.state ??= "draft";
      record.name ??= false;
      record.ref ??= false;
      record.date ??= values.invoice_date ?? false;
      record.amount_total ??= total;
      record.amount_residual ??= total;
      record.payment_state ??= "not_paid";
      record.currency_id ??= [1, "EUR"];
      record.partner_id ??= false;
      record.journal_id ??= false;
      record.company_id ??= [1, "SCI Exemple"];
    }
    rows(model).push(record);
    return record;
  }

  function seedBaseline(): void {
    insert("res.company", {
      id: 1,
      name: "SCI Exemple",
      fiscalyear_lock_date: false,
      tax_lock_date: false,
      sale_lock_date: false,
      purchase_lock_date: false,
      hard_lock_date: false,
    });
    for (const account of BASELINE_ACCOUNTS) insert("account.account", { ...account });
    for (const journal of BASELINE_JOURNALS) insert("account.journal", { ...journal });
    insert("account.analytic.plan", { id: 1, name: "Project" });
  }

  function lineAmounts(values: unknown): number {
    if (!Array.isArray(values)) return 0;
    let total = 0;
    for (const triple of values) {
      if (!Array.isArray(triple) || triple[0] !== 0) continue;
      const line = (triple[2] ?? {}) as Record<string, unknown>;
      const quantity = typeof line.quantity === "number" ? line.quantity : 1;
      const price = typeof line.price_unit === "number" ? line.price_unit : 0;
      const credit = typeof line.credit === "number" ? line.credit : 0;
      total += price * quantity + credit;
    }
    return Math.round(total * 100) / 100;
  }

  /**
   * Mirrors the measured Odoo 18 behaviour: a posting inside a locked period is
   * not refused, its accounting date is pushed past the lock (docs/odoo-poc.md).
   */
  function shiftPastLock(date: string): string {
    const company = rows("res.company")[0];
    const locks = ["hard_lock_date", "fiscalyear_lock_date", "sale_lock_date", "purchase_lock_date"]
      .map((field) => company?.[field])
      .filter((value): value is string => typeof value === "string");
    const blocking = locks
      .filter((lock) => date <= lock)
      .sort()
      .at(-1);
    if (!blocking) return date;
    const [year = "1970", month = "01"] = blocking.split("-");
    const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    return `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function dispatch(model: string, method: string, kwargs: Record<string, unknown>): unknown {
    const handler = handlers.get(`${model}.${method}`);
    if (handler) return handler(kwargs, store);

    if (model === "account.move" && method === "action_post") {
      const ids = asArray(kwargs.ids);
      for (const record of rows(model)) {
        if (!ids.includes(record.id)) continue;
        record.state = "posted";
        record.name = record.move_type === "in_invoice" ? `BILL/${record.id}` : `INV/${record.id}`;
        if (typeof record.date === "string") record.date = shiftPastLock(record.date);
      }
      return true;
    }

    switch (method) {
      case "search":
      case "search_read": {
        const predicate = compileDomain(asArray(kwargs.domain));
        let matched = rows(model).filter(predicate);
        matched = applyOrder(matched, kwargs.order);
        const offset = typeof kwargs.offset === "number" ? kwargs.offset : 0;
        const limit = typeof kwargs.limit === "number" ? kwargs.limit : undefined;
        matched = matched.slice(offset, limit === undefined ? undefined : offset + limit);
        return method === "search"
          ? matched.map((record) => record.id)
          : matched.map((record) => project(record, kwargs.fields));
      }
      case "read": {
        const ids = asArray(kwargs.ids);
        return rows(model)
          .filter((record) => ids.includes(record.id))
          .map((record) => project(record, kwargs.fields));
      }
      case "create": {
        const list = Array.isArray(kwargs.vals_list)
          ? kwargs.vals_list
          : [kwargs.vals ?? kwargs.values ?? {}];
        return list.map((values) => insert(model, (values ?? {}) as Record<string, unknown>).id);
      }
      case "write": {
        const ids = asArray(kwargs.ids);
        const values = (kwargs.vals ?? kwargs.values ?? {}) as Record<string, unknown>;
        for (const record of rows(model)) {
          if (ids.includes(record.id)) Object.assign(record, values);
        }
        return true;
      }
      case "unlink": {
        const ids = asArray(kwargs.ids);
        store.set(
          model,
          rows(model).filter((record) => !ids.includes(record.id)),
        );
        return true;
      }
      default:
        return undefined;
    }
  }

  function rpcResult(id: unknown, result: unknown): Response {
    return json({ jsonrpc: "2.0", id, result });
  }

  function rpcFault(id: unknown, name: string, message: string): Response {
    return json({
      jsonrpc: "2.0",
      id,
      error: {
        code: 200,
        message: "Odoo Server Error",
        data: { name, message, arguments: [message], context: {}, debug: "Traceback (most ..." },
      },
    });
  }

  function unshapeExecuteKw(
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (method) {
      case "create":
        return { ...kwargs, vals_list: args[0] };
      case "write":
        return { ...kwargs, ids: args[0], vals: args[1] };
      default:
        return args.length > 0 ? { ...kwargs, ids: args[0] } : { ...kwargs };
    }
  }

  function handleJsonRpc(
    rawBody: string,
    headers: Record<string, string>,
    directive: Directive | undefined,
    signal: AbortSignal | null,
  ): Promise<Response> | Response {
    const envelope = (JSON.parse(rawBody) ?? {}) as Record<string, unknown>;
    const id = envelope.id;
    const params = (envelope.params ?? {}) as Record<string, unknown>;
    const rpcArgs = asArray(params.args);

    if (params.service === "common" && params.method === "authenticate") {
      // Directives target the business call, not the session handshake in front of it.
      if (directive) directives.unshift(directive);
      authCalls += 1;
      const [db, user, key] = rpcArgs;
      const ok = db === database && user === login && key === apiKey;
      if (ok) sessionValid = true;
      return rpcResult(id, ok ? uid : false);
    }

    if (params.service !== "object" || params.method !== "execute_kw") {
      return rpcFault(id, "werkzeug.exceptions.NotFound", `No service ${String(params.service)}`);
    }

    const [db, callUid, key, rawModel, rawMethod, callArgs, callKwargs] = rpcArgs;
    if (db !== database || key !== apiKey) {
      return rpcFault(id, "odoo.exceptions.AccessDenied", "Access Denied");
    }
    if (!sessionValid || callUid !== uid) {
      return rpcFault(id, "odoo.http.SessionExpiredException", "Session expired");
    }

    const model = String(rawModel);
    const method = String(rawMethod);
    const kwargs = unshapeExecuteKw(
      method,
      asArray(callArgs),
      (callKwargs ?? {}) as Record<string, unknown>,
    );
    calls.push({
      model,
      method,
      kwargs,
      headers,
      at: now(),
      rpc: {
        service: "object",
        uid: typeof callUid === "number" ? callUid : null,
        args: asArray(callArgs),
        kwargs: (callKwargs ?? {}) as Record<string, unknown>,
      },
    });

    if (directive?.type === "fail") return json(directive.payload, directive.status);
    if (directive?.type === "fault") {
      return json({ jsonrpc: "2.0", id, error: directive.payload });
    }

    let result: unknown;
    try {
      result = dispatch(model, method, kwargs);
    } catch (cause) {
      return rpcFault(id, "odoo.exceptions.UserError", String(cause));
    }
    if (result === undefined) {
      return rpcFault(
        id,
        "odoo.exceptions.AccessError",
        `Method ${method} is not available on ${model}`,
      );
    }

    if (directive?.type === "drop") {
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) return;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    return rpcResult(id, result);
  }

  type FetchInput = Parameters<typeof globalThis.fetch>[0];
  type FetchInit = Parameters<typeof globalThis.fetch>[1];

  const fetchImpl = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key] = value;
    }

    const directive = directives.shift();
    if (directive?.type === "delay") {
      await new Promise((resolve) => setTimeout(resolve, directive.ms));
    }

    if (url !== `${baseUrl}/jsonrpc` && headers.Authorization !== `bearer ${apiKey}`) {
      return json(
        {
          name: "werkzeug.exceptions.Unauthorized",
          message: "Invalid apikey",
          arguments: ["Invalid apikey", 401],
        },
        401,
      );
    }

    if (url === `${baseUrl}/jsonrpc`) {
      return handleJsonRpc(String(init?.body ?? "{}"), headers, directive, init?.signal ?? null);
    }

    if (url === `${baseUrl}/doc`) return json(doc);

    const match = url.startsWith(`${baseUrl}/json/2/`)
      ? url.slice(`${baseUrl}/json/2/`.length).split("/")
      : [];
    const model = match[0];
    const method = match[1];
    if (model === undefined || method === undefined) {
      return json({ name: "werkzeug.exceptions.NotFound", message: `No route for ${url}` }, 404);
    }

    const kwargs = (JSON.parse(String(init?.body ?? "{}")) ?? {}) as Record<string, unknown>;
    calls.push({ model, method, kwargs, headers, at: now() });

    if (directive?.type === "fail") {
      return json(directive.payload, directive.status);
    }

    let result: unknown;
    try {
      result = dispatch(model, method, kwargs);
    } catch (cause) {
      return json(
        {
          name: "odoo.exceptions.UserError",
          message: cause instanceof Error ? cause.message : String(cause),
          arguments: [],
        },
        400,
      );
    }

    if (result === undefined) {
      return json(
        {
          name: "odoo.exceptions.AccessError",
          message: `Method ${method} is not available on ${model}`,
          arguments: [],
        },
        403,
      );
    }

    if (directive?.type === "drop") {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }

    return json(result);
  }) as typeof globalThis.fetch;

  if (options.seedBaseline !== false) seedBaseline();

  return {
    baseUrl,
    apiKey,
    database,
    login,
    uid,
    get authCalls() {
      return authCalls;
    },
    calls,
    fetch: fetchImpl,
    expireSession() {
      sessionValid = false;
    },
    seed(model, records) {
      return records.map((values) => insert(model, values));
    },
    records(model) {
      return rows(model);
    },
    handle(model, method, handler) {
      handlers.set(`${model}.${method}`, handler);
    },
    setLockDates(patch) {
      const company = rows("res.company")[0] ?? insert("res.company", { id: 1, name: "SCI" });
      Object.assign(company, patch);
    },
    setDoc(value) {
      doc = value;
    },
    failNext(status, payload) {
      directives.push({ type: "fail", status, payload });
    },
    faultNext(payload) {
      directives.push({ type: "fault", payload });
    },
    delayNext(ms) {
      directives.push({ type: "delay", ms });
    },
    dropNextResponse() {
      directives.push({ type: "drop" });
    },
  };
}

import type { Clock } from "../clock";

export type FakeRecord = Record<string, unknown> & { id: number };

export type FakeCall = {
  model: string;
  method: string;
  kwargs: Record<string, unknown>;
  headers: Record<string, string>;
  at: number;
};

type Directive =
  | { type: "fail"; status: number; payload: unknown }
  | { type: "delay"; ms: number }
  | { type: "drop" };

export type FakeOdooOptions = {
  baseUrl?: string;
  apiKey?: string;
  database?: string;
  doc?: unknown;
  now?: () => number;
};

export type MethodHandler = (
  kwargs: Record<string, unknown>,
  store: Map<string, FakeRecord[]>,
) => unknown;

export type FakeOdoo = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly calls: FakeCall[];
  readonly fetch: typeof globalThis.fetch;
  seed(model: string, records: Record<string, unknown>[]): FakeRecord[];
  records(model: string): FakeRecord[];
  handle(model: string, method: string, handler: MethodHandler): void;
  setDoc(doc: unknown): void;
  failNext(status: number, payload: unknown): void;
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
    rows(model).push(record);
    return record;
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

    if (headers.Authorization !== `bearer ${apiKey}`) {
      return json(
        {
          name: "werkzeug.exceptions.Unauthorized",
          message: "Invalid apikey",
          arguments: ["Invalid apikey", 401],
        },
        401,
      );
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

  return {
    baseUrl,
    apiKey,
    calls,
    fetch: fetchImpl,
    seed(model, records) {
      return records.map((values) => insert(model, values));
    },
    records(model) {
      return rows(model);
    },
    handle(model, method, handler) {
      handlers.set(`${model}.${method}`, handler);
    },
    setDoc(value) {
      doc = value;
    },
    failNext(status, payload) {
      directives.push({ type: "fail", status, payload });
    },
    delayNext(ms) {
      directives.push({ type: "delay", ms });
    },
    dropNextResponse() {
      directives.push({ type: "drop" });
    },
  };
}

export type Ok<T> = { ok: true } & T;

export type Blocked<Reason extends string> = {
  ok: false;
  reason: Reason;
  missing?: string[];
};

export function blocked<Reason extends string>(
  reason: Reason,
  missing?: readonly string[],
): Blocked<Reason> {
  return missing === undefined
    ? { ok: false, reason }
    : { ok: false, reason, missing: [...missing] };
}

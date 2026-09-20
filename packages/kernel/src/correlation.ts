import { AsyncLocalStorage } from "node:async_hooks";
import { isId, newId } from "./ids";

export type CorrelationContext = {
  requestId: string;
  organizationId?: string;
  actorId?: string;
  traceparent?: string;
};

const storage = new AsyncLocalStorage<CorrelationContext>();

export const REQUEST_ID_HEADER = "x-request-id";

export function runWithCorrelation<T>(context: CorrelationContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentCorrelation(): CorrelationContext | undefined {
  return storage.getStore();
}

export function currentRequestId(): string {
  return storage.getStore()?.requestId ?? newId();
}

export function requestIdFromHeader(value: string | null | undefined): string {
  return isId(value) ? value : newId();
}

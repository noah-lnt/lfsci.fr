import "server-only";
import { AppError, runWithCorrelation } from "@lfsci/kernel";
import { implement, os } from "@orpc/server";
import type { z } from "zod";
import { contract } from "@/lib/contract";
import { isDevOrTest } from "../env";
import type { RpcContext } from "./context";
import { toRpcError } from "./errors";

const builder = os.$context<RpcContext>();

/** Binds the correlation id for the whole call and gives every error one shape. */
const traced = builder.middleware(async ({ context, next }) => {
  const correlation = {
    requestId: context.requestId,
    ...(context.organizationId ? { organizationId: context.organizationId } : {}),
    ...(context.session ? { actorId: context.session.user.id } : {}),
  };
  return runWithCorrelation(correlation, async () => {
    try {
      return await next();
    } catch (error) {
      throw toRpcError(error, context.requestId);
    }
  });
});

const requireSession = builder.middleware(async ({ context, next }) => {
  if (!context.session) throw new AppError("UNAUTHENTICATED");
  return next({ context: { session: context.session } });
});

const requireOrganization = builder.middleware(async ({ context, next }) => {
  if (!context.organizationId) throw new AppError("FORBIDDEN");
  return next({ context: { organizationId: context.organizationId } });
});

/**
 * Re-parses a handler's output against the contract schema in development and
 * test (tech pack §10.1: drift fails on the developer's machine, never in
 * production).
 */
export function validated<T>(schema: z.ZodType<T>) {
  return builder.middleware(async ({ next }) => {
    const result = await next();
    if (!isDevOrTest()) return result;
    const parsed = schema.safeParse(result.output);
    if (!parsed.success) {
      throw new AppError("INTERNAL", {
        message: "Réponse non conforme au contrat.",
        details: { issues: parsed.error.issues },
      });
    }
    return result;
  });
}

const implementer = implement(contract).$context<RpcContext>();

/** Public procedures: correlated and typed, no session required. */
export const pub = implementer.use(traced);

/** Authenticated procedures. */
export const authed = pub.use(requireSession);

/** Authenticated procedures scoped to the session's active organization. */
export const withOrganization = authed.use(requireOrganization);

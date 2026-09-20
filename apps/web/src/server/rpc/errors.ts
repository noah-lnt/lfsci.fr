import "server-only";
import { ErrorPayload } from "@lfsci/contracts";
import { AppError, isAppError, logger, toAppError } from "@lfsci/kernel";
import { ORPCError } from "@orpc/server";
import * as Sentry from "@sentry/nextjs";

const log = logger("rpc");

function isErrorPayload(value: unknown): value is ErrorPayload {
  return ErrorPayload.safeParse(value).success;
}

function normalise(error: unknown): AppError | ORPCError<string, ErrorPayload> {
  if (isAppError(error)) return error;

  if (error instanceof ORPCError) {
    if (isErrorPayload(error.data)) return error as ORPCError<string, ErrorPayload>;
    if (error.code === "INPUT_VALIDATION_FAILED") {
      return new AppError("VALIDATION", { details: { issues: error.data }, cause: error });
    }
    if (error.code === "OUTPUT_VALIDATION_FAILED") {
      return new AppError("INTERNAL", {
        message: "Réponse non conforme au contrat.",
        details: { issues: error.data },
        cause: error,
      });
    }
  }

  return toAppError(error);
}

/**
 * Every error crossing the wire is `{ code, message, details?, requestId }`
 * (tech pack §10.1). Anything unknown becomes INTERNAL, keeps the correlation
 * id and is reported.
 */
export function toRpcError(error: unknown, requestId: string): ORPCError<string, ErrorPayload> {
  const normalised = normalise(error);
  if (normalised instanceof ORPCError) return normalised;

  if (normalised.code === "INTERNAL") {
    log.error({ err: normalised.cause ?? normalised, requestId }, "unhandled rpc error");
    Sentry.captureException(normalised.cause ?? normalised, { tags: { requestId } });
  }

  const payload = ErrorPayload.parse({ ...normalised.toPayload(), requestId });

  return new ORPCError(payload.code, {
    status: normalised.status,
    message: payload.message,
    data: payload,
    cause: normalised,
  });
}

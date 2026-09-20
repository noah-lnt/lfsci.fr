import {
  type ErrorCode,
  type ErrorPayload,
  httpStatusByCode,
  messageByCode,
} from "@lfsci/contracts";
import { currentRequestId } from "./correlation";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string;

  constructor(
    code: ErrorCode,
    options: { message?: string; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(options.message ?? messageByCode[code], { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = httpStatusByCode[code];
    this.details = options.details;
    this.requestId = currentRequestId();
  }

  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      requestId: this.requestId,
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  return new AppError("INTERNAL", { cause: value });
}

export function assertNever(value: never, label = "value"): never {
  throw new AppError("INTERNAL", { message: `unexpected ${label}: ${String(value)}` });
}

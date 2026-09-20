import pino, { type Logger } from "pino";
import { currentCorrelation } from "./correlation";
import { redactKeys } from "./redact";

const level = process.env.LOG_LEVEL ?? "info";
const pretty = process.env.NODE_ENV !== "production" && process.env.LOG_FORMAT !== "json";

export const rootLogger: Logger = pino({
  level,
  redact: { paths: redactKeys.map((k) => `*.${k}`).concat(redactKeys), censor: "[redacted]" },
  mixin() {
    const c = currentCorrelation();
    return c ? { requestId: c.requestId, organizationId: c.organizationId } : {};
  },
  ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
});

export function logger(component: string): Logger {
  return rootLogger.child({ component });
}

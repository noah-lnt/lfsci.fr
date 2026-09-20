import { createServer, type Server } from "node:http";
import { logger } from "@lfsci/kernel";
import {
  createModelHealth,
  type ModelComponent,
  type ModelHealth,
  UNKNOWN_MODEL,
} from "./health-model";
import { readHeartbeat } from "./ops";

const log = logger("worker.health");

export type HealthBody = {
  status: "ok" | "starting";
  queues: string[];
  lastHeartbeat: string | null;
  model: ModelComponent;
};

export function healthBody(queues: string[], model: ModelComponent = UNKNOWN_MODEL): HealthBody {
  const beat = readHeartbeat();
  return {
    status: beat ? "ok" : "starting",
    queues,
    lastHeartbeat: beat?.at ?? null,
    model,
  };
}

/**
 * Liveness only: readiness would need the database, and a probe must not add load.
 * The model component is reported but never decides the status — a worker whose
 * Ollama box is down still drains every queue that does not need it.
 */
export function startHealthServer(
  port: number,
  queues: string[],
  modelHealth: ModelHealth = createModelHealth(),
): Server {
  const server = createServer((request, response) => {
    if (request.url !== "/healthz" && request.url !== "/") {
      response.writeHead(404).end();
      return;
    }
    void modelHealth.read().then((model) => {
      const body = healthBody(queues, model);
      response.writeHead(body.status === "ok" ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(body));
    });
  });
  server.listen(port, "0.0.0.0", () => log.info({ port }, "health endpoint listening"));
  return server;
}

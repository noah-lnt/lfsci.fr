import { createServer, type Server } from "node:http";
import { logger } from "@lfsci/kernel";
import { readHeartbeat } from "./ops";

const log = logger("worker.health");

export type HealthBody = {
  status: "ok" | "starting";
  queues: string[];
  lastHeartbeat: string | null;
};

export function healthBody(queues: string[]): HealthBody {
  const beat = readHeartbeat();
  return {
    status: beat ? "ok" : "starting",
    queues,
    lastHeartbeat: beat?.at ?? null,
  };
}

/** Liveness only: readiness would need the database, and a probe must not add load. */
export function startHealthServer(port: number, queues: string[]): Server {
  const server = createServer((request, response) => {
    if (request.url !== "/healthz" && request.url !== "/") {
      response.writeHead(404).end();
      return;
    }
    const body = healthBody(queues);
    response.writeHead(body.status === "ok" ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(body));
  });
  server.listen(port, "0.0.0.0", () => log.info({ port }, "health endpoint listening"));
  return server;
}

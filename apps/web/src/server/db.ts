import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./auth-schema";
import { env } from "./env";

type Sql = ReturnType<typeof postgres>;

let client: Sql | undefined;

export function sql(): Sql {
  if (!client) {
    client = postgres(env().DATABASE_URL, { max: 10, onnotice: () => {} });
  }
  return client;
}

function create() {
  return drizzle(sql(), { schema: authSchema });
}

export type Db = ReturnType<typeof create>;

let database: Db | undefined;

export function db(): Db {
  if (!database) database = create();
  return database;
}

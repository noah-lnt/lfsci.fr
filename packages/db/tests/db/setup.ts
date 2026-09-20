import { afterAll, beforeAll, beforeEach } from "vitest";
import { closeTestDbs, migrateTestDatabase, truncateAll } from "./helpers";

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDbs();
});

import { dbFromEnv } from "../client";
import { seed } from "../seed";

const handle = dbFromEnv("admin");
try {
  const result = await seed(handle);
  console.error(`seeded organization ${result.organizationId}`);
} finally {
  await handle.close();
}

import { expect, test } from "@playwright/test";

test("healthz reports the process is up", async ({ request }) => {
  const response = await request.get("/healthz");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok" });
});

test("readyz reports each component", async ({ request }) => {
  const response = await request.get("/readyz");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    status: "ready",
    components: { database: "up", storage: "unknown", queue: "unknown" },
  });
});

test("every response carries a correlation id", async ({ request }) => {
  const response = await request.get("/connexion");
  expect(response.headers()["x-request-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("a client-supplied correlation id is kept", async ({ request }) => {
  const id = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
  const response = await request.get("/connexion", { headers: { "x-request-id": id } });
  expect(response.headers()["x-request-id"]).toBe(id);
});

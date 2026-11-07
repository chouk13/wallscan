import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";

it("GET /health", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json().quoteEngine.validation).toContain("NON VALIDÉ");
  await app.close();
});

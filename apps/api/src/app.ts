import Fastify from "fastify";
import cors from "@fastify/cors";
import { ENGINE_VERSION, ENGINE_VALIDATION_STATUS } from "@wallscan/quote-engine";

export async function buildApp() {
  const app = Fastify({ logger: { redact: ["req.headers.authorization"] } });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({
    status: "ok",
    quoteEngine: { version: ENGINE_VERSION, validation: ENGINE_VALIDATION_STATUS },
  }));

  // Phase 1 : routes tRPC (catalogue, murs, devis, sync offline) — backend-engineer.
  return app;
}

import { describe, expect, it } from "vitest";
import type { CrmPort } from "../src/index.js";

/** Test de contrat réutilisable par chaque adaptateur (Phase 3). */
export function crmContractTests(name: string, make: () => CrmPort) {
  describe(`contrat CrmPort — ${name}`, () => {
    it("upsert puis find retrouve le même contact", async () => {
      const crm = make();
      const c = await crm.upsertContact({ name: "Test", email: "t@example.ch" });
      expect(await crm.findContact({ email: "t@example.ch" })).toMatchObject({ id: c.id });
    });
    it("createDeal est idempotent", async () => {
      const crm = make();
      const c = await crm.upsertContact({ name: "Test" });
      const d = { contactId: c.id, title: "Devis", amount: 100 as never, currency: "CHF" as const, idempotencyKey: "k1", wallscanQuoteId: "q1" };
      const a = await crm.createDeal(d);
      const b = await crm.createDeal(d);
      expect(a.id).toBe(b.id);
    });
  });
}

describe("crm-core", () => {
  it("exporte le contrat", () => expect(typeof crmContractTests).toBe("function"));
});

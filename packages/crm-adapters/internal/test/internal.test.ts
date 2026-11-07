import { describe, expect, it } from "vitest";
import { InMemoryInternalCrm } from "../src/index.js";

describe("InMemoryInternalCrm", () => {
  it("upsert/find/deal idempotent/stage/files/activities", async () => {
    const crm = new InMemoryInternalCrm();
    const c = await crm.upsertContact({ name: "Mme Test", email: "t@example.ch" });
    expect(await crm.findContact({ email: "t@example.ch" })).toMatchObject({ id: c.id });
    expect(await crm.findContact({ phone: "000" })).toBeNull();
    const c2 = await crm.upsertContact({ name: "Mme Test 2", email: "t@example.ch" });
    expect(c2.id).toBe(c.id);
    const input = { contactId: c.id, title: "Devis 1", amount: 100 as never, currency: "CHF" as const, idempotencyKey: "q1", wallscanQuoteId: "q1" };
    const d1 = await crm.createDeal(input);
    const d2 = await crm.createDeal(input);
    expect(d1.id).toBe(d2.id);
    await crm.updateDealStage(d1.id, "sent");
    await crm.attachFile(d1.id, { name: "devis.pdf", mimeType: "application/pdf", url: "x" });
    await crm.logActivity({ dealId: d1.id, type: "quote_sent", message: "envoyé", at: "2026-01-01T00:00:00Z" });
    await expect(crm.updateDealStage("nope", "x")).rejects.toThrow();
    await expect(crm.attachFile("nope", { name: "", mimeType: "", url: "" })).rejects.toThrow();
    expect((await crm.listPipelines())[0]?.stages.length).toBe(4);
    expect(await crm.webhookHandler({})).toBeNull();
    const s = crm.snapshot();
    expect(s.deals[0]?.stage).toBe("sent");
    expect(s.activities.length).toBe(1);
  });
});

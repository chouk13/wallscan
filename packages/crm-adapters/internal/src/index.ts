/**
 * InternalCrm — CRM minimal intégré, même interface que les CRM externes.
 * Phase 0 : implémentation en mémoire (tests, dev). Phase 3 : persistance Postgres (`crm-integrator`).
 */
import type { ActivityInput, Contact, ContactInput, ContactQuery, CrmEvent, CrmPort, Deal, DealInput, FileRef, Pipeline } from "@wallscan/crm-core";

const DEFAULT_PIPELINE: Pipeline = {
  id: "default",
  name: "Ventes",
  stages: [
    { id: "draft", name: "Brouillon" },
    { id: "sent", name: "Devis envoyé" },
    { id: "accepted", name: "Accepté" },
    { id: "refused", name: "Refusé" },
  ],
};

export class InMemoryInternalCrm implements CrmPort {
  private contacts = new Map<string, Contact>();
  private deals = new Map<string, Deal & { idempotencyKey: string; files: FileRef[] }>();
  private activities: ActivityInput[] = [];
  private seq = 0;

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async findContact(q: ContactQuery): Promise<Contact | null> {
    for (const c of this.contacts.values()) {
      if (q.externalId && c.externalId === q.externalId) return c;
      if (q.email && c.email === q.email) return c;
      if (q.phone && c.phone === q.phone) return c;
    }
    return null;
  }

  async upsertContact(input: ContactInput): Promise<Contact> {
    const existing = await this.findContact({ ...(input.email ? { email: input.email } : {}), ...(input.externalId ? { externalId: input.externalId } : {}) });
    const contact: Contact = { ...(existing ?? { id: this.nextId("c") }), ...input };
    this.contacts.set(contact.id, contact);
    return contact;
  }

  async createDeal(d: DealInput): Promise<Deal> {
    for (const deal of this.deals.values()) if (deal.idempotencyKey === d.idempotencyKey) return deal;
    const deal = { id: this.nextId("d"), stage: d.stage ?? "draft", idempotencyKey: d.idempotencyKey, files: [] };
    this.deals.set(deal.id, deal);
    return deal;
  }

  async updateDealStage(dealId: string, stage: string): Promise<void> {
    const deal = this.deals.get(dealId);
    if (!deal) throw new Error(`Deal inconnu: ${dealId}`);
    deal.stage = stage;
  }

  async attachFile(dealId: string, f: FileRef): Promise<void> {
    const deal = this.deals.get(dealId);
    if (!deal) throw new Error(`Deal inconnu: ${dealId}`);
    deal.files.push(f);
  }

  async logActivity(a: ActivityInput): Promise<void> {
    this.activities.push(a);
  }

  async listPipelines(): Promise<Pipeline[]> {
    return [DEFAULT_PIPELINE];
  }

  async webhookHandler(_evt: unknown): Promise<CrmEvent | null> {
    return null; // le CRM interne n'émet pas de webhooks entrants
  }

  /** Accès de test. */
  snapshot() {
    return { contacts: [...this.contacts.values()], deals: [...this.deals.values()], activities: [...this.activities] };
  }
}

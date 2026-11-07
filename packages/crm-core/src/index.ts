/** Port CRM (§6). Le métier ne dépend d'aucun CRM : seuls ces types sont importés hors de crm-adapters. */
import type { Cents, Currency } from "@wallscan/core";

export interface ContactQuery { email?: string; phone?: string; externalId?: string }
export interface ContactInput { name: string; email?: string; phone?: string; address?: string; externalId?: string }
export interface Contact extends ContactInput { id: string }

export interface DealInput {
  contactId: string;
  title: string;
  amount: Cents;
  currency: Currency;
  stage?: string;
  pipelineId?: string;
  /** Clé d'idempotence : même clé → même deal, jamais de doublon. */
  idempotencyKey: string;
  wallscanQuoteId: string;
}
export interface Deal { id: string; stage: string; url?: string }

export interface FileRef { name: string; mimeType: string; url: string; sizeBytes?: number }
export interface ActivityInput { dealId?: string; contactId?: string; type: "quote_sent" | "quote_viewed" | "quote_accepted" | "quote_refused" | "note"; message: string; at: string }
export interface Pipeline { id: string; name: string; stages: { id: string; name: string }[] }

export type CrmEvent =
  | { kind: "deal_stage_changed"; dealId: string; stage: string }
  | { kind: "contact_updated"; contact: Contact };

export interface CrmPort {
  findContact(q: ContactQuery): Promise<Contact | null>;
  upsertContact(c: ContactInput): Promise<Contact>;
  createDeal(d: DealInput): Promise<Deal>;
  updateDealStage(dealId: string, stage: string): Promise<void>;
  attachFile(dealId: string, f: FileRef): Promise<void>;
  logActivity(a: ActivityInput): Promise<void>;
  listPipelines(): Promise<Pipeline[]>;
  webhookHandler(evt: unknown): Promise<CrmEvent | null>;
}

export type CrmProvider = "internal" | "octyzen" | "bexio" | "hubspot" | "webhook";

/**
 * Adaptateur Octyzen — CRM sur mesure (Octyzen Sàrl, Carouge GE, octyzen.ch).
 * Pas d'API publique documentée : le contrat ci-dessous est la PROPOSITION de WallScan, à valider avec Octyzen.
 * Phase 3 (`crm-integrator`). En attendant : InternalCrm + GenericWebhook.
 */
export const ADAPTER = "octyzen" as const;

/** Endpoints REST proposés (base URL fournie par Octyzen, auth Bearer). */
export const PROPOSED_CONTRACT = {
  findContact: "GET /contacts?email=|phone=",
  upsertContact: "PUT /contacts",
  createDeal: "POST /projects  (idempotency-key header)",
  updateDealStage: "PATCH /projects/{id}/stage",
  attachFile: "POST /projects/{id}/files  (PDF devis, rendu)",
  logActivity: "POST /projects/{id}/activities",
  listPipelines: "GET /pipelines",
  webhook: "POST {wallscan}/webhooks/octyzen  (project.stage_changed, contact.updated) signé HMAC",
} as const;

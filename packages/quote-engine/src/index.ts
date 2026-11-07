/**
 * packages/quote-engine — moteur de devis pur, déterministe, auditable (PROMPT-MAITRE §5) + calepinage lé par lé
 * (docs/specs/measurement-api.md §3). Bundle IIFE : `pnpm build:bundle` → `dist/wsquote.iife.js`, globale `WSQuote`.
 *
 * Invariants (non négociables) :
 *  - pur TypeScript, zéro I/O, zéro dépendance réseau, zéro Date.now() : la date est une entrée ;
 *  - déterministe : mêmes entrées → même sortie ;
 *  - montants en Cents ; taux en points de base ; aucune constante de prix dans le code ;
 *  - longueurs arrondies au millimètre en interne (raccords exacts), restituées en cm ;
 *  - chaque calcul porte une `trace[]` en français, une ligne par décision (« Pourquoi 7 rouleaux ? »).
 *
 * Statut : `ENGINE_VALIDATION_STATUS` — non validé tant que les ≥ 40 devis réels de Soufflet ne sont pas rejoués.
 */
export { ENGINE_VERSION } from "./version.js";
export * from "./contract.js";
export * from "./types.js";
export { planStrips, planRoom } from "./strips.js";
export { computeQuote, quoteRange, lineTotal, deductThresholdM2 } from "./quote.js";
export {
  computeRollsSimple,
  simpleStripHeightMm,
  dropMm,
  hasPattern,
  type SimpleRollsArgs,
} from "./simple.js";
export { toMm, mmToCm, mm2ToM2, fmtNum, fmtCm, fmtM2 } from "./units.js";

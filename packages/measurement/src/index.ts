/**
 * packages/measurement — mesure physique d'un mur.
 * - Phase 0 (conservée) : saisie manuelle, correction, règles d'ouvertures (`manual.ts`).
 * - Mesure depuis une photo (docs/specs/mesure-photo-v1.md, docs/specs/measurement-api.md) : homographie,
 *   rectification par référence (mire / A4), détection, distorsion, plinthes, ouvertures, pipeline automatique.
 */
export * from "./manual.js";
export * from "./constants.js";
export * from "./linalg.js";
export * from "./homography.js";
export * from "./distortion.js";
export * from "./image.js";
export * from "./segment.js";
export * from "./refine.js";
export * from "./edges.js";
export * from "./reference.js";
export * from "./wallCorners.js";
export * from "./distortionEstimate.js";
export * from "./rectify.js";
export * from "./warp.js";
export * from "./baseboard.js";
export * from "./openings.js";
export * from "./bounds.js";
export * from "./pipeline.js";

/** Fourchette ± tolérance affichée : toutes les longueurs du survey mises à l'échelle (W, H, ouvertures, plinthe). */
import type { WallSurvey } from "@wallscan/core";

export function scaleSurvey(survey: WallSurvey, factor: number): WallSurvey {
  return {
    ...survey,
    widthCm: survey.widthCm * factor,
    heightCm: survey.heightCm * factor,
    heightLeftCm: survey.heightLeftCm * factor,
    heightRightCm: survey.heightRightCm * factor,
    scalePxPerCm: survey.scalePxPerCm / factor,
    homography: survey.homography.map((v, i) => (i < 6 ? v * factor : v)),
    openings: survey.openings.map((o) => ({ ...o, rect: { x: o.rect.x * factor, y: o.rect.y * factor, w: o.rect.w * factor, h: o.rect.h * factor } })),
    baseboard: { ...survey.baseboard, heightCm: survey.baseboard.heightCm === null ? null : survey.baseboard.heightCm * factor },
    checks: { ...survey.checks, warnings: [...survey.checks.warnings] },
  };
}

/** −tol / +tol (tolérance affichée : 3 % référence détectée, 5 % feuille manuelle) pour l'estimation en fourchette. */
export function surveyBounds(survey: WallSurvey): { low: WallSurvey; high: WallSurvey } {
  const t = survey.displayTolerancePct / 100;
  return { low: scaleSurvey(survey, 1 - t), high: scaleSurvey(survey, 1 + t) };
}

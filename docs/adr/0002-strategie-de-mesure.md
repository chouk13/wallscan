# ADR-0002 — Stratégie de mesure du mur

Date : 2026-11-06 · Statut : **Proposée** · Owner : measurement-engineer · Reviewer : qa-engineer

## Contexte
La mesure alimente le devis ; une erreur de 5 % sur la hauteur peut changer le nombre de rouleaux. Les sources possibles sont
hétérogènes (AR live, photo importée sans métadonnées, appareil sans AR).

## Options
1. **AR seule** (ARKit/ARCore) : précise (±1–2 %) mais indisponible sur photo importée et sur une partie du parc Android.
2. **Estimation monoculaire par IA** (profondeur) : séduisante mais non déterministe, non auditable, erreurs de 10–20 % fréquentes
   en intérieur. **Rejetée comme source de mesure** (acceptable plus tard comme simple aide au placement des coins).
3. **Cascade AR → objet de référence → saisie manuelle, confiance affichée, correction toujours possible** (§4.1).

## Décision
Option 3. Précisions :
- La **confiance** est une propriété de la méthode et de la qualité de la prise (angle, netteté, taille de l'objet de référence en px),
  calculée de façon déterministe et documentée ; `< 0.8` ⇒ bannière et blocage de l'envoi du devis tant que le vendeur n'a pas confirmé.
- L'objet de référence doit être **dans le plan du mur** (prise, interrupteur, cadre de porte) ; un objet hors plan (table, canapé)
  est refusé par l'UI. Dimensions de référence : A4, prise type J 85 × 85 mm, porte CH (`À CONFIRMER`).
- Chaque mesure enregistre `method`, `confidence`, `corrected_by_user` et l'écart auto/corrigé → objectif < 20 % de corrections à 3 mois.
- **Benchmark terrain obligatoire** avant Phase 2 : 20 murs mesurés au laser, écart par méthode publié dans `docs/reports/measurement-benchmark.md`.
- Module AR = Expo Modules natif maison (Swift ARKit en premier car LiDAR + détection de plans robustes ; ARCore ensuite).

## Conséquences
- Phase 1 livre référence + manuel ; AR en Phase 2. Le devis est donc possible dès la Phase 1, avec confiance affichée.
- Risque assumé : la précision « objet de référence » sur photo importée dépend de la distorsion d'objectif non corrigée (pas d'EXIF fiable).
  Le vendeur est informé par la confiance ; la saisie manuelle reste la source de vérité en cas de doute.

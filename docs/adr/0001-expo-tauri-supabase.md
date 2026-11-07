# ADR-0001 — Expo (mobile), Tauri 2 (desktop), Next.js (web), Supabase (données)

Date : 2026-11-06 · Statut : **Proposée** (validation client attendue) · Owner : lead-architect · Reviewer : devops-engineer, security-compliance

## Contexte
Trois surfaces (visite à domicile, showroom, back-office/partage) avec un seul codebase TypeScript, offline-first sur mobile,
accès caméra/AR, hébergement CH/UE, équipe réduite.

## Options
1. **Expo + Tauri 2 + Next.js + Supabase** (stack imposée §2).
2. Flutter pour mobile + desktop : un seul codebase UI mais Dart ≠ TypeScript → le métier (devis, mesure) serait dupliqué ou exposé via FFI. Rejeté (§1.2).
3. Electron au lieu de Tauri : plus mature, mais binaire 150+ Mo, mises à jour lourdes pour des postes showroom. Rejeté.
4. PWA unique : pas d'ARKit/ARCore, caméra limitée sur iOS, offline fragile. Rejeté pour le mobile ; conservée pour la page de partage client.
5. Backend maison Postgres + Fastify auto-hébergé en Suisse (Infomaniak/Exoscale) au lieu de Supabase.

## Décision
Option 1, avec deux réserves explicites :
- **AR** : il n'existe pas de module Expo ARKit/ARCore officiel et maintenu. L'AR sera un **module natif Expo Modules maison**
  (Swift ARKit d'abord, Kotlin ARCore ensuite) — voir ADR-0002. Le prompt mentionne `expo-ar` : ce package n'est pas une solution
  de production ; ne pas compter dessus.
- **Hébergement** : Supabase n'offre pas de région Suisse à ce jour (À VÉRIFIER par devops-engineer avant provisioning).
  Décision : région **eu-central-1 (Francfort)** avec DPA Supabase, acceptable au titre de la nLPD (UE = niveau de protection adéquat).
  Si Soufflet exige l'hébergement en Suisse, option 5 (Postgres + stockage objets chez un hébergeur CH) : le code reste identique
  (Postgres standard, S3-compatible, Auth via Supabase self-host ou remplacement par Lucia/Auth.js). Trancher avec la question n°10.

## Conséquences
- `pnpm dev` lance api + web + desktop (vite) + mobile (expo) ; les builds natifs nécessitent Xcode / Android Studio / Rust sur le poste.
- Tamagui partagé mobile/web/desktop ; coût d'apprentissage accepté pour éviter deux design systems.
- Supabase Auth : rôles admin/seller/client ; `enable_signup=false`, comptes créés par l'admin.
- Toute dérogation ultérieure (ex. Flutter pour l'AR) repasse par une ADR.

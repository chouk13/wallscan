/** Design tokens — source unique consommée par Tamagui (packages/ui). Couleurs Soufflet : À CONFIRMER. */
export const tokens = {
  color: {
    brand: "#1F3A5F",          // À CONFIRMER (identité Soufflet Décoration)
    brandAccent: "#C9A061",    // À CONFIRMER
    bg: "#FFFFFF",
    bgDark: "#121417",
    text: "#1A1A1A",
    textDark: "#F2F2F2",
    muted: "#6B7280",
    success: "#1B7F4C",
    warning: "#B45309",       // bannière « Mesure à vérifier »
    danger: "#B91C1C",
    border: "#E5E7EB",
  },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 },
  radius: { sm: 4, md: 8, lg: 16, full: 9999 },
  font: {
    family: { body: "Inter", heading: "Inter" },
    size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, showroom: 40 },
    weight: { regular: "400", medium: "500", bold: "700" },
  },
  /** Mode showroom : cibles tactiles larges, contrastes élevés. */
  showroom: { minTouchTarget: 56, lineHeight: 1.4 },
} as const;
export type Tokens = typeof tokens;

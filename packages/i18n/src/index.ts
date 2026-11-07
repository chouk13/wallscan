import fr from "./locales/fr.json" with { type: "json" };
import de from "./locales/de.json" with { type: "json" };
import it from "./locales/it.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import type { Locale } from "@wallscan/core";

export type MessageKey = keyof typeof fr;
export const LOCALES: readonly Locale[] = ["fr", "de", "it", "en"];
export const DEFAULT_LOCALE: Locale = "fr";

const catalogs: Record<Locale, Record<MessageKey, string>> = { fr, de, it, en };

export type Params = Record<string, string | number>;

/** Traduit une clé ; interpole `{name}` ; retombe sur FR puis sur la clé (jamais une chaîne vide). */
export function t(locale: Locale, key: MessageKey, params?: Params): string {
  const raw = catalogs[locale]?.[key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function makeT(locale: Locale) {
  return (key: MessageKey, params?: Params) => t(locale, key, params);
}

/** Vérification d'intégrité (utilisée par les tests et la CI) : toutes les locales ont toutes les clés. */
export function missingKeys(): Record<Locale, MessageKey[]> {
  const keys = Object.keys(fr) as MessageKey[];
  const out = {} as Record<Locale, MessageKey[]>;
  for (const l of LOCALES) out[l] = keys.filter((k) => !(k in catalogs[l]) || catalogs[l][k] === "");
  return out;
}

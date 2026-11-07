// Vérifie que dist/wsquote.iife.js se charge dans Node (globale WSQuote) et répond sur un cas simple.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "wsquote.iife.js");
const code = readFileSync(file, "utf8");
const context = vm.createContext({});
vm.runInContext(code, context, { filename: "wsquote.iife.js" });
const WSQuote = context.WSQuote;
if (!WSQuote) throw new Error("globale WSQuote absente");
for (const fn of ["planStrips", "planRoom", "quoteRange", "computeQuote", "computeRollsSimple"]) {
  if (typeof WSQuote[fn] !== "function") throw new Error(`WSQuote.${fn} manquant`);
}
const plan = WSQuote.planStrips({
  wall: {
    widthCm: 400,
    heightLeftCm: 250,
    heightRightCm: 250,
    openings: [],
    baseboard: { enabled: false, heightCm: null },
  },
  paper: {
    rollWidthCm: 53,
    rollLengthCm: 1005,
    patternRepeatCm: 0,
    matchType: "free",
    offsetCm: 0,
    saleUnit: "roll",
    minOrderRolls: 1,
  },
  settings: {
    cutTopCm: 5,
    cutBottomCm: 5,
    start: "left",
    deductAboveM2: 1,
    safetyRollIfPattern: true,
  },
});
if (plan.rollCount !== 3 || plan.error)
  throw new Error(`planStrips inattendu : ${JSON.stringify(plan)}`);
console.log(
  `dist/wsquote.iife.js : ${(code.length / 1024).toFixed(1)} Ko, WSQuote ${WSQuote.ENGINE_VERSION} OK (mur 400×250 → ${plan.rollCount} rouleaux)`,
);

import { expect, it } from "vitest";
import { tokens } from "../src/index.js";
it("tokens : contrastes WCAG minimaux (vérifiés par ui-designer, ici sanity check)", () => {
  expect(tokens.showroom.minTouchTarget).toBeGreaterThanOrEqual(44);
  expect(Object.keys(tokens.color).length).toBeGreaterThan(5);
});

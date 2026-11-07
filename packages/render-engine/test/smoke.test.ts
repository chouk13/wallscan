import { expect, it } from "vitest";
import { PACKAGE } from "../src/index.js";
it("package", () => expect(PACKAGE).toBe("render-engine"));

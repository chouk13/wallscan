import { expect, it } from "vitest";
import { ADAPTER, PROPOSED_CONTRACT } from "../src/index.js";
it("octyzen adapter contract", () => { expect(ADAPTER).toBe("octyzen"); expect(Object.keys(PROPOSED_CONTRACT).length).toBe(8); });

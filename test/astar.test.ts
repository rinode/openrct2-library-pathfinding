import { describe, it } from "vitest";
import { astar } from "../src/algorithms/astar";
import { sharedCases, optimalCases, tickYieldingCases } from "./fixtures";

describe("astar", () => {
    for (const c of sharedCases) {
        it(c.name, () => c.run(astar));
    }
    for (const c of optimalCases) {
        it(c.name, () => c.run(astar));
    }
    for (const c of tickYieldingCases) {
        it(c.name, () => c.run(astar));
    }
});

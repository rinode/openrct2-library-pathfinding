import { describe, it } from "vitest";
import { dijkstra } from "../src/algorithms/dijkstra";
import { sharedCases, optimalCases, tickYieldingCases } from "./fixtures";

describe("dijkstra", () => {
    for (const c of sharedCases) {
        it(c.name, () => c.run(dijkstra));
    }
    for (const c of optimalCases) {
        it(c.name, () => c.run(dijkstra));
    }
    for (const c of tickYieldingCases) {
        it(c.name, () => c.run(dijkstra));
    }
});

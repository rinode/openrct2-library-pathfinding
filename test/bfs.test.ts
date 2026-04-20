import { describe, it } from "vitest";
import { bfs } from "../src/algorithms/bfs";
import { sharedCases, optimalCases, tickYieldingCases } from "./fixtures";

describe("bfs", () => {
    for (const c of sharedCases) {
        it(c.name, () => c.run(bfs));
    }
    // BFS on unit-weight graphs is optimal, so it passes the optimal cases too.
    for (const c of optimalCases) {
        it(c.name, () => c.run(bfs));
    }
    for (const c of tickYieldingCases) {
        it(c.name, () => c.run(bfs));
    }
});

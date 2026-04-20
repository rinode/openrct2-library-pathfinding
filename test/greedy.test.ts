import { describe, it } from "vitest";
import { greedy } from "../src/algorithms/greedy";
import { sharedCases, tickYieldingCases } from "./fixtures";

describe("greedy", () => {
    // Greedy Best-First does NOT guarantee optimality, so it only gets the
    // shared contract cases only, not the shortest-path cases.
    for (const c of sharedCases) {
        it(c.name, () => c.run(greedy));
    }
    for (const c of tickYieldingCases) {
        it(c.name, () => c.run(greedy));
    }
});

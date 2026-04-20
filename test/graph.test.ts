import { describe, it, expect, beforeEach } from "vitest";
import { astar } from "../src/algorithms/astar";
import { JunctionGraph, invalidateGraph, getDefaultGraph } from "../src/graph";
import type { PathfindingFunction } from "../src/types";
import { sharedCases, optimalCases } from "./fixtures";
import { parseGrid, installFakes } from "./harness";

// Using the junction graph is an opt-in option for any algorithm. These tests
// run A* with a fresh graph to exercise the graph-backed search path against
// the shared contract, then cover graph-specific behavior below.
const astarWithGraph: PathfindingFunction = (s, e, b) => astar(s, e, b, { graph: new JunctionGraph() });

describe("astar on junction graph (shared contract)", () => {
    for (const c of sharedCases) {
        it(c.name, () => c.run(astarWithGraph));
    }
    for (const c of optimalCases) {
        it(c.name, () => c.run(astarWithGraph));
    }
});

describe("JunctionGraph", () => {
    it("builds a single-corridor component as one edge between two dead-end junctions", async () => {
        const grid = parseGrid(`S...E`);
        const fakes = installFakes(grid.map);
        try {
            const g = new JunctionGraph();
            await g.buildComponentFrom(grid.start);
            expect(g.junctionCount).toBe(2);
            const startNode = g.getNode("0,0,0")!;
            expect(startNode).toBeDefined();
            expect(startNode.edges).toHaveLength(1);
            expect(startNode.edges[0].length).toBe(4);
            expect(startNode.edges[0].toKey).toBe(`${4 * 32},0,0`);
        } finally {
            fakes.dispose();
        }
    });

    it("classifies a Y-junction as a degree-3 node", async () => {
        const grid = parseGrid(`
            S....
            ..#..
            E.#..
        `);
        const fakes = installFakes(grid.map);
        try {
            const g = new JunctionGraph();
            await g.buildComponentFrom(grid.start);
            const tNode = g.getNode(`${1 * 32},0,0`);
            expect(tNode).toBeDefined();
            expect(tNode!.edges.length).toBe(3);
        } finally {
            fakes.dispose();
        }
    });

    it("does not build the other component on a single query", async () => {
        const grid = parseGrid(`S.#.E`);
        const fakes = installFakes(grid.map);
        try {
            const g = new JunctionGraph();
            await g.buildComponentFrom(grid.start);
            const startBuilt = g.junctionCount;
            expect(startBuilt).toBe(2);
            expect(g.has(grid.end)).toBe(false);
            await g.buildComponentFrom(grid.end);
            expect(g.junctionCount).toBe(startBuilt + 2);
        } finally {
            fakes.dispose();
        }
    });

    it("manual invalidate() clears all state", async () => {
        const grid = parseGrid(`S...E`);
        const fakes = installFakes(grid.map);
        try {
            const g = new JunctionGraph();
            await g.buildComponentFrom(grid.start);
            expect(g.junctionCount).toBeGreaterThan(0);
            g.invalidate();
            expect(g.junctionCount).toBe(0);
            expect(g.has(grid.start)).toBe(false);
        } finally {
            fakes.dispose();
        }
    });

    it("yields across multiple ticks when building under a tight budget", async () => {
        const grid = parseGrid(`S..................E`);
        const fakes = installFakes(grid.map);
        try {
            const g = new JunctionGraph();
            let yieldCalls = 0;
            const origSetTimeout = fakes.context.setTimeout;
            fakes.context.setTimeout = (cb, d) => {
                yieldCalls++;
                return origSetTimeout(cb, d);
            };
            await g.buildComponentFrom(grid.start, 0);
            expect(g.junctionCount).toBe(2);
            expect(yieldCalls).toBeGreaterThan(1);
        } finally {
            fakes.dispose();
        }
    });

    it("respects one-way banner edges", async () => {
        const grid = parseGrid(`
            S.E
            banners:
            0,0 > 1,0
        `);
        const fakes = installFakes(grid.map);
        try {
            const reverse = await astar(grid.end, grid.start, 10, { graph: new JunctionGraph() });
            expect(reverse.success).toBe(false);
            const fwd = await astar(grid.start, grid.end, 10, { graph: new JunctionGraph() });
            expect(fwd.success).toBe(true);
        } finally {
            fakes.dispose();
        }
    });
});

describe("auto-invalidation", () => {
    beforeEach(() => invalidateGraph());

    it("rebuilds the graph after a path-mutating action.execute event", async () => {
        const grid = parseGrid(`S...E`);
        const fakes = installFakes(grid.map);
        try {
            const g = getDefaultGraph();
            await g.buildComponentFrom(grid.start);
            expect(g.junctionCount).toBeGreaterThan(0);
            fakes.context.__fireAction("footpathremove", 0);
            expect(g.junctionCount).toBe(0);
        } finally {
            fakes.dispose();
        }
    });

    it("ignores failed action events (result.error !== 0)", async () => {
        const grid = parseGrid(`S...E`);
        const fakes = installFakes(grid.map);
        try {
            const g = getDefaultGraph();
            await g.buildComponentFrom(grid.start);
            const before = g.junctionCount;
            fakes.context.__fireAction("footpathremove", 1);
            expect(g.junctionCount).toBe(before);
        } finally {
            fakes.dispose();
        }
    });

    it("ignores unrelated successful actions", async () => {
        const grid = parseGrid(`S...E`);
        const fakes = installFakes(grid.map);
        try {
            const g = getDefaultGraph();
            await g.buildComponentFrom(grid.start);
            const before = g.junctionCount;
            fakes.context.__fireAction("ridecreate", 0);
            expect(g.junctionCount).toBe(before);
        } finally {
            fakes.dispose();
        }
    });
});

describe("opt-in graph parameter", () => {
    it("A* with graph returns same path length as without", async () => {
        const grid = parseGrid(`
            S....
            .#.#.
            ..#..
            .#.#.
            ....E
        `);
        const fakes = installFakes(grid.map);
        try {
            const without = await astar(grid.start, grid.end, 10);
            const g = new JunctionGraph();
            const withGraph = await astar(grid.start, grid.end, 10, { graph: g });
            expect(withGraph.success).toBe(true);
            expect(without.success).toBe(true);
            expect(withGraph.path.length).toBe(without.path.length);
        } finally {
            fakes.dispose();
        }
    });

    it("graph-backed A* matches tile-by-tile A* path length on a branching grid", async () => {
        const grid = parseGrid(`
            S....E
            .....
            .....
        `);
        const fakes = installFakes(grid.map);
        try {
            const a = await astar(grid.start, grid.end, 10);
            const b = await astar(grid.start, grid.end, 10, { graph: new JunctionGraph() });
            expect(b.success).toBe(true);
            expect(a.success).toBe(true);
            expect(b.path.length).toBe(a.path.length);
        } finally {
            fakes.dispose();
        }
    });
});

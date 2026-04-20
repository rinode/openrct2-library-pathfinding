// Shared test cases for pathfinding algorithms.
//
// Each algorithm has the same contract:
//   (start, end, budgetMs) => Promise<PathfindingResult>
// So most tests can be parametrized over the algorithm under test.

import { expect } from "vitest";
import type { PathfindingFunction } from "../src/types";
import { parseGrid, installFakes } from "./harness";

export interface ParametrizedCase {
    name: string;
    run: (algo: PathfindingFunction) => Promise<void>;
}

function coordKey(p: CoordsXYZ): string {
    return `${p.x},${p.y},${p.z}`;
}

// Verify `path` is a valid walk on the grid: every step touches a tile and
// moves exactly one grid cell in a cardinal direction.
function assertValidWalk(path: CoordsXYZ[], tileKeys: Set<string>, start: CoordsXYZ, end: CoordsXYZ) {
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual(start);
    expect(path[path.length - 1]).toEqual(end);
    for (const p of path) {
        expect(tileKeys.has(coordKey(p))).toBe(true);
    }
    for (let i = 1; i < path.length; i++) {
        const dx = Math.abs(path[i].x - path[i - 1].x);
        const dy = Math.abs(path[i].y - path[i - 1].y);
        expect(dx + dy).toBe(32);
    }
}

// Cases that every algorithm should pass regardless of optimality guarantees.
export const sharedCases: ParametrizedCase[] = [
    {
        name: "happy path: straight corridor",
        run: async (algo) => {
            const grid = parseGrid(`S...E`);
            const fakes = installFakes(grid.map);
            try {
                const result = await algo(grid.start, grid.end, 10);
                expect(result.success).toBe(true);
                const tileKeys = new Set(grid.tiles.map(coordKey));
                assertValidWalk(result.path, tileKeys, grid.start, grid.end);
                expect(result.path.length).toBe(5);
            } finally {
                fakes.dispose();
            }
        },
    },
    {
        name: "no path: disconnected components",
        run: async (algo) => {
            const grid = parseGrid(`
                S.#.E
            `);
            const fakes = installFakes(grid.map);
            try {
                const result = await algo(grid.start, grid.end, 10);
                expect(result.success).toBe(false);
                expect(result.path).toEqual([]);
            } finally {
                fakes.dispose();
            }
        },
    },
    {
        name: "branching: Y-junction yields a valid path",
        run: async (algo) => {
            // Two-lane bypass: both routes reach E.
            const grid = parseGrid(`
                S...#
                .#..#
                ....E
            `);
            const fakes = installFakes(grid.map);
            try {
                const result = await algo(grid.start, grid.end, 10);
                expect(result.success).toBe(true);
                const tileKeys = new Set(grid.tiles.map(coordKey));
                assertValidWalk(result.path, tileKeys, grid.start, grid.end);
            } finally {
                fakes.dispose();
            }
        },
    },
    {
        name: "same start and end",
        run: async (algo) => {
            const grid = parseGrid(`S...E`);
            const fakes = installFakes(grid.map);
            try {
                const result = await algo(grid.start, grid.start, 10);
                expect(result.success).toBe(true);
                expect(result.path).toEqual([grid.start]);
            } finally {
                fakes.dispose();
            }
        },
    },
    {
        name: "invalid endpoint: start not on a path",
        run: async (algo) => {
            const grid = parseGrid(`S...E`);
            const fakes = installFakes(grid.map);
            try {
                const offGrid: CoordsXYZ = { x: 10000, y: 10000, z: 0 };
                const result = await algo(offGrid, grid.end, 10);
                expect(result.success).toBe(false);
                expect(result.path).toEqual([]);
            } finally {
                fakes.dispose();
            }
        },
    },
    {
        name: "invalid endpoint: end not on a path",
        run: async (algo) => {
            const grid = parseGrid(`S...E`);
            const fakes = installFakes(grid.map);
            try {
                const offGrid: CoordsXYZ = { x: 10000, y: 10000, z: 0 };
                const result = await algo(grid.start, offGrid, 10);
                expect(result.success).toBe(false);
                expect(result.path).toEqual([]);
            } finally {
                fakes.dispose();
            }
        },
    },
];

// Cases that exercise the per-tick budget loop. JPS+ runs synchronously on a
// precomputed graph (single tick), so it doesn't share these.
export const tickYieldingCases: ParametrizedCase[] = [
    {
        name: "budget resume: zero-budget tick still completes across ticks",
        run: async (algo) => {
            // Long corridor: S + 12 dots + E = 14 tiles total.
            const grid = parseGrid(`S............E`);
            const fakes = installFakes(grid.map);
            try {
                const result = await algo(grid.start, grid.end, 0);
                expect(result.success).toBe(true);
                expect(result.path.length).toBe(14);
                expect(result.ticks).toBeGreaterThan(1);
            } finally {
                fakes.dispose();
            }
        },
    },
];

// Optimal-path cases: only algorithms that guarantee shortest path should use.
export const optimalCases: ParametrizedCase[] = [
    {
        name: "branching: picks the shorter route",
        run: async (algo) => {
            // Top route length 5; bottom route length 7.
            const grid = parseGrid(`
                S...E
                .#.#.
                .....
            `);
            const fakes = installFakes(grid.map);
            try {
                const result = await algo(grid.start, grid.end, 10);
                expect(result.success).toBe(true);
                expect(result.path.length).toBe(5);
            } finally {
                fakes.dispose();
            }
        },
    },
    {
        name: "obstacle detour: finds shortest path around a wall",
        run: async (algo) => {
            // Column 2 is blocked at rows 0 and 1; must route through row 2.
            const grid = parseGrid(`
                S.#..
                ..#..
                ....E
            `);
            const fakes = installFakes(grid.map);
            try {
                const result = await algo(grid.start, grid.end, 10);
                expect(result.success).toBe(true);
                // Manhattan distance = 4+2 = 6 edges → 7-tile path inclusive.
                expect(result.path.length).toBe(7);
            } finally {
                fakes.dispose();
            }
        },
    },
    {
        name: "maze: routes through single viable corridor",
        run: async (algo) => {
            // Wall with a single gap forces the optimal path length.
            const grid = parseGrid(`
                S.#..
                ..#..
                ..#..
                .....
                ....E
            `);
            const fakes = installFakes(grid.map);
            try {
                const result = await algo(grid.start, grid.end, 10);
                expect(result.success).toBe(true);
                // S(0,0) → (1,0)(1,1)(1,2)(1,3) → (2,3)(3,3)(4,3) → (4,4)=E
                // = 9 tiles
                expect(result.path.length).toBe(9);
            } finally {
                fakes.dispose();
            }
        },
    },
];

import { describe, it, expect } from "vitest";
import { guidePeeps, guidePeep, planPeepPaths, peepFootpathTile } from "../src/guide";
import { JunctionGraph } from "../src/graph";
import { parseGrid, installFakes, makeFakePeep } from "./harness";

function coordKey(p: CoordsXYZ): string {
    return `${p.x},${p.y},${p.z}`;
}

describe("peepFootpathTile", () => {
    it("snaps a peep to the footpath tile at its feet", () => {
        const grid = parseGrid(`S...E`);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, { x: 2 * 32, y: 0, z: 0 });
            const tile = peepFootpathTile(peep);
            expect(tile).toEqual({ x: 64, y: 0, z: 0 });
        } finally {
            fakes.dispose();
        }
    });

    it("returns null when the peep is not on a footpath", () => {
        const grid = parseGrid(`S...E`);
        const fakes = installFakes(grid.map);
        try {
            // y=32 row has no footpaths in this grid.
            const peep = makeFakePeep(1, { x: 0, y: 32, z: 0 });
            const tile = peepFootpathTile(peep);
            expect(tile).toBeNull();
        } finally {
            fakes.dispose();
        }
    });
});

describe("planPeepPaths", () => {
    it("plans a path for every peep on the same component as dest", async () => {
        const grid = parseGrid(`S....E`);
        const fakes = installFakes(grid.map);
        try {
            const peeps = [0, 1, 2, 3].map((i) =>
                makeFakePeep(i, { x: i * 32, y: 0, z: 0 }),
            );
            const plans = await planPeepPaths(peeps, grid.end, { graph: new JunctionGraph() });
            expect(plans).toHaveLength(4);
            for (const p of plans) {
                expect(p.status).toBe("ok");
                expect(p.path![p.path!.length - 1]).toEqual(grid.end);
            }
            expect(plans[0].path!.length).toBe(6); // 0,0 -> 5,0
            expect(plans[3].path!.length).toBe(3); // 3,0 -> 5,0
        } finally {
            fakes.dispose();
        }
    });

    it("marks peeps on a different component as no-path", async () => {
        // Two islands: left S-block and right E-block, separated by #.
        const grid = parseGrid(`S..#..E`);
        const fakes = installFakes(grid.map);
        try {
            const destPeep = makeFakePeep(1, grid.start); // on island A
            const otherPeep = makeFakePeep(2, grid.end);  // on island B
            const plans = await planPeepPaths([destPeep, otherPeep], grid.end, { graph: new JunctionGraph() });
            // dest is grid.end, on island B.
            // destPeep (on A) has no path to B.
            expect(plans[0].status).toBe("no-path");
            // otherPeep stands at dest.
            expect(plans[1].status).toBe("ok");
            expect(plans[1].path).toEqual([grid.end]);
        } finally {
            fakes.dispose();
        }
    });

    it("marks peeps off the footpath as no-start", async () => {
        const grid = parseGrid(`S...E`);
        const fakes = installFakes(grid.map);
        try {
            const onPath = makeFakePeep(1, grid.start);
            const offPath = makeFakePeep(2, { x: 0, y: 32, z: 0 }); // no footpath at y=32
            const plans = await planPeepPaths([onPath, offPath], grid.end, { graph: new JunctionGraph() });
            expect(plans[0].status).toBe("ok");
            expect(plans[1].status).toBe("no-start");
        } finally {
            fakes.dispose();
        }
    });

    it("respects one-way banners in path computation", async () => {
        const grid = parseGrid(`
            S.E
            banners:
            0,0 > 1,0
        `);
        const fakes = installFakes(grid.map);
        try {
            const peepFwd = makeFakePeep(1, grid.start);
            const peepRev = makeFakePeep(2, grid.end);
            const fwd = await planPeepPaths([peepFwd], grid.end, { graph: new JunctionGraph() });
            const rev = await planPeepPaths([peepRev], grid.start, { graph: new JunctionGraph() });
            expect(fwd[0].status).toBe("ok");
            expect(rev[0].status).toBe("no-path");
        } finally {
            fakes.dispose();
        }
    });

    it("produces optimal paths on a Y-junction (matches direct tile walk)", async () => {
        const grid = parseGrid(`
            S....
            ..#..
            E.#..
        `);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, grid.start);
            const plans = await planPeepPaths([peep], grid.end, { graph: new JunctionGraph() });
            expect(plans[0].status).toBe("ok");
            const path = plans[0].path!;
            expect(path[0]).toEqual(grid.start);
            expect(path[path.length - 1]).toEqual(grid.end);
            // Start (0,0) to end (0,2). Shortest walk goes straight down
            // the left column: 0,0 -> 0,1 -> 0,2 = 3 tiles.
            expect(path.length).toBe(3);
        } finally {
            fakes.dispose();
        }
    });

    it("handles peep standing at dest with a single-tile path", async () => {
        const grid = parseGrid(`S....E`);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, grid.end);
            const plans = await planPeepPaths([peep], grid.end, { graph: new JunctionGraph() });
            expect(plans[0].status).toBe("ok");
            expect(plans[0].path).toEqual([grid.end]);
        } finally {
            fakes.dispose();
        }
    });

    it("walks a corridor directly when peep and dest share the same edge", async () => {
        // Straight line with two dead-end junctions at the ends. Peep starts
        // mid-corridor at tile 2, dest is mid-corridor at tile 4.
        const grid = parseGrid(`S.....E`);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, { x: 2 * 32, y: 0, z: 0 });
            const dest: CoordsXYZ = { x: 4 * 32, y: 0, z: 0 };
            const plans = await planPeepPaths([peep], dest, { graph: new JunctionGraph() });
            expect(plans[0].status).toBe("ok");
            // Direct walk: (2,0), (3,0), (4,0) = 3 tiles. No junction detour.
            expect(plans[0].path!.length).toBe(3);
            expect(plans[0].path![0]).toEqual({ x: 64, y: 0, z: 0 });
            expect(plans[0].path![2]).toEqual(dest);
        } finally {
            fakes.dispose();
        }
    });

    it("reuses one reverse Dijkstra for many peeps", async () => {
        // 20 peeps all heading to the same dest. Verify each gets an ok plan.
        const grid = parseGrid(`S..................E`);
        const fakes = installFakes(grid.map);
        try {
            const peeps = [];
            for (let i = 0; i < 20; i++) peeps.push(makeFakePeep(i, { x: i * 32, y: 0, z: 0 }));
            const plans = await planPeepPaths(peeps, grid.end, { graph: new JunctionGraph() });
            expect(plans).toHaveLength(20);
            for (const p of plans) {
                expect(p.status).toBe("ok");
                expect(p.path![p.path!.length - 1]).toEqual(grid.end);
            }
        } finally {
            fakes.dispose();
        }
    });

    it("yields across ticks under a tight budget", async () => {
        const grid = parseGrid(`S..................E`);
        const fakes = installFakes(grid.map);
        try {
            let yieldCalls = 0;
            const origSetTimeout = fakes.context.setTimeout;
            fakes.context.setTimeout = (cb, d) => {
                yieldCalls++;
                return origSetTimeout(cb, d);
            };
            const peeps = [];
            for (let i = 0; i < 5; i++) peeps.push(makeFakePeep(i, { x: i * 32, y: 0, z: 0 }));
            const plans = await planPeepPaths(peeps, grid.end, { budgetMs: 0, graph: new JunctionGraph() });
            expect(plans.every((p) => p.status === "ok")).toBe(true);
            expect(yieldCalls).toBeGreaterThan(0);
        } finally {
            fakes.dispose();
        }
    });
});

describe("guidePeeps", () => {
    it("reports no-start / no-path via onPeepResult and summary", async () => {
        const grid = parseGrid(`S..#..E`);
        const fakes = installFakes(grid.map);
        try {
            const otherIsland = makeFakePeep(1, grid.start);
            const offPath = makeFakePeep(2, { x: 0, y: 32, z: 0 });
            const results: Array<{ id: number; status: string }> = [];
            const summary = await guidePeeps([otherIsland, offPath], grid.end, {
                graph: new JunctionGraph(),
                onPeepResult: (peep, r) => results.push({ id: peep.id!, status: r.status }),
            });
            expect(summary.noPath).toBe(1);
            expect(summary.noStart).toBe(1);
            expect(summary.dispatched).toBe(0);
            expect(results.find((r) => r.id === 1)!.status).toBe("no-path");
            expect(results.find((r) => r.id === 2)!.status).toBe("no-start");
        } finally {
            fakes.dispose();
        }
    });

    it("reports immediate arrival when peep stands on dest", async () => {
        const grid = parseGrid(`S....E`);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, grid.end);
            const results: string[] = [];
            const summary = await guidePeeps([peep], grid.end, {
                graph: new JunctionGraph(),
                onPeepResult: (_p, r) => results.push(r.status),
            });
            expect(summary.arrived).toBe(1);
            expect(summary.dispatched).toBe(0);
            expect(results).toEqual(["arrived"]);
        } finally {
            fakes.dispose();
        }
    });

    it("dispatches peeps with a valid path", async () => {
        const grid = parseGrid(`S....E`);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, grid.start);
            // Walk each tick; after enough ticks peep reaches dest.
            // simulate movement by snapping x,y to next waypoint each tick.
            fakes.context.__fireTick; // ensure wired
            // Start guidePeeps (don't await — we need to fire ticks in between).
            const promise = guidePeeps([peep], grid.end, { graph: new JunctionGraph() });
            // Let the async planning resolve (multiple awaits + microtask hops).
            for (let i = 0; i < 100; i++) await Promise.resolve();
            // Simulate peep movement: on each tick, advance peep to destination.
            for (let t = 0; t < 10; t++) {
                // Teleport peep to its current destination so the guide thinks
                // the waypoint was reached.
                peep.x = peep.destination.x;
                peep.y = peep.destination.y;
                fakes.context.__fireTick();
                if (peep.x === grid.end.x + 16 && peep.y === grid.end.y + 16) break;
            }
            const summary = await promise;
            expect(summary.dispatched).toBe(1);
            expect(summary.arrived).toBe(1);
        } finally {
            fakes.dispose();
        }
    });

    it("cancels mid-batch via cancelToken", async () => {
        const grid = parseGrid(`S....E`);
        const fakes = installFakes(grid.map);
        try {
            const peeps = [1, 2, 3].map((i) => makeFakePeep(i, grid.start));
            const token = { cancelled: true };
            const results: string[] = [];
            const summary = await guidePeeps(peeps, grid.end, {
                graph: new JunctionGraph(),
                cancelToken: token,
                onPeepResult: (_p, r) => results.push(r.status),
            });
            expect(summary.dispatched).toBe(0);
            expect(summary.cancelled).toBe(3);
            expect(results).toEqual(["cancelled", "cancelled", "cancelled"]);
        } finally {
            fakes.dispose();
        }
    });
});

describe("guidePeep stuck detection", () => {
    // A straight 5-tile corridor is enough to exercise multiple waypoints.
    const corridor = `S....E`;

    it("never fires stuck while the peep makes progress every tick", async () => {
        const grid = parseGrid(corridor);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, grid.start);
            const path: CoordsXYZ[] = [
                { x: 0, y: 0, z: 0 },
                { x: 32, y: 0, z: 0 },
                { x: 64, y: 0, z: 0 },
            ];
            const promise = guidePeep(peep, path);
            // Step the peep 4 px closer to its current destination each tick.
            // Arrival threshold is 5 px, so ~4 ticks per waypoint -> 8 ticks total.
            for (let t = 0; t < 30; t++) {
                const dx = peep.destination.x - peep.x;
                const dy = peep.destination.y - peep.y;
                const dist = Math.hypot(dx, dy);
                if (dist > 0) {
                    peep.x += Math.round((dx / dist) * 4);
                    peep.y += Math.round((dy / dist) * 4);
                }
                fakes.context.__fireTick();
            }
            const result = await promise;
            expect(result.status).toBe("arrived");
        } finally {
            fakes.dispose();
        }
    });

    it("fires stuck at noProgressTimeoutTicks when the peep never moves", async () => {
        const grid = parseGrid(corridor);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, grid.start);
            const path: CoordsXYZ[] = [
                { x: 0, y: 0, z: 0 },
                { x: 32, y: 0, z: 0 },
            ];
            const promise = guidePeep(peep, path, { noProgressTimeoutTicks: 5 });
            // Peep doesn't move. After 5 no-progress ticks, stuck fires.
            for (let t = 0; t < 20; t++) fakes.context.__fireTick();
            const result = await promise;
            expect(result.status).toBe("stuck");
            // First tick establishes lastDist; ticks 2..6 count as no-progress;
            // stuck fires on the tick that crosses > 5.
            expect(result.elapsedTicks).toBeGreaterThanOrEqual(6);
            expect(result.elapsedTicks).toBeLessThanOrEqual(7);
        } finally {
            fakes.dispose();
        }
    });

    it("resets the no-progress counter when the peep makes progress again", async () => {
        const grid = parseGrid(corridor);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, grid.start);
            const path: CoordsXYZ[] = [
                { x: 0, y: 0, z: 0 },
                { x: 32, y: 0, z: 0 },
            ];
            const promise = guidePeep(peep, path, { noProgressTimeoutTicks: 5 });

            // 4 no-progress ticks (under the threshold of 5).
            for (let t = 0; t < 4; t++) fakes.context.__fireTick();

            // One big step of progress.
            peep.x += 20;
            fakes.context.__fireTick();

            // 4 more no-progress ticks — still under threshold because the
            // counter reset on the progress tick.
            for (let t = 0; t < 4; t++) fakes.context.__fireTick();

            // Finish the walk.
            for (let t = 0; t < 10; t++) {
                const dx = peep.destination.x - peep.x;
                if (dx !== 0) peep.x += Math.sign(dx) * 4;
                fakes.context.__fireTick();
            }
            const result = await promise;
            expect(result.status).toBe("arrived");
        } finally {
            fakes.dispose();
        }
    });

    it("honours the absolute waypointTimeoutTicks cap even on slow progress", async () => {
        const grid = parseGrid(corridor);
        const fakes = installFakes(grid.map);
        try {
            const peep = makeFakePeep(1, grid.start);
            const path: CoordsXYZ[] = [
                { x: 0, y: 0, z: 0 },
                { x: 200, y: 0, z: 0 },   // Far waypoint so we don't reach it.
            ];
            const promise = guidePeep(peep, path, {
                waypointTimeoutTicks: 10,
                noProgressTimeoutTicks: 1000, // Effectively disabled.
            });
            // Move 2 px per tick toward the target — always forward progress,
            // so the no-progress counter never fires. The waypoint cap must.
            for (let t = 0; t < 30; t++) {
                peep.x += 2;
                fakes.context.__fireTick();
            }
            const result = await promise;
            expect(result.status).toBe("stuck");
            expect(result.elapsedTicks).toBeGreaterThanOrEqual(10);
            expect(result.elapsedTicks).toBeLessThanOrEqual(12);
        } finally {
            fakes.dispose();
        }
    });
});

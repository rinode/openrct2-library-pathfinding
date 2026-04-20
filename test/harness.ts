// Test harness for pathfinding algorithms.
//
// Installs fake `map` and `context` globals so algorithms that depend on the
// OpenRCT2 plugin API can run under Node / Vitest. Provides a grid DSL for
// writing terse, readable tile-layout fixtures.

type FakePathNavigator = {
    getConnectedPaths(): { position: CoordsXYZ }[];
};

type FakeMap = {
    getPathNavigator(pos: CoordsXYZ): FakePathNavigator | null;
};

type ActionListener = (e: { action: string; result: { error: number } }) => void;

type FakeContext = {
    setTimeout(cb: () => void, _delay: number): number;
    subscribe(hook: "action.execute", cb: ActionListener): IDisposable;
    // Test-only helpers
    __flushTimers(): void;
    __fireAction(action: string, error?: number): void;
};

export interface Grid {
    start: CoordsXYZ;
    end: CoordsXYZ;
    tiles: CoordsXYZ[];
    map: FakeMap;
}

// Grid DSL legend:
//   '.' = path tile
//   '#' = no path (blocked)
//   'S' = start (also a path tile)
//   'E' = end (also a path tile)
// One char per tile. Rows separated by newlines.
// Leading whitespace per line is trimmed so test strings can be indented.
//
// Optional: one-way directed edges can be declared after the grid using a
// `>` / `<` / `^` / `v` marker in a `banners:` block (see parseGrid below).
export function parseGrid(raw: string): Grid {
    const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

    // Strip optional `banners:` block.
    const bannerStartIdx = lines.findIndex((l) => l.startsWith("banners:"));
    const gridLines = bannerStartIdx === -1 ? lines : lines.slice(0, bannerStartIdx);
    const bannerLines = bannerStartIdx === -1 ? [] : lines.slice(bannerStartIdx + 1);

    const height = gridLines.length;
    const width = Math.max(...gridLines.map((l) => l.length));

    const tiles: CoordsXYZ[] = [];
    const tileSet = new Set<string>();
    let start: CoordsXYZ | null = null;
    let end: CoordsXYZ | null = null;

    for (let y = 0; y < height; y++) {
        const row = gridLines[y];
        for (let x = 0; x < width; x++) {
            const ch = row[x] ?? "#";
            if (ch === "#") continue;
            const pos: CoordsXYZ = { x: x * 32, y: y * 32, z: 0 };
            tiles.push(pos);
            tileSet.add(key(pos));
            if (ch === "S") start = pos;
            else if (ch === "E") end = pos;
        }
    }

    if (!start) throw new Error("Grid has no 'S' start marker");
    if (!end) throw new Error("Grid has no 'E' end marker");

    // Banner lines: "x1,y1 > x2,y2" means only x1,y1 → x2,y2 is allowed.
    // The reverse edge is forbidden.
    const blockedEdges = new Set<string>(); // "fromKey -> toKey"
    for (const line of bannerLines) {
        const m = line.match(/^(\d+),(\d+)\s*>\s*(\d+),(\d+)$/);
        if (!m) continue;
        const from: CoordsXYZ = { x: +m[1] * 32, y: +m[2] * 32, z: 0 };
        const to: CoordsXYZ = { x: +m[3] * 32, y: +m[4] * 32, z: 0 };
        // Block the reverse edge (to → from).
        blockedEdges.add(`${key(to)}->${key(from)}`);
    }

    const map: FakeMap = {
        getPathNavigator(pos) {
            if (!tileSet.has(key(pos))) return null;
            return {
                getConnectedPaths() {
                    const neighbors: { position: CoordsXYZ }[] = [];
                    const deltas = [
                        { x: 32, y: 0 },
                        { x: -32, y: 0 },
                        { x: 0, y: 32 },
                        { x: 0, y: -32 },
                    ];
                    for (const d of deltas) {
                        const n: CoordsXYZ = { x: pos.x + d.x, y: pos.y + d.y, z: 0 };
                        if (!tileSet.has(key(n))) continue;
                        if (blockedEdges.has(`${key(pos)}->${key(n)}`)) continue;
                        neighbors.push({ position: n });
                    }
                    return neighbors;
                },
            };
        },
    };

    return { start, end, tiles, map };
}

function key(p: CoordsXYZ): string {
    return `${p.x},${p.y},${p.z}`;
}

// Install fake globals for one test. Returns a disposer that restores originals.
export function installFakes(map: FakeMap): { context: FakeContext; dispose: () => void } {
    const pendingTimers: Array<() => void> = [];
    const actionListeners: ActionListener[] = [];

    const context: FakeContext = {
        setTimeout(cb) {
            pendingTimers.push(cb);
            // Schedule one microtask hop per callback so each one yields back
            // to the event loop. If a callback re-schedules itself with no
            // forward progress (a bug), the harness still releases the CPU
            // and the test runner can time out instead of freezing the host.
            queueMicrotask(() => {
                const fn = pendingTimers.shift();
                if (fn) fn();
            });
            return 0;
        },
        subscribe(_hook, cb) {
            actionListeners.push(cb);
            return {
                dispose() {
                    const i = actionListeners.indexOf(cb);
                    if (i >= 0) actionListeners.splice(i, 1);
                },
            };
        },
        __flushTimers() {
            while (pendingTimers.length > 0) {
                pendingTimers.shift()!();
            }
        },
        __fireAction(action, error = 0) {
            for (const l of actionListeners) l({ action, result: { error } });
        },
    };

    const g = globalThis as unknown as { map: FakeMap; context: FakeContext };
    const prevMap = g.map;
    const prevCtx = g.context;
    g.map = map;
    g.context = context;

    return {
        context,
        dispose() {
            g.map = prevMap;
            g.context = prevCtx;
        },
    };
}

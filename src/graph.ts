// Junction graph for footpath networks.
//
// Runs of degree-2 tiles collapse into a single edge labeled with corridor
// length. Search then runs on the compressed graph instead of tile-by-tile,
// which is much faster on sparse networks with long corridors.
//
// Callers can pass a JunctionGraph to A*/Dijkstra/BFS/Greedy via
// options.graph; JPS+ uses one unconditionally.
//
// The module-level default graph auto-invalidates when any path- or
// banner-mutating action executes successfully. Call invalidateGraph() to
// force a rebuild manually.

import { PathfindingResult } from "./types";
import { coordKey, heuristic, noPathResult } from "./utils";

export interface CorridorEdge {
    /** coordKey of the destination junction. */
    toKey: string;
    /** Number of tile hops from source junction to destination junction. */
    length: number;
    /** Tile sequence from the tile immediately after the source up to and including the destination. */
    tilesFromSource: CoordsXYZ[];
}

export interface JunctionNode {
    pos: CoordsXYZ;
    edges: CorridorEdge[];
}

export class JunctionGraph {
    private nodes = new Map<string, JunctionNode>();
    /** Every tile in a built component → coordKey of one bordering junction (or itself). */
    private tileToComponent = new Map<string, string>();
    /** For mid-corridor tiles: both bordering junctions and the tile's offset from source. */
    private corridorIndex = new Map<string, { sourceKey: string; edge: CorridorEdge; offset: number }>();
    private builtSeeds = new Set<string>();

    get junctionCount(): number {
        return this.nodes.size;
    }

    has(pos: CoordsXYZ): boolean {
        return this.tileToComponent.has(coordKey(pos));
    }

    getNode(key: string): JunctionNode | undefined {
        return this.nodes.get(key);
    }

    getJunctionPositions(): CoordsXYZ[] {
        const out: CoordsXYZ[] = [];
        for (const node of this.nodes.values()) out.push(node.pos);
        return out;
    }

    /** Returns the corridor index info (used for path reconstruction). */
    getCorridorInfo(pos: CoordsXYZ): { sourceKey: string; edge: CorridorEdge; offset: number } | undefined {
        return this.corridorIndex.get(coordKey(pos));
    }

    invalidate(): void {
        this.nodes.clear();
        this.tileToComponent.clear();
        this.corridorIndex.clear();
        this.builtSeeds.clear();
    }

    /**
     * Flood-fill the component reachable from `seed` and build its junction
     * graph. Yields to the game loop when the per-tick budget is exceeded.
     * No-op if the component has already been built.
     */
    async buildComponentFrom(seed: CoordsXYZ, budgetMs: number = 4): Promise<void> {
        const seedKey = coordKey(seed);
        if (this.builtSeeds.has(seedKey) || this.tileToComponent.has(seedKey)) return;

        const seedNav = map.getPathNavigator(seed);
        if (!seedNav) return;

        const budget = new TickBudget(budgetMs);

        // Phase 1: discover every tile in the component and record its
        // outgoing connections.
        const tiles = new Map<string, { pos: CoordsXYZ; outgoing: CoordsXYZ[] }>();
        const queue: CoordsXYZ[] = [seed];
        tiles.set(seedKey, { pos: seed, outgoing: [] });

        while (queue.length > 0) {
            await budget.maybeYield();
            const pos = queue.shift()!;
            const k = coordKey(pos);
            const nav = map.getPathNavigator(pos);
            if (!nav) continue;
            const outgoing: CoordsXYZ[] = [];
            for (const c of nav.getConnectedPaths()) {
                outgoing.push(c.position);
                const nk = coordKey(c.position);
                if (!tiles.has(nk)) {
                    tiles.set(nk, { pos: c.position, outgoing: [] });
                    queue.push(c.position);
                }
            }
            tiles.get(k)!.outgoing = outgoing;
        }

        // Phase 2: classify junctions. A tile is a junction if its degree
        // isn't 2, or if any neighbor doesn't list it back (one-way banner).
        const junctionKeys = new Set<string>();
        let n = 0;
        for (const [k, info] of tiles) {
            if ((n++ & 0xFF) === 0) await budget.maybeYield();
            if (info.outgoing.length !== 2) {
                junctionKeys.add(k);
                continue;
            }
            for (const neighbor of info.outgoing) {
                const nInfo = tiles.get(coordKey(neighbor));
                if (!nInfo || !nInfo.outgoing.some((o) => coordKey(o) === k)) {
                    junctionKeys.add(k);
                    break;
                }
            }
        }

        // A closed loop of degree-2 tiles has no junctions. Pick the seed
        // so we have somewhere to anchor the search.
        if (junctionKeys.size === 0 && tiles.size > 0) {
            junctionKeys.add(seedKey);
        }

        // Phase 3: from each junction, walk each outgoing direction until we
        // hit another junction, and record the directed corridor edge.
        for (const jKey of junctionKeys) {
            await budget.maybeYield();
            const info = tiles.get(jKey)!;
            const node: JunctionNode = { pos: info.pos, edges: [] };
            for (const firstNeighbor of info.outgoing) {
                const tilesFromSource: CoordsXYZ[] = [];
                let prev: CoordsXYZ = info.pos;
                let curr: CoordsXYZ = firstNeighbor;
                let safety = tiles.size + 1;
                while (safety-- > 0) {
                    tilesFromSource.push(curr);
                    const cKey = coordKey(curr);
                    if (junctionKeys.has(cKey)) break;
                    const cInfo = tiles.get(cKey);
                    if (!cInfo) break;
                    const forward = cInfo.outgoing.find((nn) => coordKey(nn) !== coordKey(prev));
                    if (!forward) break;
                    prev = curr;
                    curr = forward;
                }
                const last = tilesFromSource[tilesFromSource.length - 1];
                const toKey = coordKey(last);
                node.edges.push({ toKey, length: tilesFromSource.length, tilesFromSource });
            }
            this.nodes.set(jKey, node);
        }

        // Phase 4: index every tile in the component.
        n = 0;
        for (const k of tiles.keys()) {
            if ((n++ & 0xFF) === 0) await budget.maybeYield();
            this.tileToComponent.set(k, junctionKeys.has(k) ? k : seedKey);
        }
        for (const [jKey, jNode] of this.nodes) {
            await budget.maybeYield();
            for (const edge of jNode.edges) {
                for (let i = 0; i < edge.tilesFromSource.length - 1; i++) {
                    const t = edge.tilesFromSource[i];
                    const tk = coordKey(t);
                    // The reverse edge may index the same tile. Keep the first
                    // entry; path reconstruction handles either orientation.
                    if (!this.corridorIndex.has(tk)) {
                        this.corridorIndex.set(tk, { sourceKey: jKey, edge, offset: i + 1 });
                    }
                }
            }
        }

        this.builtSeeds.add(seedKey);
    }
}

class TickBudget {
    private deadline: number;
    constructor(private budgetMs: number) {
        this.deadline = Date.now() + budgetMs;
    }
    maybeYield(): Promise<void> | void {
        if (Date.now() < this.deadline) return;
        return new Promise<void>((resolve) => {
            context.setTimeout(() => {
                this.deadline = Date.now() + this.budgetMs;
                resolve();
            }, 0);
        });
    }
}

// Module-level singleton + auto-invalidation.

let defaultGraph: JunctionGraph | null = null;
let actionSubscription: IDisposable | null = null;

const PATH_MUTATING_ACTIONS = new Set<string>([
    "footpathplace",
    "footpathremove",
    "footpathlayoutplace",
    "footpathadditionplace",
    "footpathadditionremove",
    "bannerplace",
    "bannerremove",
]);

function ensureSubscription(): void {
    if (actionSubscription !== null) return;
    if (typeof context === "undefined" || !context.subscribe) return;
    actionSubscription = context.subscribe("action.execute", (e: GameActionEventArgs) => {
        if (e.result.error === 0 && PATH_MUTATING_ACTIONS.has(e.action)) {
            defaultGraph?.invalidate();
        }
    });
}

/** Returns the shared module-level graph, creating it (and the action subscription) on first use. */
export function getDefaultGraph(): JunctionGraph {
    if (!defaultGraph) defaultGraph = new JunctionGraph();
    ensureSubscription();
    return defaultGraph;
}

/** Convenience: build (or refresh) the component containing `seed` on the default graph. */
export async function buildGraph(seed: CoordsXYZ, budgetMs: number = 4): Promise<JunctionGraph> {
    const g = getDefaultGraph();
    await g.buildComponentFrom(seed, budgetMs);
    return g;
}

/** Clear the default graph. Forces a rebuild on the next query. */
export function invalidateGraph(): void {
    defaultGraph?.invalidate();
}

// Search on the compressed junction graph.
//
// If start or end is mid-corridor, we split its corridor and connect through
// both bordering junctions. The returned path is always expanded tile-by-tile
// so callers (e.g. guidePeep) don't need to know the graph exists.

interface JunctionSearchNode {
    junctionKey: string;
    g: number;
    f: number;
    parent: JunctionSearchNode | null;
    /** The edge taken from parent.junctionKey to junctionKey (for tile reconstruction). */
    edgeFromParent: CorridorEdge | null;
}

interface SearchOptions {
    /** Cost weight applied to remaining-distance heuristic. 0 = uniform-cost (Dijkstra/BFS), 1 = A*, ∞ = greedy. */
    heuristicWeight: number;
    /** Use g+h ordering (true) or h-only (false, greedy). */
    useG: boolean;
}

async function astarLikeOnGraph(
    start: CoordsXYZ,
    end: CoordsXYZ,
    graph: JunctionGraph,
    budgetMs: number,
    opts: SearchOptions,
): Promise<PathfindingResult> {
    const startTime = Date.now();

    await graph.buildComponentFrom(start, budgetMs);
    await graph.buildComponentFrom(end, budgetMs);

    if (!graph.has(start) || !graph.has(end)) {
        return noPathResult();
    }

    const startKey = coordKey(start);
    const endKey = coordKey(end);

    if (startKey === endKey) {
        return { path: [start], nodesExplored: 0, success: true, elapsedMs: Date.now() - startTime, ticks: 1 };
    }

    // Resolve start/end to their bordering junctions and the partial corridor
    // segments needed to splice into the final path.
    const startAnchors = resolveAnchors(start, graph);
    const endAnchors = resolveAnchors(end, graph);
    if (!startAnchors || !endAnchors) return noPathResult();

    // If start and end sit on the same corridor edge, walking via a junction
    // would be longer than walking the corridor directly.
    const directPath = tryDirectCorridorPath(start, end, graph);
    if (directPath) {
        return {
            path: directPath,
            nodesExplored: 0,
            success: true,
            elapsedMs: Date.now() - startTime,
            ticks: 1,
        };
    }

    // Run A*-like search over the junction graph.
    const open: JunctionSearchNode[] = [];
    const gScores = new Map<string, number>();
    const closed = new Set<string>();
    let nodesExplored = 0;

    for (const anchor of startAnchors) {
        const node: JunctionSearchNode = {
            junctionKey: anchor.junctionKey,
            g: anchor.cost,
            f: anchor.cost * (opts.useG ? 1 : 0) + opts.heuristicWeight * heuristic(anchor.junctionPos, end),
            parent: null,
            edgeFromParent: null,
        };
        open.push(node);
        gScores.set(anchor.junctionKey, anchor.cost);
    }

    const endAnchorMap = new Map<string, typeof endAnchors[number]>();
    for (const a of endAnchors) endAnchorMap.set(a.junctionKey, a);

    while (open.length > 0) {
        let bestIdx = 0;
        for (let j = 1; j < open.length; j++) {
            if (open[j].f < open[bestIdx].f) bestIdx = j;
        }
        const current = open[bestIdx];
        open.splice(bestIdx, 1);

        if (closed.has(current.junctionKey)) continue;
        closed.add(current.junctionKey);
        nodesExplored++;

        const targetAnchor = endAnchorMap.get(current.junctionKey);
        if (targetAnchor) {
            const path = reconstructTilePath(current, start, end, startAnchors, targetAnchor);
            return {
                path,
                nodesExplored,
                success: true,
                elapsedMs: Date.now() - startTime,
                ticks: 1,
            };
        }

        const node = graph.getNode(current.junctionKey);
        if (!node) continue;

        for (const edge of node.edges) {
            if (closed.has(edge.toKey)) continue;
            const tentativeG = current.g + edge.length;
            const existing = gScores.get(edge.toKey);
            if (existing !== undefined && tentativeG >= existing) continue;
            gScores.set(edge.toKey, tentativeG);
            const toNode = graph.getNode(edge.toKey);
            if (!toNode) continue;
            open.push({
                junctionKey: edge.toKey,
                g: tentativeG,
                f: (opts.useG ? tentativeG : 0) + opts.heuristicWeight * heuristic(toNode.pos, end),
                parent: current,
                edgeFromParent: edge,
            });
        }
    }

    return { path: [], nodesExplored, success: false, elapsedMs: Date.now() - startTime, ticks: 1 };
}

interface AnchorInfo {
    junctionKey: string;
    junctionPos: CoordsXYZ;
    /** Tiles to walk from `start` to this junction (excluding start, including the junction). */
    prefixToJunction: CoordsXYZ[];
    /** Cost (tile hops) from start to this junction. */
    cost: number;
}

function resolveAnchors(pos: CoordsXYZ, graph: JunctionGraph): AnchorInfo[] | null {
    const k = coordKey(pos);
    const node = graph.getNode(k);
    if (node) {
        return [{ junctionKey: k, junctionPos: node.pos, prefixToJunction: [], cost: 0 }];
    }
    const info = graph.getCorridorInfo(pos);
    if (!info) return null;

    const sourceNode = graph.getNode(info.sourceKey)!;
    // Path from pos back to source: reverse the tiles before offset, then
    // append the source.
    const backTiles: CoordsXYZ[] = [];
    for (let i = info.offset - 2; i >= 0; i--) {
        backTiles.push(info.edge.tilesFromSource[i]);
    }
    backTiles.push(sourceNode.pos);

    const forwardTiles: CoordsXYZ[] = [];
    for (let i = info.offset; i < info.edge.tilesFromSource.length; i++) {
        forwardTiles.push(info.edge.tilesFromSource[i]);
    }

    const targetNode = graph.getNode(info.edge.toKey)!;

    return [
        {
            junctionKey: info.sourceKey,
            junctionPos: sourceNode.pos,
            prefixToJunction: backTiles,
            cost: info.offset,
        },
        {
            junctionKey: info.edge.toKey,
            junctionPos: targetNode.pos,
            prefixToJunction: forwardTiles,
            cost: info.edge.length - info.offset,
        },
    ];
}

function tryDirectCorridorPath(start: CoordsXYZ, end: CoordsXYZ, graph: JunctionGraph): CoordsXYZ[] | null {
    const startInfo = graph.getCorridorInfo(start);
    const endInfo = graph.getCorridorInfo(end);
    if (!startInfo || !endInfo) return null;
    if (startInfo.edge !== endInfo.edge) return null;

    // edge.tilesFromSource[offset - 1] is the tile at that offset.
    const sIdx = startInfo.offset - 1;
    const eIdx = endInfo.offset - 1;
    if (sIdx === eIdx) return [start];
    if (sIdx > eIdx) {
        // Reverse walk along a directed corridor isn't safe (one-way banner).
        // Fall back to junction search.
        return null;
    }
    const out: CoordsXYZ[] = [];
    for (let i = sIdx; i <= eIdx; i++) out.push(startInfo.edge.tilesFromSource[i]);
    return out;
}

function reconstructTilePath(
    endNode: JunctionSearchNode,
    start: CoordsXYZ,
    end: CoordsXYZ,
    startAnchors: AnchorInfo[],
    endAnchor: AnchorInfo,
): CoordsXYZ[] {
    // Walk back through the search tree to collect the junction sequence.
    const junctionSeq: JunctionSearchNode[] = [];
    let cur: JunctionSearchNode | null = endNode;
    while (cur) {
        junctionSeq.unshift(cur);
        cur = cur.parent;
    }

    const startAnchor = startAnchors.find((a) => a.junctionKey === junctionSeq[0].junctionKey)!;

    const out: CoordsXYZ[] = [start];
    for (const t of startAnchor.prefixToJunction) out.push(t);

    for (let i = 1; i < junctionSeq.length; i++) {
        const edge = junctionSeq[i].edgeFromParent!;
        for (const t of edge.tilesFromSource) out.push(t);
    }

    // Append the walk from the last junction to end. endAnchor.prefixToJunction
    // goes end -> junction, so reverse it.
    for (let i = endAnchor.prefixToJunction.length - 2; i >= 0; i--) {
        out.push(endAnchor.prefixToJunction[i]);
    }
    if (endAnchor.prefixToJunction.length > 0) out.push(end);

    // Drop consecutive duplicates (junction handoffs can repeat a tile).
    const dedup: CoordsXYZ[] = [];
    for (const p of out) {
        if (dedup.length === 0 || coordKey(dedup[dedup.length - 1]) !== coordKey(p)) {
            dedup.push(p);
        }
    }
    return dedup;
}

/**
 * Search strategy for runOnGraph. Separate from PathfindingAlgorithm:
 * this names the search behavior, not the user-facing algorithm. JPS+ maps
 * to AStar here because once the graph is built, JPS+ is A* on it.
 */
export enum GraphSearchMode {
    AStar = "astar",
    Dijkstra = "dijkstra",
    BFS = "bfs",
    Greedy = "greedy",
}

export function runOnGraph(
    start: CoordsXYZ,
    end: CoordsXYZ,
    graph: JunctionGraph,
    budgetMs: number,
    mode: GraphSearchMode,
): Promise<PathfindingResult> {
    let opts: SearchOptions;
    switch (mode) {
        case GraphSearchMode.AStar:
            opts = { heuristicWeight: 1, useG: true };
            break;
        case GraphSearchMode.Greedy:
            opts = { heuristicWeight: 1, useG: false };
            break;
        case GraphSearchMode.Dijkstra:
        case GraphSearchMode.BFS:
            opts = { heuristicWeight: 0, useG: true };
            break;
    }
    return astarLikeOnGraph(start, end, graph, budgetMs, opts);
}

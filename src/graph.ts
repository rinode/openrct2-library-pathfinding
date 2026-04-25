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

import { PathfindingResult, PathNavigationOptions } from "./types";
import { coordKey, heuristic, noPathResult, TickBudget } from "./utils";

function normalizeOptions(o?: PathNavigationOptions): PathNavigationOptions {
    return {
        respectBanners: o?.respectBanners ?? false,
        excludeGhosts: o?.excludeGhosts ?? false,
        excludeQueues: o?.excludeQueues ?? false,
        excludeWidePaths: o?.excludeWidePaths ?? false,
    };
}

function optionsEqual(a: PathNavigationOptions, b: PathNavigationOptions): boolean {
    return a.respectBanners === b.respectBanners
        && a.excludeGhosts === b.excludeGhosts
        && a.excludeQueues === b.excludeQueues
        && a.excludeWidePaths === b.excludeWidePaths;
}

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
    /** Every tile in a built component → seedKey of the component it belongs to. */
    private tileToComponent = new Map<string, string>();
    /** For mid-corridor tiles: both bordering junctions and the tile's offset from source. */
    private corridorIndex = new Map<string, { sourceKey: string; edge: CorridorEdge; offset: number }>();
    private builtSeeds = new Set<string>();
    /** Lazy: for each junction Y, the list of incoming edges (X, X→Y edge). */
    private reverseAdjCache: Map<string, Array<{ fromKey: string; edge: CorridorEdge }>> | null = null;
    /** Path navigation rules used when building this graph. Bound at construction time. */
    private readonly _options: PathNavigationOptions;

    constructor(options?: PathNavigationOptions) {
        this._options = normalizeOptions(options);
    }

    get options(): PathNavigationOptions {
        return this._options;
    }

    get junctionCount(): number {
        return this.nodes.size;
    }

    has(pos: CoordsXYZ): boolean {
        return this.tileToComponent.has(coordKey(pos));
    }

    getNode(key: string): JunctionNode | undefined {
        return this.nodes.get(key);
    }

    /** Tag identifying which component the given tile belongs to, or undefined if not indexed. */
    componentKeyOf(pos: CoordsXYZ): string | undefined {
        return this.tileToComponent.get(coordKey(pos));
    }

    /** Iterate every junction as [key, node] pairs. */
    entries(): IterableIterator<[string, JunctionNode]> {
        return this.nodes.entries();
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

    /** For each junction Y, the list of (fromKey, X→Y edge). Built once, cached until invalidation. */
    getReverseAdjacency(): Map<string, Array<{ fromKey: string; edge: CorridorEdge }>> {
        if (this.reverseAdjCache) return this.reverseAdjCache;
        const rev = new Map<string, Array<{ fromKey: string; edge: CorridorEdge }>>();
        for (const [fromKey, node] of this.nodes) {
            for (const edge of node.edges) {
                let list = rev.get(edge.toKey);
                if (!list) {
                    list = [];
                    rev.set(edge.toKey, list);
                }
                list.push({ fromKey, edge });
            }
        }
        this.reverseAdjCache = rev;
        return rev;
    }

    invalidate(): void {
        this.nodes.clear();
        this.tileToComponent.clear();
        this.corridorIndex.clear();
        this.builtSeeds.clear();
        this.reverseAdjCache = null;
    }

    /**
     * Flood-fill the component reachable from `seed` and build its junction
     * graph. Yields to the game loop when the per-tick budget is exceeded.
     * No-op if the component has already been built.
     */
    async buildComponentFrom(seed: CoordsXYZ, budgetMs: number = 4): Promise<void> {
        const seedKey = coordKey(seed);
        if (this.builtSeeds.has(seedKey) || this.tileToComponent.has(seedKey)) return;

        const seedNav = map.getPathNavigator(seed, this._options);
        if (!seedNav) return;

        const budget = new TickBudget(budgetMs);

        // Phase 1: discover every footpath tile reachable from `seed` using
        // undirected Manhattan connectivity — we want the whole weakly
        // connected network, not just tiles reachable along directed edges.
        // Record outgoing (directed) connections for later junction
        // classification.
        const tiles = new Map<string, { pos: CoordsXYZ; outgoing: CoordsXYZ[] }>();
        const queue: CoordsXYZ[] = [seed];
        tiles.set(seedKey, { pos: seed, outgoing: [] });

        while (queue.length > 0) {
            await budget.maybeYield();
            const pos = queue.shift()!;
            const k = coordKey(pos);
            const nav = map.getPathNavigator(pos, this._options);
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

            // Also enqueue any cardinally-adjacent footpath whose own
            // getConnectedPaths includes us. Our outgoing may not list them
            // back (one-way banners), but we belong to the same network.
            const cardinals = [
                { x: pos.x + 32, y: pos.y, z: pos.z },
                { x: pos.x - 32, y: pos.y, z: pos.z },
                { x: pos.x, y: pos.y + 32, z: pos.z },
                { x: pos.x, y: pos.y - 32, z: pos.z },
            ];
            for (const candidate of cardinals) {
                const candKey = coordKey(candidate);
                if (tiles.has(candKey)) continue;
                const candNav = map.getPathNavigator(candidate, this._options);
                if (!candNav) continue;
                if (candNav.getConnectedPaths().some((c) => coordKey(c.position) === k)) {
                    tiles.set(candKey, { pos: candidate, outgoing: [] });
                    queue.push(candidate);
                }
            }
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

        // Phase 4: index every tile in the component with the seedKey tag so
        // componentKeyOf(A) === componentKeyOf(B) iff A and B are in the same
        // component. Junctions and corridor tiles share the same tag.
        n = 0;
        for (const k of tiles.keys()) {
            if ((n++ & 0xFF) === 0) await budget.maybeYield();
            this.tileToComponent.set(k, seedKey);
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
        // New nodes were added; any cached reverse adjacency is stale.
        this.reverseAdjCache = null;
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

/**
 * Returns the shared module-level graph, creating it (and the action subscription) on first use.
 * If `options` is provided and differs from the cached graph's options, the
 * existing graph is replaced — the graph topology depends on which tiles are
 * traversable, so two option sets cannot share one cache.
 */
export function getDefaultGraph(options?: PathNavigationOptions): JunctionGraph {
    const desired = normalizeOptions(options);
    if (defaultGraph && !optionsEqual(defaultGraph.options, desired)) {
        defaultGraph = null;
    }
    if (!defaultGraph) defaultGraph = new JunctionGraph(desired);
    ensureSubscription();
    return defaultGraph;
}

/** Convenience: build (or refresh) the component containing `seed` on the default graph. */
export async function buildGraph(
    seed: CoordsXYZ, budgetMs: number = 4, options?: PathNavigationOptions,
): Promise<JunctionGraph> {
    const g = getDefaultGraph(options);
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

export interface AnchorInfo {
    junctionKey: string;
    junctionPos: CoordsXYZ;
    /** Tiles to walk from `start` to this junction (excluding start, including the junction). */
    prefixToJunction: CoordsXYZ[];
    /** Cost (tile hops) from start to this junction. */
    cost: number;
}

export function resolveAnchors(pos: CoordsXYZ, graph: JunctionGraph): AnchorInfo[] | null {
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

export function tryDirectCorridorPath(start: CoordsXYZ, end: CoordsXYZ, graph: JunctionGraph): CoordsXYZ[] | null {
    const startKey = coordKey(start);
    const endKey = coordKey(end);
    if (startKey === endKey) return [start];

    // Scan edges to find one that contains both start and end as tiles, with
    // start appearing earlier in the edge's source-to-destination ordering.
    // corridorIndex may point to the reverse edge for either tile, so the
    // lookup there isn't sufficient on its own.
    //
    // Edge ordering: source is position 0, tilesFromSource[i] is position i+1.
    for (const [fromKey, node] of graph.entries()) {
        for (const edge of node.edges) {
            let sPos = fromKey === startKey ? 0 : -1;
            let ePos = fromKey === endKey ? 0 : -1;
            for (let i = 0; i < edge.tilesFromSource.length; i++) {
                const tk = coordKey(edge.tilesFromSource[i]);
                if (tk === startKey) sPos = i + 1;
                if (tk === endKey) ePos = i + 1;
            }
            if (sPos < 0 || ePos < 0) continue;
            if (sPos >= ePos) continue;
            const out: CoordsXYZ[] = [start];
            for (let i = sPos; i < ePos; i++) out.push(edge.tilesFromSource[i]);
            return out;
        }
    }
    return null;
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

// Many-to-one path computation: reverse Dijkstra from a shared destination.
//
// Used by guidePeeps() to amortize N peep queries into a single graph search.
// The predecessor map produced here lets any junction in dest's component
// reconstruct its tile-by-tile path to dest in O(path length) time.

export interface DestAnchor {
    junctionKey: string;
    junctionPos: CoordsXYZ;
    /** Tile hops from this junction to dest. */
    cost: number;
    /** Tiles from the junction's first step along the anchor edge up to and including dest. */
    tailToDest: CoordsXYZ[];
}

/**
 * Find every junction that directly reaches `dest` and the cost to do so.
 * If dest is itself a junction, the only anchor is dest with cost 0.
 * Otherwise, scan edges that pass through dest (at most two, for two-way corridors).
 */
export function resolveDestAnchors(dest: CoordsXYZ, graph: JunctionGraph): DestAnchor[] {
    const destKey = coordKey(dest);
    const directNode = graph.getNode(destKey);
    if (directNode) {
        return [{ junctionKey: destKey, junctionPos: directNode.pos, cost: 0, tailToDest: [] }];
    }
    const anchors: DestAnchor[] = [];
    for (const [fromKey, node] of graph.entries()) {
        for (const edge of node.edges) {
            for (let i = 0; i < edge.tilesFromSource.length; i++) {
                if (coordKey(edge.tilesFromSource[i]) === destKey) {
                    anchors.push({
                        junctionKey: fromKey,
                        junctionPos: node.pos,
                        cost: i + 1,
                        tailToDest: edge.tilesFromSource.slice(0, i + 1),
                    });
                    break;
                }
            }
        }
    }
    return anchors;
}

export interface PredecessorEntry {
    /** Tile hops from this junction to dest. */
    distToDest: number;
    /** Next junction on the way to dest; empty string for terminal (direct-anchor) junctions. */
    nextKey: string;
    /** The forward edge from this junction to nextKey. null for terminal anchors. */
    forwardEdge: CorridorEdge | null;
    /** For terminal anchors: pre-computed tail tiles from this junction's first step to dest. */
    tailToDest: CoordsXYZ[] | null;
}

class MinHeap<T> {
    private data: T[] = [];
    constructor(private cmp: (a: T, b: T) => number) {}
    get size(): number { return this.data.length; }
    push(v: T): void {
        this.data.push(v);
        this.bubbleUp(this.data.length - 1);
    }
    pop(): T | undefined {
        if (this.data.length === 0) return undefined;
        const top = this.data[0];
        const last = this.data.pop()!;
        if (this.data.length > 0) {
            this.data[0] = last;
            this.sinkDown(0);
        }
        return top;
    }
    private bubbleUp(i: number): void {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.cmp(this.data[i], this.data[p]) >= 0) return;
            [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
            i = p;
        }
    }
    private sinkDown(i: number): void {
        const n = this.data.length;
        while (true) {
            const l = i * 2 + 1;
            const r = l + 1;
            let smallest = i;
            if (l < n && this.cmp(this.data[l], this.data[smallest]) < 0) smallest = l;
            if (r < n && this.cmp(this.data[r], this.data[smallest]) < 0) smallest = r;
            if (smallest === i) return;
            [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
            i = smallest;
        }
    }
}

/**
 * Reverse Dijkstra from dest anchors over the junction graph. Returns a
 * predecessor map covering every junction that can reach dest. Cost = total
 * tile hops. Tick-distributed via the shared budget.
 */
export async function reverseDijkstraFromDest(
    graph: JunctionGraph,
    destAnchors: DestAnchor[],
    budgetMs: number = 2,
    cancelToken?: { readonly cancelled: boolean },
): Promise<Map<string, PredecessorEntry>> {
    const predecessors = new Map<string, PredecessorEntry>();
    if (destAnchors.length === 0) return predecessors;

    const reverseAdj = graph.getReverseAdjacency();
    const heap = new MinHeap<{ key: string; dist: number }>((a, b) => a.dist - b.dist);
    const budget = new TickBudget(budgetMs);

    for (const a of destAnchors) {
        const existing = predecessors.get(a.junctionKey);
        if (existing && existing.distToDest <= a.cost) continue;
        predecessors.set(a.junctionKey, {
            distToDest: a.cost,
            nextKey: "",
            forwardEdge: null,
            tailToDest: a.tailToDest,
        });
        heap.push({ key: a.junctionKey, dist: a.cost });
    }

    let counter = 0;
    while (heap.size > 0) {
        if ((counter++ & 0x3FF) === 0) {
            await budget.maybeYield();
            if (cancelToken?.cancelled) return predecessors;
        }
        const top = heap.pop()!;
        const pred = predecessors.get(top.key);
        if (!pred || pred.distToDest !== top.dist) continue;

        const incoming = reverseAdj.get(top.key);
        if (!incoming) continue;
        for (const inc of incoming) {
            const newDist = top.dist + inc.edge.length;
            const existing = predecessors.get(inc.fromKey);
            if (existing && existing.distToDest <= newDist) continue;
            predecessors.set(inc.fromKey, {
                distToDest: newDist,
                nextKey: top.key,
                forwardEdge: inc.edge,
                tailToDest: null,
            });
            heap.push({ key: inc.fromKey, dist: newDist });
        }
    }

    return predecessors;
}

/**
 * Expand the junction-to-dest tile sequence starting from a chosen junction.
 * Returns tiles AFTER the start junction, ending with dest.
 * Returns an empty array when startJunctionKey is a terminal anchor whose
 * tailToDest is empty (i.e. the junction IS dest).
 */
export function reconstructTailToDest(
    startJunctionKey: string,
    predecessors: Map<string, PredecessorEntry>,
    dest: CoordsXYZ,
): CoordsXYZ[] {
    const out: CoordsXYZ[] = [];
    let cur = startJunctionKey;
    const destKey = coordKey(dest);
    // Safety bound against pathological maps; graph diameter is the worst case.
    let safety = predecessors.size + 2;
    while (safety-- > 0) {
        const pred = predecessors.get(cur);
        if (!pred) break;
        if (pred.forwardEdge) {
            for (const t of pred.forwardEdge.tilesFromSource) out.push(t);
            cur = pred.nextKey;
            continue;
        }
        if (pred.tailToDest) {
            for (const t of pred.tailToDest) out.push(t);
        }
        break;
    }
    if (out.length === 0 || coordKey(out[out.length - 1]) !== destKey) {
        out.push(dest);
    }
    return out;
}

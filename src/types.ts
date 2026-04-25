export enum PathfindingAlgorithm {
    AStar = "A*",
    Dijkstra = "Dijkstra",
    BFS = "BFS",
    Greedy = "Greedy Best-First",
}

/**
 * Re-export of the upstream PathNavigationOptions shape so callers don't need
 * an ambient global. Each option is opt-in: a missing or false value preserves
 * the navigator's default loose behavior.
 */
export interface PathNavigationOptions {
    respectBanners?: boolean;
    excludeGhosts?: boolean;
    excludeQueues?: boolean;
    excludeWidePaths?: boolean;
}

export interface PathfindingOptions {
    /**
     * Optional precomputed junction graph. When supplied, the algorithm runs
     * on the compressed graph instead of tile-by-tile, trading build cost for
     * faster repeat queries on the same network. Largest effect on sparse
     * networks with long corridors.
     */
    graph?: import("./graph").JunctionGraph;

    /**
     * Path navigation rules forwarded to {@link map.getPathNavigator} for
     * every neighbor query. When using `graph`, the graph must have been built
     * with the same options or results will not match this query's rules.
     */
    pathOptions?: PathNavigationOptions;
}

export interface PathfindingResult {
    /** Ordered positions from start to end (inclusive). */
    path: CoordsXYZ[];
    /** Number of nodes explored during the search. */
    nodesExplored: number;
    /** Whether a path was found. */
    success: boolean;
    /** Total wall-clock time in milliseconds. */
    elapsedMs: number;
    /** Number of ticks used. */
    ticks: number;
}

export type PathfindingFunction = (
    start: CoordsXYZ,
    end: CoordsXYZ,
    budgetMs: number,
    options?: PathfindingOptions,
) => Promise<PathfindingResult>;

export type GuideResultStatus =
    | "arrived"
    | "stuck"
    | "cancelled"
    | "peep_removed"
    | "path_empty";

export interface GuideResult {
    status: GuideResultStatus;
    /** Index of the last waypoint reached (0-based). -1 if none. */
    lastWaypointIndex: number;
    /** Total game ticks elapsed during guidance. */
    elapsedTicks: number;
}

export interface GuideProgressEvent {
    waypointIndex: number;
    totalWaypoints: number;
    position: CoordsXYZ;
}

export interface GuideOptions {
    /**
     * Upper bound on ticks at a single waypoint before declaring stuck,
     * regardless of progress. Guards against a peep making infinitesimal
     * progress forever. Default: 600 (~24s at 25 tps).
     */
    waypointTimeoutTicks?: number;
    /**
     * Ticks of no forward progress (distance to waypoint not decreasing)
     * before declaring stuck. Transient stalls (crowded paths, brief idle)
     * reset this counter as soon as the peep makes progress again.
     * Default: 120 (~4.8s at 25 tps).
     */
    noProgressTimeoutTicks?: number;
    /** Distance in game units to consider a waypoint reached. Default: 5. */
    arrivalThreshold?: number;
    /**
     * When true, log per-tick diagnostics for each guided peep (id, our
     * target, peep.destination, peep.x/y, dist) and a one-line summary at
     * the moment `stuck` fires showing whether `peep.destination` was
     * overwritten by the native AI. Off by default — turn on only while
     * investigating a stuck-storm.
     */
    debugStuck?: boolean;
    /** Called on each waypoint arrival. Return false to cancel. */
    onProgress?: (event: GuideProgressEvent) => boolean | void;
    /** Set cancelled to true to abort guidance. */
    cancelToken?: { readonly cancelled: boolean };
}

export type GuidePeepsResultStatus = GuideResultStatus | "no-path" | "no-start";

export interface GuidePeepsPeepResult {
    status: GuidePeepsResultStatus;
    /** Index of the last waypoint reached, or -1 when no guiding happened. */
    lastWaypointIndex: number;
    /** Total game ticks elapsed during guidance (0 if guidance never started). */
    elapsedTicks: number;
}

export interface GuidePeepsOptions {
    /** Per-tick work budget in ms for each phase (graph build, Dijkstra, per-peep reconstruction). Default: 2. */
    budgetMs?: number;
    /** Set cancelled to true to abort the whole batch (and all in-flight guides). */
    cancelToken?: { readonly cancelled: boolean };
    /** Precomputed junction graph. Defaults to the shared module-level graph. */
    graph?: import("./graph").JunctionGraph;
    /** Path navigation rules used when building/walking the graph. */
    pathOptions?: PathNavigationOptions;
    /** Called once per peep when that peep reaches a terminal state. */
    onPeepResult?: (peep: Peep, result: GuidePeepsPeepResult) => void;
}

export interface GuidePeepsSummary {
    /** Peeps handed off to guidePeep (i.e. had a valid path). */
    dispatched: number;
    arrived: number;
    stuck: number;
    removed: number;
    cancelled: number;
    /** Peeps on the same island as dest but no path exists (one-way banners etc). */
    noPath: number;
    /** Peeps not standing on a footpath tile. */
    noStart: number;
}

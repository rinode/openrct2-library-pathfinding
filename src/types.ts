export enum PathfindingAlgorithm {
    AStar = "A*",
    Dijkstra = "Dijkstra",
    BFS = "BFS",
    Greedy = "Greedy Best-First",
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

export type PathfindingFunction = (start: CoordsXYZ, end: CoordsXYZ, budgetMs: number) => Promise<PathfindingResult>;

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
    /** Max ticks to wait per waypoint before declaring stuck. Default: 120 (~4.8s at 25 tps). */
    waypointTimeoutTicks?: number;
    /** Distance in game units to consider a waypoint reached. Default: 5. */
    arrivalThreshold?: number;
    /** Called on each waypoint arrival. Return false to cancel. */
    onProgress?: (event: GuideProgressEvent) => boolean | void;
    /** Set cancelled to true to abort guidance. */
    cancelToken?: { readonly cancelled: boolean };
}

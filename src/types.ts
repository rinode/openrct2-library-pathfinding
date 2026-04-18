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

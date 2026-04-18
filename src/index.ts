export { PathfindingAlgorithm, PathfindingResult, PathfindingFunction, GuideResult, GuideResultStatus, GuideOptions, GuideProgressEvent } from "./types";
export { guidePeep } from "./guide";
export { astar } from "./astar";
export { dijkstra } from "./dijkstra";
export { bfs } from "./bfs";
export { greedy } from "./greedy";

import { PathfindingAlgorithm, PathfindingFunction } from "./types";
import { astar } from "./astar";
import { dijkstra } from "./dijkstra";
import { bfs } from "./bfs";
import { greedy } from "./greedy";

export const algorithms: Record<PathfindingAlgorithm, PathfindingFunction> = {
    [PathfindingAlgorithm.AStar]: astar,
    [PathfindingAlgorithm.Dijkstra]: dijkstra,
    [PathfindingAlgorithm.BFS]: bfs,
    [PathfindingAlgorithm.Greedy]: greedy,
};

import { PathfindingAlgorithm, PathfindingFunction } from "../types";
import { astar } from "./astar";
import { dijkstra } from "./dijkstra";
import { bfs } from "./bfs";
import { greedy } from "./greedy";

export { astar, dijkstra, bfs, greedy };

export const algorithms: Record<PathfindingAlgorithm, PathfindingFunction> = {
    [PathfindingAlgorithm.AStar]: astar,
    [PathfindingAlgorithm.Dijkstra]: dijkstra,
    [PathfindingAlgorithm.BFS]: bfs,
    [PathfindingAlgorithm.Greedy]: greedy,
};

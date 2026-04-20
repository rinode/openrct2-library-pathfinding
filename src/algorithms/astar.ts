import { PathfindingFunction } from "../types";
import { coordKey, heuristic, reconstructPath, noPathResult, SearchNode } from "../utils";
import { runOnGraph, GraphSearchMode } from "../graph";

interface AStarNode extends SearchNode {
    g: number;
    f: number;
}

export const astar: PathfindingFunction = (start, end, budgetMs, options) => {
    if (options?.graph) {
        return runOnGraph(start, end, options.graph, budgetMs, GraphSearchMode.AStar);
    }
    return new Promise((resolve) => {
        const startNav = map.getPathNavigator(start);
        const endNav = map.getPathNavigator(end);
        if (!startNav || !endNav) { resolve(noPathResult()); return; }

        const endKey = coordKey(end);
        const openSet: AStarNode[] = [];
        const closedSet = new Set<string>();
        const gScores = new Map<string, number>();
        let nodesExplored = 0;
        let ticks = 0;
        const startTime = Date.now();

        openSet.push({ pos: start, g: 0, f: heuristic(start, end), parent: null });
        gScores.set(coordKey(start), 0);

        const step = () => {
            ticks++;
            const deadline = Date.now() + budgetMs;
            // Always process at least one node per tick so a budget of 0
            // still makes forward progress instead of looping forever.
            let firstIteration = true;
            while (openSet.length > 0 && (firstIteration || Date.now() < deadline)) {
                firstIteration = false;
                let bestIdx = 0;
                for (let j = 1; j < openSet.length; j++) {
                    if (openSet[j].f < openSet[bestIdx].f) bestIdx = j;
                }
                const current = openSet[bestIdx];
                openSet.splice(bestIdx, 1);
                const currentKey = coordKey(current.pos);

                if (currentKey === endKey) {
                    resolve({ path: reconstructPath(current), nodesExplored, success: true, elapsedMs: Date.now() - startTime, ticks });
                    return;
                }
                if (closedSet.has(currentKey)) continue;
                closedSet.add(currentKey);
                nodesExplored++;

                const nav = map.getPathNavigator(current.pos);
                if (!nav) continue;

                for (const conn of nav.getConnectedPaths()) {
                    const neighborKey = coordKey(conn.position);
                    if (closedSet.has(neighborKey)) continue;
                    const tentativeG = current.g + 1;
                    const existingG = gScores.get(neighborKey);
                    if (existingG !== undefined && tentativeG >= existingG) continue;
                    gScores.set(neighborKey, tentativeG);
                    openSet.push({ pos: conn.position, g: tentativeG, f: tentativeG + heuristic(conn.position, end), parent: current });
                }
            }

            if (openSet.length === 0) {
                resolve({ path: [], nodesExplored, success: false, elapsedMs: Date.now() - startTime, ticks });
                return;
            }
            context.setTimeout(step, 0);
        };
        step();
    });
};

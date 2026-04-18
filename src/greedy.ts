import { PathfindingFunction } from "./types";
import { coordKey, heuristic, reconstructPath, noPathResult, SearchNode } from "./utils";

interface GreedyNode extends SearchNode {
    h: number;
}

export const greedy: PathfindingFunction = (start, end, budgetMs) => {
    return new Promise((resolve) => {
        const startNav = map.getPathNavigatorAt(start);
        const endNav = map.getPathNavigatorAt(end);
        if (!startNav || !endNav) { resolve(noPathResult()); return; }

        const endKey = coordKey(end);
        const openSet: GreedyNode[] = [];
        const closedSet = new Set<string>();
        let nodesExplored = 0;
        let ticks = 0;
        const startTime = Date.now();

        openSet.push({ pos: start, h: heuristic(start, end), parent: null });

        const step = () => {
            ticks++;
            const deadline = Date.now() + budgetMs;
            while (openSet.length > 0 && Date.now() < deadline) {
                let bestIdx = 0;
                for (let j = 1; j < openSet.length; j++) {
                    if (openSet[j].h < openSet[bestIdx].h) bestIdx = j;
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

                const nav = map.getPathNavigatorAt(current.pos);
                if (!nav) continue;

                for (const conn of nav.getConnectedPaths()) {
                    const neighborKey = coordKey(conn.position);
                    if (closedSet.has(neighborKey)) continue;
                    openSet.push({ pos: conn.position, h: heuristic(conn.position, end), parent: current });
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

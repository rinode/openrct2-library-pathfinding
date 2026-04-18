import { PathfindingFunction } from "./types";
import { coordKey, reconstructPath, noPathResult, SearchNode } from "./utils";

export const bfs: PathfindingFunction = (start, end, budgetMs) => {
    return new Promise((resolve) => {
        const startNav = map.getPathNavigatorAt(start);
        const endNav = map.getPathNavigatorAt(end);
        if (!startNav || !endNav) { resolve(noPathResult()); return; }

        const endKey = coordKey(end);
        const queue: SearchNode[] = [];
        const visited = new Set<string>();
        let nodesExplored = 0;
        let ticks = 0;
        const startTime = Date.now();

        queue.push({ pos: start, parent: null });
        visited.add(coordKey(start));

        const step = () => {
            ticks++;
            const deadline = Date.now() + budgetMs;
            while (queue.length > 0 && Date.now() < deadline) {
                const current = queue.shift()!;
                const currentKey = coordKey(current.pos);
                nodesExplored++;

                if (currentKey === endKey) {
                    resolve({ path: reconstructPath(current), nodesExplored, success: true, elapsedMs: Date.now() - startTime, ticks });
                    return;
                }

                const nav = map.getPathNavigatorAt(current.pos);
                if (!nav) continue;

                for (const conn of nav.getConnectedPaths()) {
                    const neighborKey = coordKey(conn.position);
                    if (visited.has(neighborKey)) continue;
                    visited.add(neighborKey);
                    queue.push({ pos: conn.position, parent: current });
                }
            }

            if (queue.length === 0) {
                resolve({ path: [], nodesExplored, success: false, elapsedMs: Date.now() - startTime, ticks });
                return;
            }
            context.setTimeout(step, 0);
        };
        step();
    });
};

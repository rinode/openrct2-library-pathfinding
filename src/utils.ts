import { PathfindingResult } from "./types";

export function coordKey(pos: CoordsXYZ): string {
    return `${pos.x},${pos.y},${pos.z}`;
}

export function heuristic(a: CoordsXYZ, b: CoordsXYZ): number {
    return Math.abs(a.x - b.x) / 32 + Math.abs(a.y - b.y) / 32 + Math.abs(a.z - b.z) / 16;
}

export interface SearchNode {
    pos: CoordsXYZ;
    parent: SearchNode | null;
}

export function reconstructPath(node: SearchNode): CoordsXYZ[] {
    const path: CoordsXYZ[] = [];
    let current: SearchNode | null = node;
    while (current) {
        path.unshift(current.pos);
        current = current.parent;
    }
    return path;
}

export function noPathResult(): PathfindingResult {
    return { path: [], nodesExplored: 0, success: false, elapsedMs: 0, ticks: 0 };
}

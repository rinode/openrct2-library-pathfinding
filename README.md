# openrct2-library-pathfinding

Pathfinding algorithms for OpenRCT2 plugins, built on the PathNavigator API.

## Algorithms

- **A\***: optimal, heuristic-guided
- **Dijkstra**: optimal, no heuristic
- **BFS**: unweighted shortest path
- **Greedy Best-First**: fast, non-optimal

Each algorithm is async and splits its work across game ticks using a time budget.

All four accept an optional precomputed `JunctionGraph`. When supplied, the search runs on a corridor-contracted graph (junctions are nodes, corridors collapse into weighted edges) instead of walking tile by tile. Fast on sparse networks with long corridors, at the cost of one build pass.

This is the 4-connected analog of [Steve Rabin's JPS+](https://gdcvault.com/play/1022094/JPS-Over-100x-Faster-than). Footpaths have no diagonals, so classic JPS/JPS+ forced-neighbor pruning does not apply. Corridor contraction gets the equivalent win.

## Install

```
npm install openrct2-library-pathfinding
```

Requires `@openrct2/types` as a peer dependency.

Depends on the [PathNavigator API](https://github.com/rinode/OpenRCT2/tree/feature/path-navigator), not yet merged upstream. Use a build from that branch for now.

## Usage

```typescript
import { astar } from "openrct2-library-pathfinding";

const result = await astar(startPos, endPos, 2); // 2ms per tick budget

if (result.success) {
    console.log(`Path: ${result.path.length} tiles, ${result.nodesExplored} nodes explored`);
}
```

Or pick via the enum:

```typescript
import { algorithms, PathfindingAlgorithm } from "openrct2-library-pathfinding";

const algo = algorithms[PathfindingAlgorithm.AStar];
const result = await algo(start, end, budgetMs);
```

### Precomputed junction graph

The module keeps a shared default graph, built lazily and reused across calls. It auto-invalidates on path- or banner-mutating `action.execute` events (`footpathplace`, `footpathremove`, `bannerplace`, etc.) and rebuilds on the next query. Call `invalidateGraph()` to force a rebuild.

```typescript
import { astar, getDefaultGraph } from "openrct2-library-pathfinding";

const result = await astar(start, end, 2, { graph: getDefaultGraph() });
```

To manage the graph lifetime yourself:

```typescript
import { astar, JunctionGraph, buildGraph } from "openrct2-library-pathfinding";

const graph = new JunctionGraph();
await buildGraph(start, 2, graph);
const result = await astar(start, end, 2, { graph });
```

## API

### `PathfindingFunction`

```typescript
(
    start: CoordsXYZ,
    end: CoordsXYZ,
    budgetMs: number,
    options?: PathfindingOptions,
) => Promise<PathfindingResult>
```

### `PathfindingOptions`

| Field | Type | Description |
|-------|------|-------------|
| `graph` | `JunctionGraph` | Precomputed junction graph. Search runs on the compressed graph instead of tile by tile. |

### `PathfindingResult`

| Field | Type | Description |
|-------|------|-------------|
| `path` | `CoordsXYZ[]` | Tile positions from start to end |
| `nodesExplored` | `number` | Nodes visited during search |
| `success` | `boolean` | Whether a path was found |
| `elapsedMs` | `number` | Wall-clock time |
| `ticks` | `number` | Game ticks used |

## License

MIT

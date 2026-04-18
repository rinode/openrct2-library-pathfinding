# openrct2-library-pathfinding

Pathfinding algorithms for OpenRCT2 plugins using the PathNavigator API.

## Algorithms

- **A\***: optimal, heuristic-guided
- **Dijkstra**: optimal, no heuristic
- **BFS**: unweighted shortest path
- **Greedy Best-First**: fast, non-optimal

All algorithms are async and distribute work across game ticks via a configurable time budget.

## Install

```
npm install openrct2-library-pathfinding
```

Requires `@openrct2/types` as a peer dependency.

Depends on the [PathNavigator API](https://github.com/rinode/OpenRCT2/tree/feature/path-navigator), which is not yet merged into OpenRCT2. Use a build from that branch until it lands upstream.

## Usage

```typescript
import { astar } from "openrct2-library-pathfinding";

const result = await astar(startPos, endPos, 2); // 2ms per tick budget

if (result.success) {
    console.log(`Path: ${result.path.length} tiles, ${result.nodesExplored} nodes explored`);
}
// => Path: 18 tiles, 42 nodes explored
```

Or use the algorithm map with the enum:

```typescript
import { algorithms, PathfindingAlgorithm } from "openrct2-library-pathfinding";

const algo = algorithms[PathfindingAlgorithm.AStar];
const result = await algo(start, end, budgetMs);
```

## API

### `PathfindingFunction`

```typescript
(start: CoordsXYZ, end: CoordsXYZ, budgetMs: number) => Promise<PathfindingResult>
```

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

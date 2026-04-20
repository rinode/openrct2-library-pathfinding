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

## Guiding peeps

The library also drives peeps along a computed path, so callers don't have to write their own tick loop. Three entry points, from low-level to high:

- `guidePeep(peep, path, options?)` — follow a single pre-computed tile path to the end. Resolves with `arrived`, `stuck`, `cancelled`, `peep_removed`, or `path_empty`.
- `planPeepPaths(peeps, dest, options?)` — for N peeps sharing one destination, runs a single reverse Dijkstra on the junction graph and returns a per-peep plan (`ok` / `no-path` / `no-start`). No movement happens.
- `guidePeeps(peeps, dest, options?)` — planning + dispatch in one call. All reachable peeps walk to `dest`; the returned summary reports how many arrived, got stuck, etc.

```typescript
import { guidePeeps, getDefaultGraph } from "openrct2-library-pathfinding";

const summary = await guidePeeps(map.getAllEntities("guest"), dest, {
    budgetMs: 2,
    graph: getDefaultGraph(),
    onPeepResult: (peep, r) => console.log(peep.id, r.status),
});
// summary: { dispatched, arrived, stuck, removed, cancelled, noPath, noStart }
```

Why batched planning is cheap: one reverse Dijkstra rooted at `dest` gives every reachable peep its shortest path in a single pass, so per-peep work is just path reconstruction. Planning and dispatch are tick-distributed via the same `budgetMs` used by the search algorithms — large batches don't block the frame.

The library also exports `peepFootpathTile(peep)`, which snaps a peep's `(x, y, z)` to the footpath tile at its feet (or returns `null` if the peep isn't on a footpath).

### Stuck detection

`guidePeep` uses two independent counters to decide a peep is stuck:

| Option | Default | Units | Meaning |
|--------|---------|-------|---------|
| `noProgressTimeoutTicks` | `120` | ticks | Ticks of no forward progress (distance to the current waypoint not decreasing by more than 1 unit) before declaring stuck. Transient stalls — crowded paths, brief idle — reset this as soon as the peep makes progress again. |
| `waypointTimeoutTicks` | `600` | ticks | Absolute upper bound on ticks at a single waypoint, regardless of progress. Guards against a peep making infinitesimal progress forever. |
| `arrivalThreshold` | `5` | game units | Distance at which a waypoint counts as reached. |
| `debugStuck` | `false` | — | Log per-tick diagnostics and a summary at the moment `stuck` fires showing whether `peep.destination` was overwritten by the native AI. Off by default — turn on only while investigating a stuck-storm. |

Progress-based detection is the primary signal; the absolute timeout is a safety net. At 25 ticks/sec the defaults give ~4.8s of no progress or ~24s total at one waypoint before giving up.

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

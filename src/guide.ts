import {
    GuideResult,
    GuideOptions,
    GuideProgressEvent,
    GuidePeepsOptions,
    GuidePeepsPeepResult,
    GuidePeepsSummary,
    PathNavigationOptions,
} from "./types";
import {
    JunctionGraph,
    getDefaultGraph,
    resolveAnchors,
    resolveDestAnchors,
    reverseDijkstraFromDest,
    reconstructTailToDest,
    tryDirectCorridorPath,
    PredecessorEntry,
} from "./graph";
import { coordKey, TickBudget } from "./utils";

interface PeepGuideState {
    peep: Peep;
    path: CoordsXYZ[];
    waypointIndex: number;
    ticksAtWaypoint: number;
    noProgressTicks: number;
    lastDist: number;
    totalTicks: number;
    waypointTimeoutTicks: number;
    noProgressTimeoutTicks: number;
    arrivalThreshold: number;
    debugStuck: boolean;
    onProgress?: (event: GuideProgressEvent) => boolean | void;
    cancelToken?: { readonly cancelled: boolean };
    resolve: (result: GuideResult) => void;
}

const activeGuides = new Map<number, PeepGuideState>();
let tickSubscription: IDisposable | null = null;

function makeResult(status: GuideResult["status"], state: PeepGuideState): GuideResult {
    return {
        status,
        lastWaypointIndex: state.waypointIndex - 1,
        elapsedTicks: state.totalTicks,
    };
}

function computeDirection(from: CoordsXYZ, to: CoordsXYZ): Direction {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx > 0) return 0;
    if (dy > 0) return 1;
    if (dx < 0) return 2;
    return 3;
}

function setNextDestination(peep: Peep, target: CoordsXYZ, from: CoordsXYZ): void {
    peep.destination = { x: target.x + 16, y: target.y + 16 };
    peep.direction = computeDirection(from, target);
}

function tickPeep(state: PeepGuideState): GuideResult | null {
    state.totalTicks++;
    state.ticksAtWaypoint++;

    if (state.peep.id === null) {
        return makeResult("peep_removed", state);
    }

    if (state.cancelToken?.cancelled) {
        return makeResult("cancelled", state);
    }

    const target = state.path[state.waypointIndex];
    const targetCx = target.x + 16;
    const targetCy = target.y + 16;

    const dx = state.peep.x - targetCx;
    const dy = state.peep.y - targetCy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (state.debugStuck) {
        const d = state.peep.destination;
        const overridden = !d || d.x !== targetCx || d.y !== targetCy;
        console.log(
            `[guidePeep ${state.peep.id}] waypoint ${state.waypointIndex}/${state.path.length - 1} ` +
            `peep=(${state.peep.x},${state.peep.y}) target=(${targetCx},${targetCy}) ` +
            `dest=(${d?.x ?? "null"},${d?.y ?? "null"}) dist=${dist.toFixed(1)} ` +
            `ticksAtWP=${state.ticksAtWaypoint} noProgress=${state.noProgressTicks} ` +
            `overridden=${overridden}`,
        );
    }

    if (dist <= state.arrivalThreshold) {
        if (state.waypointIndex === state.path.length - 1) {
            return makeResult("arrived", { ...state, waypointIndex: state.waypointIndex + 1 });
        }

        if (state.onProgress) {
            const cont = state.onProgress({
                waypointIndex: state.waypointIndex,
                totalWaypoints: state.path.length,
                position: { x: state.peep.x, y: state.peep.y, z: state.peep.z },
            });
            if (cont === false) {
                return makeResult("cancelled", state);
            }
        }

        state.waypointIndex++;
        state.ticksAtWaypoint = 0;
        state.noProgressTicks = 0;
        state.lastDist = Infinity;
        setNextDestination(state.peep, state.path[state.waypointIndex], state.path[state.waypointIndex - 1]);
        return null;
    }

    // Forward progress = distance to waypoint decreased by more than a pixel.
    // Sub-pixel jitter doesn't count as progress.
    if (state.lastDist - dist > 1) {
        state.noProgressTicks = 0;
    } else {
        state.noProgressTicks++;
    }
    state.lastDist = dist;

    if (state.noProgressTicks > state.noProgressTimeoutTicks) {
        if (state.debugStuck) recordStuckDiagnostic(state, targetCx, targetCy);
        return makeResult("stuck", state);
    }
    if (state.ticksAtWaypoint > state.waypointTimeoutTicks) {
        if (state.debugStuck) recordStuckDiagnostic(state, targetCx, targetCy);
        return makeResult("stuck", state);
    }

    return null;
}

function recordStuckDiagnostic(state: PeepGuideState, targetCx: number, targetCy: number): void {
    const d = state.peep.destination;
    const overridden = !d || d.x !== targetCx || d.y !== targetCy;
    console.log(
        `[guidePeep ${state.peep.id}] STUCK after ${state.totalTicks} ticks ` +
        `at waypoint ${state.waypointIndex}/${state.path.length - 1}, ` +
        `destination overridden=${overridden}`,
    );
}

function onTick(): void {
    for (const [id, state] of activeGuides) {
        const result = tickPeep(state);
        if (result) {
            state.resolve(result);
            activeGuides.delete(id);
        }
    }
    if (activeGuides.size === 0 && tickSubscription) {
        tickSubscription.dispose();
        tickSubscription = null;
    }
}

/**
 * Snap a peep's (x, y, z) to the footpath tile at its feet. Returns null if
 * the peep isn't standing on a footpath. Used by guidePeeps (and callers that
 * need the same semantics) to derive a peep's start position.
 */
export function peepFootpathTile(peep: Peep): CoordsXYZ | null {
    const tx = Math.floor(peep.x / 32);
    const ty = Math.floor(peep.y / 32);
    const tile = map.getTile(tx, ty);
    let bestZ = -Infinity;
    for (const el of tile.elements) {
        if (el.type === "footpath" && el.baseZ <= peep.z + 8 && el.baseZ > bestZ) {
            bestZ = el.baseZ;
        }
    }
    if (bestZ === -Infinity) return null;
    return { x: tx * 32, y: ty * 32, z: bestZ };
}

export interface PeepPathPlan {
    peep: Peep;
    status: "ok" | "no-path" | "no-start";
    /** Tile-by-tile path from the peep's start to dest. Non-null iff status === "ok". */
    path: CoordsXYZ[] | null;
}

export interface PlanPeepPathsOptions {
    budgetMs?: number;
    graph?: JunctionGraph;
    pathOptions?: PathNavigationOptions;
    cancelToken?: { readonly cancelled: boolean };
}

/**
 * For each peep, compute a tile-by-tile path to the shared destination using
 * one reverse Dijkstra on the junction graph. Peeps on a different component
 * than dest get status "no-path"; peeps not standing on a footpath get "no-start".
 *
 * All work is tick-distributed via the budget.
 */
export async function planPeepPaths(
    peeps: Peep[],
    dest: CoordsXYZ,
    options?: PlanPeepPathsOptions,
): Promise<PeepPathPlan[]> {
    const budgetMs = options?.budgetMs ?? 2;
    const cancelToken = options?.cancelToken;
    const graph = options?.graph ?? getDefaultGraph(options?.pathOptions);

    // Phase 1: ensure dest's component is built.
    await graph.buildComponentFrom(dest, budgetMs);

    const destKey = coordKey(dest);
    const destComponent = graph.componentKeyOf(dest);

    const plans: PeepPathPlan[] = [];
    if (!destComponent) {
        for (const peep of peeps) plans.push({ peep, status: "no-path", path: null });
        return plans;
    }

    if (cancelToken?.cancelled) {
        for (const peep of peeps) plans.push({ peep, status: "no-path", path: null });
        return plans;
    }

    // Phase 2: reverse Dijkstra once, shared across all peeps.
    const destAnchors = resolveDestAnchors(dest, graph);
    const predecessors = await reverseDijkstraFromDest(graph, destAnchors, budgetMs, cancelToken);

    // Phase 3: per-peep reconstruction.
    const budget = new TickBudget(budgetMs);
    for (const peep of peeps) {
        if (cancelToken?.cancelled) {
            plans.push({ peep, status: "no-path", path: null });
            continue;
        }
        await budget.maybeYield();

        const startPos = peepFootpathTile(peep);
        if (!startPos) {
            plans.push({ peep, status: "no-start", path: null });
            continue;
        }

        const startKey = coordKey(startPos);
        if (startKey === destKey) {
            plans.push({ peep, status: "ok", path: [startPos] });
            continue;
        }

        if (graph.componentKeyOf(startPos) !== destComponent) {
            plans.push({ peep, status: "no-path", path: null });
            continue;
        }

        // Same-corridor shortcut (directed): walking the corridor is shorter
        // than detouring through a junction.
        const direct = tryDirectCorridorPath(startPos, dest, graph);
        if (direct) {
            plans.push({ peep, status: "ok", path: direct });
            continue;
        }

        const startAnchors = resolveAnchors(startPos, graph);
        if (!startAnchors) {
            plans.push({ peep, status: "no-path", path: null });
            continue;
        }

        let bestAnchor: typeof startAnchors[number] | null = null;
        let bestPred: PredecessorEntry | null = null;
        let bestTotal = Infinity;
        for (const a of startAnchors) {
            const pred = predecessors.get(a.junctionKey);
            if (!pred) continue;
            const total = a.cost + pred.distToDest;
            if (total < bestTotal) {
                bestTotal = total;
                bestAnchor = a;
                bestPred = pred;
            }
        }

        if (!bestAnchor || !bestPred) {
            plans.push({ peep, status: "no-path", path: null });
            continue;
        }

        const path: CoordsXYZ[] = [startPos];
        for (const t of bestAnchor.prefixToJunction) path.push(t);
        const tail = reconstructTailToDest(bestAnchor.junctionKey, predecessors, dest);
        for (const t of tail) path.push(t);

        // Drop consecutive duplicates (junction handoffs can repeat a tile).
        const dedup: CoordsXYZ[] = [];
        for (const p of path) {
            if (dedup.length === 0 || coordKey(dedup[dedup.length - 1]) !== coordKey(p)) {
                dedup.push(p);
            }
        }
        plans.push({ peep, status: "ok", path: dedup });
    }

    return plans;
}

/**
 * Dispatch N peeps to a single shared destination with performance as the
 * primary goal. Does one reverse Dijkstra on the junction graph (amortizing
 * path computation across all peeps) and hands each peep off to guidePeep.
 * All computation is tick-distributed so large batches don't freeze the game
 * loop.
 */
export async function guidePeeps(
    peeps: Peep[],
    dest: CoordsXYZ,
    options?: GuidePeepsOptions,
): Promise<GuidePeepsSummary> {
    const cancelToken = options?.cancelToken;
    const onPeepResult = options?.onPeepResult;

    const summary: GuidePeepsSummary = {
        dispatched: 0, arrived: 0, stuck: 0, removed: 0,
        cancelled: 0, noPath: 0, noStart: 0,
    };

    const plans = await planPeepPaths(peeps, dest, {
        budgetMs: options?.budgetMs,
        graph: options?.graph,
        pathOptions: options?.pathOptions,
        cancelToken,
    });

    const handoffs: Promise<void>[] = [];
    for (const plan of plans) {
        if (cancelToken?.cancelled) {
            summary.cancelled++;
            onPeepResult?.(plan.peep, { status: "cancelled", lastWaypointIndex: -1, elapsedTicks: 0 });
            continue;
        }
        if (plan.status === "no-start") {
            summary.noStart++;
            onPeepResult?.(plan.peep, { status: "no-start", lastWaypointIndex: -1, elapsedTicks: 0 });
            continue;
        }
        if (plan.status === "no-path" || !plan.path) {
            summary.noPath++;
            onPeepResult?.(plan.peep, { status: "no-path", lastWaypointIndex: -1, elapsedTicks: 0 });
            continue;
        }
        if (plan.path.length < 2) {
            summary.arrived++;
            onPeepResult?.(plan.peep, { status: "arrived", lastWaypointIndex: 0, elapsedTicks: 0 });
            continue;
        }

        summary.dispatched++;
        handoffs.push(
            guidePeep(plan.peep, plan.path, { cancelToken }).then((r) => {
                if (r.status === "arrived") summary.arrived++;
                else if (r.status === "stuck") summary.stuck++;
                else if (r.status === "peep_removed") summary.removed++;
                else if (r.status === "cancelled") summary.cancelled++;
                onPeepResult?.(plan.peep, r);
            }),
        );
    }

    await Promise.all(handoffs);
    return summary;
}

export function guidePeep(
    peep: Peep,
    path: CoordsXYZ[],
    options?: GuideOptions,
): Promise<GuideResult> {
    if (path.length === 0) {
        return Promise.resolve({ status: "path_empty", lastWaypointIndex: -1, elapsedTicks: 0 });
    }
    if (path.length === 1) {
        return Promise.resolve({ status: "arrived", lastWaypointIndex: 0, elapsedTicks: 0 });
    }

    const peepId = peep.id;
    if (peepId === null) {
        return Promise.resolve({ status: "peep_removed", lastWaypointIndex: -1, elapsedTicks: 0 });
    }

    // Cancel existing guide for this peep
    const existing = activeGuides.get(peepId);
    if (existing) {
        existing.resolve(makeResult("cancelled", existing));
        activeGuides.delete(peepId);
    }

    return new Promise((resolve) => {
        const state: PeepGuideState = {
            peep,
            path,
            waypointIndex: 1,
            ticksAtWaypoint: 0,
            noProgressTicks: 0,
            lastDist: Infinity,
            totalTicks: 0,
            waypointTimeoutTicks: options?.waypointTimeoutTicks ?? 600,
            noProgressTimeoutTicks: options?.noProgressTimeoutTicks ?? 120,
            arrivalThreshold: options?.arrivalThreshold ?? 5,
            debugStuck: options?.debugStuck ?? false,
            onProgress: options?.onProgress,
            cancelToken: options?.cancelToken,
            resolve,
        };

        setNextDestination(peep, path[1], path[0]);
        activeGuides.set(peepId, state);

        if (!tickSubscription) {
            tickSubscription = context.subscribe("interval.tick", onTick);
        }
    });
}

import { GuideResult, GuideOptions, GuideProgressEvent } from "./types";

interface PeepGuideState {
    peep: Peep;
    path: CoordsXYZ[];
    waypointIndex: number;
    ticksAtWaypoint: number;
    totalTicks: number;
    waypointTimeoutTicks: number;
    arrivalThreshold: number;
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
    const dx = state.peep.x - (target.x + 16);
    const dy = state.peep.y - (target.y + 16);
    const dist = Math.sqrt(dx * dx + dy * dy);

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
        setNextDestination(state.peep, state.path[state.waypointIndex], state.path[state.waypointIndex - 1]);
    } else if (state.ticksAtWaypoint > state.waypointTimeoutTicks) {
        return makeResult("stuck", state);
    }

    return null;
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
            totalTicks: 0,
            waypointTimeoutTicks: options?.waypointTimeoutTicks ?? 120,
            arrivalThreshold: options?.arrivalThreshold ?? 5,
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

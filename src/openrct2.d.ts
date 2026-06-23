// Type augmentation for PathNavigator API (not yet in @openrct2/types).
interface PathConnection {
    readonly position: CoordsXYZ;
    readonly elementIndex: number;
    readonly direction: Direction | null;
    readonly isSloped: boolean;
    readonly slopeDirection: Direction | null;
    readonly isQueue: boolean;
    readonly isWide: boolean;
    readonly ride: number | null;
    readonly station: number | null;
}

interface PathNavigator {
    readonly current: PathConnection;
    readonly edges: number;
    readonly permittedEdges: number;
    getConnectedPaths(): PathConnection[];
    moveTo(direction: Direction): boolean;
}

interface PathNavigationOptions {
    respectBanners?: boolean;
    includeGhosts?: boolean;
    includeQueues?: boolean;
    includeWidePaths?: boolean;
}

interface GameMap {
    getPathNavigator(location: CoordsXY, elementIndex: number, options?: PathNavigationOptions): PathNavigator | null;
    getPathNavigator(position: CoordsXYZ, options?: PathNavigationOptions): PathNavigator | null;
}

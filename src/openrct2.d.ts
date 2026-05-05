// Type augmentation for PathNavigator API (not yet in @openrct2/types).
interface PathConnection {
    position: CoordsXYZ;
}

interface PathNavigator {
    current: PathConnection;
    getConnectedPaths(): PathConnection[];
}

interface PathNavigationOptions {
    respectBanners?: boolean;
    includeGhosts?: boolean;
    includeQueues?: boolean;
    includeWidePaths?: boolean;
}

interface GameMap {
    getPathNavigator(position: CoordsXYZ, options?: PathNavigationOptions): PathNavigator | null;
}

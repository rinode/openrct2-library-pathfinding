// Type augmentation for PathNavigator API (not yet in @openrct2/types)
interface PathConnection {
    position: CoordsXYZ;
}

interface PathNavigator {
    current: PathConnection;
    getConnectedPaths(): PathConnection[];
}

interface GameMap {
    getPathNavigator(position: CoordsXYZ): PathNavigator | null;
}

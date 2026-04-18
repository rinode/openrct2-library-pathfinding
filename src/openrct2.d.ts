// Type augmentation for PathNavigator API (not yet in @openrct2/types)
interface PathConnection {
    position: CoordsXYZ;
}

interface PathNavigator {
    position: CoordsXYZ;
    getConnectedPaths(): PathConnection[];
}

interface GameMap {
    getPathNavigatorAt(position: CoordsXYZ): PathNavigator | null;
}

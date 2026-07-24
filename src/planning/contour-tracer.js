import {
    contourBounds,
    pointInPolygon,
    polygonArea,
    simplifyClosedContour
} from "./geometry.js";

const pointKey = point => `${point.x},${point.y}`;

const direction = function (start, end) {
    if (end.x > start.x) return 0;
    if (end.y > start.y) return 1;
    if (end.x < start.x) return 2;
    return 3;
};

const selectNextEdge = function (edges, previousDirection) {
    const preference = [1, 0, 3, 2];
    return edges
        .filter(edge => !edge.used)
        .sort((first, second) => {
            const firstTurn = (direction(first.start, first.end) - previousDirection + 4) % 4;
            const secondTurn = (direction(second.start, second.end) - previousDirection + 4) % 4;
            return preference.indexOf(firstTurn) - preference.indexOf(secondTurn);
        })[0];
};

const createBoundaryEdges = function (mask, width, height) {
    const edges = [];
    const isForeground = (x, y) => x >= 0 && x < width
        && y >= 0 && y < height
        && mask[y * width + x] === 1;

    const addEdge = (start, end) => edges.push({ start, end, used: false });

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!isForeground(x, y)) continue;
            if (!isForeground(x, y - 1)) addEdge({ x, y }, { x: x + 1, y });
            if (!isForeground(x + 1, y)) {
                addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 });
            }
            if (!isForeground(x, y + 1)) {
                addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
            }
            if (!isForeground(x - 1, y)) addEdge({ x, y: y + 1 }, { x, y });
        }
    }
    return edges;
};

const linkEdges = function (edges) {
    const byStart = new Map();
    for (const edge of edges) {
        const key = pointKey(edge.start);
        if (!byStart.has(key)) byStart.set(key, []);
        byStart.get(key).push(edge);
    }

    const contours = [];
    for (const startEdge of edges) {
        if (startEdge.used) continue;

        const points = [startEdge.start];
        let edge = startEdge;
        let previousDirection = direction(edge.start, edge.end);

        while (edge) {
            edge.used = true;
            points.push(edge.end);
            if (pointKey(edge.end) === pointKey(points[0])) break;
            edge = selectNextEdge(byStart.get(pointKey(edge.end)) || [], previousDirection);
            if (edge) previousDirection = direction(edge.start, edge.end);
        }

        if (points.length >= 4 && pointKey(points[0]) === pointKey(points[points.length - 1])) {
            contours.push(points.slice(0, -1));
        }
    }
    return contours;
};

const assignHierarchy = function (contours) {
    const ordered = contours
        .map(points => ({
            points,
            area: polygonArea(points),
            bounds: contourBounds(points),
            parent: null,
            depth: 0
        }))
        .sort((first, second) => Math.abs(second.area) - Math.abs(first.area));

    for (let childIndex = 0; childIndex < ordered.length; childIndex++) {
        const child = ordered[childIndex];
        const sample = child.points[0];
        let parent = null;
        for (let parentIndex = 0; parentIndex < childIndex; parentIndex++) {
            const candidate = ordered[parentIndex];
            if (!pointInPolygon(sample, candidate.points)) continue;
            if (!parent || Math.abs(candidate.area) < Math.abs(parent.area)) parent = candidate;
        }
        child.parent = parent;
        child.depth = parent ? parent.depth + 1 : 0;
    }

    return ordered.sort((first, second) =>
        first.depth - second.depth || Math.abs(second.area) - Math.abs(first.area));
};

export const traceContours = function (mask, width, height, tolerance = 1.25) {
    const rawContours = linkEdges(createBoundaryEdges(mask, width, height));
    const simplified = rawContours.map(points => simplifyClosedContour(points, tolerance));
    return assignHierarchy(simplified);
};

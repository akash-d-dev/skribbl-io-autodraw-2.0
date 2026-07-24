const squaredDistance = function (a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
};

const squaredSegmentDistance = function (point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return squaredDistance(point, start);

    const position = Math.max(0, Math.min(1,
        ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return squaredDistance(point, {
        x: start.x + position * dx,
        y: start.y + position * dy
    });
};

const simplifyOpenPath = function (points, toleranceSquared) {
    if (points.length <= 2) return points.slice();

    let splitIndex = -1;
    let maximumDistance = toleranceSquared;
    for (let index = 1; index < points.length - 1; index++) {
        const distance = squaredSegmentDistance(
            points[index],
            points[0],
            points[points.length - 1]
        );
        if (distance > maximumDistance) {
            maximumDistance = distance;
            splitIndex = index;
        }
    }

    if (splitIndex === -1) return [points[0], points[points.length - 1]];

    const left = simplifyOpenPath(points.slice(0, splitIndex + 1), toleranceSquared);
    const right = simplifyOpenPath(points.slice(splitIndex), toleranceSquared);
    return left.slice(0, -1).concat(right);
};

const orientation = function (a, b, c) {
    const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
    if (Math.abs(value) < Number.EPSILON) return 0;
    return value > 0 ? 1 : 2;
};

const onSegment = function (a, b, point) {
    return point.x <= Math.max(a.x, b.x)
        && point.x >= Math.min(a.x, b.x)
        && point.y <= Math.max(a.y, b.y)
        && point.y >= Math.min(a.y, b.y);
};

const segmentsIntersect = function (a1, a2, b1, b2) {
    const o1 = orientation(a1, a2, b1);
    const o2 = orientation(a1, a2, b2);
    const o3 = orientation(b1, b2, a1);
    const o4 = orientation(b1, b2, a2);

    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(a1, a2, b1)) return true;
    if (o2 === 0 && onSegment(a1, a2, b2)) return true;
    if (o3 === 0 && onSegment(b1, b2, a1)) return true;
    return o4 === 0 && onSegment(b1, b2, a2);
};

export const polygonArea = function (points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const next = points[(index + 1) % points.length];
        area += points[index].x * next.y - next.x * points[index].y;
    }
    return area / 2;
};

export const pointInPolygon = function (point, polygon) {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1;
        current < polygon.length;
        previous = current++) {
        const a = polygon[current];
        const b = polygon[previous];
        const crosses = (a.y > point.y) !== (b.y > point.y)
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
        if (crosses) inside = !inside;
    }
    return inside;
};

export const hasSelfIntersection = function (points) {
    for (let first = 0; first < points.length; first++) {
        const firstNext = (first + 1) % points.length;
        for (let second = first + 1; second < points.length; second++) {
            const secondNext = (second + 1) % points.length;
            if (first === second || firstNext === second || secondNext === first) continue;
            if (segmentsIntersect(
                points[first],
                points[firstNext],
                points[second],
                points[secondNext]
            )) return true;
        }
    }
    return false;
};

export const simplifyClosedContour = function (points, tolerance = 1.25) {
    if (points.length <= 4) return points.slice();

    let firstAnchor = 0;
    let secondAnchor = 1;
    for (let index = 1; index < points.length; index++) {
        if (squaredDistance(points[0], points[index])
            > squaredDistance(points[0], points[secondAnchor])) {
            secondAnchor = index;
        }
    }

    let farthestDistance = -1;
    for (let index = 0; index < points.length; index++) {
        const distance = squaredDistance(points[secondAnchor], points[index]);
        if (distance > farthestDistance) {
            farthestDistance = distance;
            firstAnchor = index;
        }
    }

    const buildArc = function (start, end) {
        const arc = [points[start]];
        let index = start;
        while (index !== end) {
            index = (index + 1) % points.length;
            arc.push(points[index]);
        }
        return arc;
    };

    const toleranceSquared = tolerance * tolerance;
    const firstArc = simplifyOpenPath(
        buildArc(firstAnchor, secondAnchor),
        toleranceSquared
    );
    const secondArc = simplifyOpenPath(
        buildArc(secondAnchor, firstAnchor),
        toleranceSquared
    );
    const simplified = firstArc.slice(0, -1).concat(secondArc.slice(0, -1));

    if (simplified.length < 3 || hasSelfIntersection(simplified)) return points.slice();
    return simplified;
};

export const contourBounds = function (points) {
    const bounds = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    };
    for (const point of points) {
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    return bounds;
};

export const offsetClosedContour = function (points, distance, towardRight) {
    const offset = points.map((point, index) => {
        const previous = points[(index + points.length - 1) % points.length];
        const next = points[(index + 1) % points.length];
        const previousLength = Math.hypot(point.x - previous.x, point.y - previous.y);
        const nextLength = Math.hypot(next.x - point.x, next.y - point.y);
        if (!previousLength || !nextLength) return point;

        const multiplier = towardRight ? 1 : -1;
        const previousNormal = {
            x: -(point.y - previous.y) / previousLength * multiplier,
            y: (point.x - previous.x) / previousLength * multiplier
        };
        const nextNormal = {
            x: -(next.y - point.y) / nextLength * multiplier,
            y: (next.x - point.x) / nextLength * multiplier
        };
        const normalLength = Math.hypot(
            previousNormal.x + nextNormal.x,
            previousNormal.y + nextNormal.y
        );
        if (!normalLength) {
            return {
                x: point.x + nextNormal.x * distance,
                y: point.y + nextNormal.y * distance
            };
        }

        const miter = {
            x: (previousNormal.x + nextNormal.x) / normalLength,
            y: (previousNormal.y + nextNormal.y) / normalLength
        };
        const alignment = Math.max(0.5,
            miter.x * nextNormal.x + miter.y * nextNormal.y);
        const miterDistance = Math.min(distance * 2, distance / alignment);
        return {
            x: point.x + miter.x * miterDistance,
            y: point.y + miter.y * miterDistance
        };
    });
    return hasSelfIntersection(offset) ? points.slice() : offset;
};

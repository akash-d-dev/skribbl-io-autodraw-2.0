import { colorsEqual } from "./color-utils.js";

const brushRadius = 1.45;

const distanceToSegmentSquared = function (x, y, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const position = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared));
    const nearestX = from.x + position * dx;
    const nearestY = from.y + position * dy;
    return (x - nearestX) ** 2 + (y - nearestY) ** 2;
};

const drawSegment = function (raster, width, height, from, to, value) {
    const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) - brushRadius));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + brushRadius));
    const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) - brushRadius));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + brushRadius));

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (distanceToSegmentSquared(
                x + 0.5,
                y + 0.5,
                from,
                to
            ) <= brushRadius * brushRadius) raster[y * width + x] = value;
        }
    }
};

const drawStroke = function (raster, width, height, command, value) {
    drawSegment(raster, width, height, command.from, command.to, value);
};

const drawPolyline = function (raster, width, height, command, value) {
    for (let index = 0; index < command.points.length - 1; index++) {
        drawSegment(
            raster,
            width,
            height,
            command.points[index],
            command.points[index + 1],
            value
        );
    }
};

const floodFill = function (raster, width, height, point, value) {
    const seedX = Math.max(0, Math.min(width - 1, Math.floor(point.x)));
    const seedY = Math.max(0, Math.min(height - 1, Math.floor(point.y)));
    const seed = seedY * width + seedX;
    const replaced = raster[seed];
    if (replaced === value) return;

    const queue = [seed];
    raster[seed] = value;
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const pixel = queue[cursor];
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        const neighbors = [
            x > 0 ? pixel - 1 : -1,
            x + 1 < width ? pixel + 1 : -1,
            y > 0 ? pixel - width : -1,
            y + 1 < height ? pixel + width : -1
        ];
        for (const next of neighbors) {
            if (next < 0 || raster[next] !== replaced) continue;
            raster[next] = value;
            queue.push(next);
        }
    }
};

export const rasterizeBinaryPlan = function (plan) {
    const target = plan.target;
    const raster = new Uint8Array(target.width * target.height);
    for (const command of plan.commands) {
        const value = colorsEqual(command.color, target.foregroundColor) ? 1 : 0;
        if (command.kind === "stroke") {
            drawStroke(raster, target.width, target.height, command, value);
        } else if (command.kind === "polyline") {
            drawPolyline(raster, target.width, target.height, command, value);
        } else {
            floodFill(raster, target.width, target.height, command.point, value);
        }
    }
    return raster;
};

export const binaryIntersectionOverUnion = function (first, second) {
    let intersection = 0;
    let union = 0;
    for (let pixel = 0; pixel < first.length; pixel++) {
        if (first[pixel] || second[pixel]) union++;
        if (first[pixel] && second[pixel]) intersection++;
    }
    return union ? intersection / union : 1;
};

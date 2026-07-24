import { closestPaletteColor, colorKey, colorsEqual } from "./color-utils.js";
import { distanceInsideValue } from "./distance-map.js";

const white = { r: 255, g: 255, b: 255 };
const gridScale = 2.9;
const pens = [
    { diameter: 40, coverageRadius: 14.4 / gridScale, safeRadius: 21 / gridScale },
    { diameter: 20, coverageRadius: 7.2 / gridScale, safeRadius: 11 / gridScale },
    { diameter: 10, coverageRadius: 3.6 / gridScale, safeRadius: 6 / gridScale },
    { diameter: 4, coverageRadius: 1.45 / gridScale, safeRadius: 0 }
];

const downsample = function (image) {
    const width = Math.max(1, Math.round(image.width / gridScale));
    const height = Math.max(1, Math.round(image.height / gridScale));
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sourceX = Math.min(image.width - 1, Math.round((x + 0.5) * gridScale - 0.5));
            const sourceY = Math.min(image.height - 1, Math.round((y + 0.5) * gridScale - 0.5));
            const source = (sourceY * image.width + sourceX) * 4;
            const target = (y * width + x) * 4;
            data[target] = image.data[source];
            data[target + 1] = image.data[source + 1];
            data[target + 2] = image.data[source + 2];
            data[target + 3] = image.data[source + 3];
        }
    }
    return { width, height, data };
};

const quantize = function (image, palette) {
    const colors = [];
    const colorIndexes = new Map();
    const cache = new Map();
    const indexes = new Int16Array(image.width * image.height);

    for (let pixel = 0; pixel < indexes.length; pixel++) {
        const source = pixel * 4;
        const alpha = image.data[source + 3] / 255;
        const sourceColor = {
            r: Math.round(image.data[source] * alpha + 255 * (1 - alpha)),
            g: Math.round(image.data[source + 1] * alpha + 255 * (1 - alpha)),
            b: Math.round(image.data[source + 2] * alpha + 255 * (1 - alpha))
        };
        const reducedKey = `${sourceColor.r >> 3},${sourceColor.g >> 3},${sourceColor.b >> 3}`;
        let mapped = cache.get(reducedKey);
        if (!mapped) {
            mapped = closestPaletteColor(sourceColor, palette);
            cache.set(reducedKey, mapped);
        }
        const key = colorKey(mapped);
        if (!colorIndexes.has(key)) {
            colorIndexes.set(key, colors.length);
            colors.push(mapped);
        }
        indexes[pixel] = colorIndexes.get(key);
    }
    return { colors, indexes };
};

const smoothIsolatedPixels = function (indexes, width, height) {
    const source = indexes.slice();
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const pixel = y * width + x;
            const counts = new Map();
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const color = source[(y + dy) * width + x + dx];
                    counts.set(color, (counts.get(color) || 0) + 1);
                }
            }
            const currentCount = counts.get(source[pixel]);
            const dominant = [...counts.entries()]
                .sort((first, second) => second[1] - first[1])[0];
            if (currentCount <= 2 && dominant[1] >= 5) indexes[pixel] = dominant[0];
        }
    }
};

const mostCommonColor = function (indexes, colorCount) {
    const counts = new Uint32Array(colorCount);
    for (const color of indexes) counts[color]++;
    let best = 0;
    for (let color = 1; color < counts.length; color++) {
        if (counts[color] > counts[best]) best = color;
    }
    return best;
};

const pointSegmentDistanceSquared = function (x, y, stroke) {
    const dx = stroke.x2 - stroke.x1;
    const dy = stroke.y2 - stroke.y1;
    const lengthSquared = dx * dx + dy * dy;
    const position = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        ((x - stroke.x1) * dx + (y - stroke.y1) * dy) / lengthSquared));
    const nearestX = stroke.x1 + position * dx;
    const nearestY = stroke.y1 + position * dy;
    return (x - nearestX) ** 2 + (y - nearestY) ** 2;
};

const walkCapsule = function (stroke, radius, width, height, visit) {
    const extent = Math.ceil(radius);
    const minX = Math.max(0, Math.floor(Math.min(stroke.x1, stroke.x2) - extent));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(stroke.x1, stroke.x2) + extent));
    const minY = Math.max(0, Math.floor(Math.min(stroke.y1, stroke.y2) - extent));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(stroke.y1, stroke.y2) + extent));
    const radiusSquared = radius * radius;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (pointSegmentDistanceSquared(x, y, stroke) <= radiusSquared) {
                visit(y * width + x);
            }
        }
    }
};

const candidateRuns = function (safe, width, height, color, diameter) {
    const candidates = [];
    for (let y = 0; y < height; y++) {
        let x = 0;
        while (x < width) {
            while (x < width && !safe[y * width + x]) x++;
            const start = x;
            while (x < width && safe[y * width + x]) x++;
            if (x > start) {
                candidates.push({
                    color,
                    diameter,
                    x1: start,
                    y1: y,
                    x2: x - 1,
                    y2: y,
                    length: x - start
                });
            }
        }
    }
    for (let x = 0; x < width; x++) {
        let y = 0;
        while (y < height) {
            while (y < height && !safe[y * width + x]) y++;
            const start = y;
            while (y < height && safe[y * width + x]) y++;
            if (y > start) {
                candidates.push({
                    color,
                    diameter,
                    x1: x,
                    y1: start,
                    x2: x,
                    y2: y - 1,
                    length: y - start
                });
            }
        }
    }
    return candidates;
};

const countAndMark = function ({
    stroke,
    radius,
    width,
    height,
    indexes,
    covered,
    mark
}) {
    let count = 0;
    walkCapsule(stroke, radius, width, height, pixel => {
        if (indexes[pixel] !== stroke.color || covered[pixel]) return;
        count++;
        if (mark) covered[pixel] = 1;
    });
    return count;
};

const residualRuns = function (indexes, covered, width, height, background) {
    const strokes = [];
    for (let y = 0; y < height; y++) {
        let x = 0;
        while (x < width) {
            const color = indexes[y * width + x];
            let end = x;
            while (end + 1 < width && indexes[y * width + end + 1] === color) end++;
            let needsCoverage = false;
            for (let current = x; current <= end; current++) {
                if (!covered[y * width + current]) {
                    needsCoverage = true;
                    break;
                }
            }
            if (color !== background && needsCoverage) {
                strokes.push({
                    color,
                    diameter: 4,
                    x1: x,
                    y1: y,
                    x2: end,
                    y2: y
                });
            }
            x = end + 1;
        }
    }
    return strokes;
};

export const planColorImage = function ({ image, palette, offset }) {
    const gridImage = downsample(image);
    const { colors, indexes } = quantize(gridImage, palette);
    smoothIsolatedPixels(indexes, gridImage.width, gridImage.height);
    const background = mostCommonColor(indexes, colors.length);
    const covered = new Uint8Array(indexes.length);
    for (let pixel = 0; pixel < indexes.length; pixel++) {
        if (indexes[pixel] === background) covered[pixel] = 1;
    }

    const strokes = [];
    for (const pen of pens) {
        const candidates = [];
        for (let color = 0; color < colors.length; color++) {
            if (color === background) continue;
            const mask = Uint8Array.from(indexes, value => value === color ? 1 : 0);
            const distance = distanceInsideValue(mask, gridImage.width, gridImage.height, 1);
            const safe = Uint8Array.from(distance, value =>
                value >= pen.safeRadius && value > 0 ? 1 : 0);
            candidates.push(...candidateRuns(
                safe,
                gridImage.width,
                gridImage.height,
                color,
                pen.diameter
            ));
        }

        candidates.sort((first, second) => second.length - first.length);
        for (const candidate of candidates) {
            const newCoverage = countAndMark({
                stroke: candidate,
                radius: pen.coverageRadius,
                width: gridImage.width,
                height: gridImage.height,
                indexes,
                covered,
                mark: false
            });
            if (newCoverage < Math.max(2, Math.floor(pen.coverageRadius * 2))) continue;
            countAndMark({
                stroke: candidate,
                radius: pen.coverageRadius,
                width: gridImage.width,
                height: gridImage.height,
                indexes,
                covered,
                mark: true
            });
            strokes.push(candidate);
        }
    }
    strokes.push(...residualRuns(
        indexes,
        covered,
        gridImage.width,
        gridImage.height,
        background
    ));

    const commands = [];
    if (!colorsEqual(colors[background], white)) {
        commands.push({
            kind: "fill",
            color: colors[background],
            point: { x: 1, y: 1 }
        });
    }
    for (const stroke of strokes) {
        commands.push({
            kind: "stroke",
            color: colors[stroke.color],
            diameter: stroke.diameter,
            from: {
                x: (stroke.x1 + 0.5) * gridScale + offset.x,
                y: (stroke.y1 + 0.5) * gridScale + offset.y
            },
            to: {
                x: (stroke.x2 + 0.5) * gridScale + offset.x,
                y: (stroke.y2 + 0.5) * gridScale + offset.y
            }
        });
    }

    return {
        mode: "color",
        confidence: 0,
        commands,
        target: null,
        metrics: {
            colors: colors.length,
            commands: commands.length,
            grid: { width: gridImage.width, height: gridImage.height }
        }
    };
};

import { closestPaletteColor, colorKey, colorsEqual } from "./color-utils.js";
import { planSegments } from "./command-cost.js";
import { traceContours } from "./contour-tracer.js";
import { chainRuns } from "./serpentine.js";
import { distanceInsideValue } from "./distance-map.js";
import { evaluateFilledRegion } from "./fill-verifier.js";
import { offsetClosedContour, pointInPolygon } from "./geometry.js";

const white = { r: 255, g: 255, b: 255 };
const defaultGridScale = 2.9;

// Measured painted diameters are [3, 9, 19, 31, 39] with no anti-aliasing, so the
// coverage radius is exactly half the painted diameter. The previous table assumed
// an effective factor of ~0.72 (14.4 for "40" vs a true 19.5), under-crediting every
// wide stroke and re-covering pixels already painted -- the cause of the measured 3x
// overdraw. safeRadius keeps a stroke off the region boundary; it is the coverage
// radius plus a grid cell of slack, in grid units.
const measuredPens = [
    { diameter: 40, paintedDiameter: 39 },
    { diameter: 32, paintedDiameter: 31 },
    { diameter: 20, paintedDiameter: 19 },
    { diameter: 10, paintedDiameter: 9 },
    { diameter: 4, paintedDiameter: 3 }
];

// Coarsening the grid is the cheapest way to cut segment count, and each segment
// costs two animation frames, so it maps directly to draw time. Set per plan.
let gridScale = defaultGridScale;
let pens = [];
let penSlackCells = 1;
const configureGrid = function (scale, slack = penSlackCells) {
    gridScale = scale;
    penSlackCells = slack;
    pens = measuredPens.map(function (pen) {
        const coverageRadius = pen.paintedDiameter / 2 / gridScale;
        return {
            diameter: pen.diameter,
            coverageRadius,
            safeRadius: pen.diameter === 4 ? 0 : coverageRadius + penSlackCells
        };
    });
};
configureGrid(defaultGridScale);

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

// A 3x3 majority pass. Speckle is the single biggest consumer of draw time: every
// stray one-cell run becomes its own stroke, and a stroke costs two animation frames
// regardless of how little it covers. Removing it cuts segments AND error, unlike
// coarsening the grid, which trades error away for speed.
const smoothIsolatedPixels = function (indexes, width, height, passes = 1) {
    for (let pass = 0; pass < passes; pass++) {
        const source = indexes.slice();
        let changed = 0;
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
                if (dominant[0] === source[pixel]) continue;
                if (currentCount <= 3 && dominant[1] >= 4) {
                    indexes[pixel] = dominant[0];
                    changed++;
                }
            }
        }
        if (!changed) break;
    }
};

// Dissolve components too small to be worth their own strokes into whichever
// neighbouring color already borders them most.
const absorbSmallComponents = function (indexes, width, height, minimumArea) {
    const visited = new Uint8Array(indexes.length);

    for (let start = 0; start < indexes.length; start++) {
        if (visited[start]) continue;
        const color = indexes[start];
        const queue = [start];
        const component = [];
        visited[start] = 1;

        for (let cursor = 0; cursor < queue.length; cursor++) {
            const pixel = queue[cursor];
            component.push(pixel);
            const x = pixel % width;
            const y = (pixel - x) / width;
            const neighbors = [
                x > 0 ? pixel - 1 : -1,
                x + 1 < width ? pixel + 1 : -1,
                y > 0 ? pixel - width : -1,
                y + 1 < height ? pixel + width : -1
            ];
            for (const next of neighbors) {
                if (next < 0 || visited[next] || indexes[next] !== color) continue;
                visited[next] = 1;
                queue.push(next);
            }
        }
        if (component.length >= minimumArea) continue;

        const borderCounts = new Map();
        for (const pixel of component) {
            const x = pixel % width;
            const y = (pixel - x) / width;
            const neighbors = [
                x > 0 ? pixel - 1 : -1,
                x + 1 < width ? pixel + 1 : -1,
                y > 0 ? pixel - width : -1,
                y + 1 < height ? pixel + width : -1
            ];
            for (const next of neighbors) {
                if (next < 0 || indexes[next] === color) continue;
                borderCounts.set(indexes[next], (borderCounts.get(indexes[next]) || 0) + 1);
            }
        }
        if (!borderCounts.size) continue;
        const replacement = [...borderCounts.entries()]
            .sort((first, second) => second[1] - first[1])[0][0];
        for (const pixel of component) indexes[pixel] = replacement;
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

const labelColorComponents = function (indexes, width, height, color) {
    const labels = new Int32Array(indexes.length);
    labels.fill(-1);
    const components = [];

    for (let start = 0; start < indexes.length; start++) {
        if (indexes[start] !== color || labels[start] !== -1) continue;
        const id = components.length;
        const pixels = [start];
        labels[start] = id;
        for (let cursor = 0; cursor < pixels.length; cursor++) {
            const pixel = pixels[cursor];
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            const neighbors = [
                x > 0 ? pixel - 1 : -1,
                x + 1 < width ? pixel + 1 : -1,
                y > 0 ? pixel - width : -1,
                y + 1 < height ? pixel + width : -1
            ];
            for (const next of neighbors) {
                if (next < 0 || indexes[next] !== color || labels[next] !== -1) continue;
                labels[next] = id;
                pixels.push(next);
            }
        }
        components.push({ id, pixels, horizontalRuns: 0 });
    }

    for (const component of components) {
        for (const pixel of component.pixels) {
            const x = pixel % width;
            if (x === 0 || labels[pixel - 1] !== component.id) component.horizontalRuns++;
        }
    }
    return { labels, components };
};

// Outline simplification levels tried per region, cheapest (coarsest) first.
const fillToleranceCandidates = [0.75, 1.5, 2.5, 4];
const fillFidelityFloor = 0.9;

// The same component traced at a coarser tolerance: the contour whose polygon still
// contains the seed we already picked.
const matchContour = function (contours, seed) {
    let best = null;
    for (const contour of contours) {
        if (contour.depth !== 0) continue;
        if (!pointInPolygon(seed, contour.points)) continue;
        if (!best || Math.abs(contour.area) < Math.abs(best.area)) best = contour;
    }
    return best;
};

const findContourSeed = function (
    contour,
    mask,
    distance,
    width,
    height,
    targetValue = 1
) {
    const minX = Math.max(0, Math.floor(contour.bounds.minX));
    const minY = Math.max(0, Math.floor(contour.bounds.minY));
    const maxX = Math.min(width - 1, Math.ceil(contour.bounds.maxX));
    const maxY = Math.min(height - 1, Math.ceil(contour.bounds.maxY));
    let seed = null;
    let clearance = -1;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const pixel = y * width + x;
            if (mask[pixel] !== targetValue || distance[pixel] <= clearance) continue;
            const point = { x: x + 0.5, y: y + 0.5 };
            if (!pointInPolygon(point, contour.points)) continue;
            seed = { ...point, pixel };
            clearance = distance[pixel];
        }
    }
    return seed ? { ...seed, clearance } : null;
};

const createFilledRegionCommands = function ({
    indexes,
    colors,
    background,
    width,
    height,
    offset,
    geometryFor
}) {
    const regions = [];
    // One closed polyline per contour; a stroke per edge costs V commands for the
    // same geometry.
    const createContourCommands = function (points, color) {
        if (points.length < 2) return [];
        const translated = points.map(point => ({
            x: point.x * gridScale + offset.x,
            y: point.y * gridScale + offset.y
        }));
        translated.push(translated[0]);
        return [{ kind: "polyline", color, diameter: 4, points: translated }];
    };

    for (let color = 0; color < colors.length; color++) {
        if (color === background) continue;
        const { mask, distance, inverseDistance } = geometryFor(color);
        const contoursByTolerance = new Map(
            fillToleranceCandidates.map(tolerance =>
                [tolerance, traceContours(mask, width, height, tolerance)])
        );
        const contours = contoursByTolerance.get(fillToleranceCandidates[0]);
        const { labels, components } = labelColorComponents(
            indexes,
            width,
            height,
            color
        );

        for (const contour of contours) {
            if (contour.depth !== 0) continue;

            const seed = findContourSeed(contour, mask, distance, width, height);
            if (!seed || seed.clearance < 1.5) continue;
            const component = components[labels[seed.pixel]];
            if (!component || component.pixels.length < 30) continue;

            // A fill costs one command whatever the area, so the outline dominates its
            // price. Take the most simplified outline that still holds the fill in:
            // coarser contours are cheaper AND measured more reliable to draw, but
            // eventually open a gap or distort the shape. evaluateFilledRegion catches
            // both, so this searches rather than guessing a single tolerance.
            const penRadius = pens[pens.length - 1].coverageRadius;
            let chosen = null;
            for (const tolerance of [...fillToleranceCandidates].reverse()) {
                const candidateContour = tolerance === fillToleranceCandidates[0]
                    ? contour
                    : matchContour(contoursByTolerance.get(tolerance), seed);
                if (!candidateContour) continue;

                const candidatePoints = offsetClosedContour(
                    candidateContour.points,
                    0.5,
                    true
                );
                const verdict = evaluateFilledRegion({
                    points: candidatePoints,
                    seedPixel: seed.pixel,
                    radius: penRadius,
                    width,
                    height,
                    regionPixels: component.pixels
                });
                if (verdict.escaped) continue;
                if (verdict.intersectionOverUnion < fillFidelityFloor) continue;
                chosen = { points: candidatePoints, verdict };
                break;
            }
            if (!chosen) continue;

            const points = chosen.points;
            const commands = createContourCommands(points, colors[color]);
            commands.push({
                kind: "fill",
                color: colors[color],
                point: {
                    x: seed.x * gridScale + offset.x,
                    y: seed.y * gridScale + offset.y
                }
            });

            const holes = contours.filter(candidate => candidate.parent === contour);
            for (const hole of holes) {
                const holeSeed = findContourSeed(
                    hole,
                    mask,
                    inverseDistance,
                    width,
                    height,
                    0
                );
                if (!holeSeed || holeSeed.clearance < 1.5) continue;
                const holeColor = indexes[holeSeed.pixel];
                const holePoints = offsetClosedContour(hole.points, 0.5, false);
                commands.push(...createContourCommands(holePoints, colors[holeColor]));
                commands.push({
                    kind: "fill",
                    color: colors[holeColor],
                    point: {
                        x: holeSeed.x * gridScale + offset.x,
                        y: holeSeed.y * gridScale + offset.y
                    }
                });
            }

            // Compared in segments, not commands: a contour is now a single
            // command, so a command-count test would accept every region.
            if (planSegments(commands) > component.horizontalRuns * 0.9) continue;
            regions.push({
                area: component.pixels.length,
                color,
                pixels: component.pixels,
                outer: contour.points,
                seed,
                commands,
                baselineStrokes: 0
            });
        }
    }
    regions.sort((first, second) => second.area - first.area);
    for (let index = 0; index < regions.length; index++) {
        const region = regions[index];
        let parent = null;
        for (let candidateIndex = 0; candidateIndex < index; candidateIndex++) {
            const candidate = regions[candidateIndex];
            if (!pointInPolygon(region.seed, candidate.outer)) continue;
            if (!parent || candidate.area < parent.area) parent = candidate;
        }
        region.parent = parent;
        region.depth = parent ? parent.depth + 1 : 0;
    }
    regions.sort((first, second) =>
        first.depth - second.depth || second.area - first.area);
    return regions;
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

export const planColorImage = function ({
    image,
    palette,
    offset,
    gridScale: requestedGridScale = defaultGridScale,
    // Measured on promo-image at grid 2.9: these cut 3,957 segments to 2,681, i.e.
    // 55.0s -> 37.3s of drawing, for a mean-error rise of 39.5 -> 43.0. Coarsening the
    // grid to 4.0 reaches the same 35.6s but at error 47.3, so despeckling is
    // strictly the better trade and is preferred over a coarser grid.
    despecklePasses = 2,
    minimumComponentArea = 8,
    // Chaining runs into serpentine polylines is a measured LOSS: draw cost is per
    // segment (two animation frames each), and every lane-to-lane connector is an
    // extra segment. Unchained is 2,528 -> 1,599 segments on promo-image, 35.1s ->
    // 22.2s, at identical error. Kept switchable only because it would win again if
    // segments ever became batchable.
    chainSerpentines = false,
    // Clearance a wide pen keeps from a region boundary, in grid cells, on top of its
    // own radius. Tightening 1 -> 0.25 lets the wide pens actually get used:
    // 1,599 -> 1,269 segments for a mean-error change of only 42.6 -> 43.1.
    penSlack = 0.25
}) {
    configureGrid(requestedGridScale, penSlack);
    const gridImage = downsample(image);
    const { colors, indexes } = quantize(gridImage, palette);
    smoothIsolatedPixels(indexes, gridImage.width, gridImage.height, despecklePasses);
    if (minimumComponentArea > 1) {
        absorbSmallComponents(
            indexes,
            gridImage.width,
            gridImage.height,
            minimumComponentArea
        );
    }
    const background = mostCommonColor(indexes, colors.length);
    const covered = new Uint8Array(indexes.length);
    for (let pixel = 0; pixel < indexes.length; pixel++) {
        if (indexes[pixel] === background) covered[pixel] = 1;
    }

    const geometryByColor = new Map();
    const geometryFor = function (color) {
        if (!geometryByColor.has(color)) {
            const mask = Uint8Array.from(indexes, value => value === color ? 1 : 0);
            geometryByColor.set(color, {
                mask,
                distance: distanceInsideValue(mask, gridImage.width, gridImage.height, 1),
                inverseDistance: distanceInsideValue(
                    mask,
                    gridImage.width,
                    gridImage.height,
                    0
                )
            });
        }
        return geometryByColor.get(color);
    };
    const filledRegions = createFilledRegionCommands({
        indexes,
        colors,
        background,
        width: gridImage.width,
        height: gridImage.height,
        offset,
        geometryFor
    });

    const strokes = [];
    for (const pen of pens) {
        const candidates = [];
        for (let color = 0; color < colors.length; color++) {
            if (color === background) continue;
            const { distance } = geometryFor(color);
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
    const baselineCommands = strokes.length
        + (colorsEqual(colors[background], white) ? 0 : 1);

    const regionByPixel = new Int32Array(indexes.length);
    regionByPixel.fill(-1);
    for (let index = 0; index < filledRegions.length; index++) {
        for (const pixel of filledRegions[index].pixels) regionByPixel[pixel] = index;
    }
    for (const stroke of strokes) {
        const x = Math.max(0, Math.min(
            gridImage.width - 1,
            Math.round((stroke.x1 + stroke.x2) / 2)
        ));
        const y = Math.max(0, Math.min(
            gridImage.height - 1,
            Math.round((stroke.y1 + stroke.y2) / 2)
        ));
        const regionIndex = regionByPixel[y * gridImage.width + x];
        if (regionIndex < 0 || filledRegions[regionIndex].color !== stroke.color) continue;
        stroke.regionIndex = regionIndex;
        filledRegions[regionIndex].baselineStrokes++;
    }
    const selectedRegions = filledRegions.filter(region =>
        planSegments(region.commands) < region.baselineStrokes * 0.8);
    const selectedRegionIndexes = new Set(
        selectedRegions.map(region => filledRegions.indexOf(region))
    );
    const remainingStrokes = strokes.filter(stroke =>
        !selectedRegionIndexes.has(stroke.regionIndex));

    const commands = [];
    if (!colorsEqual(colors[background], white)) {
        commands.push({
            kind: "fill",
            color: colors[background],
            point: { x: 1, y: 1 }
        });
    }
    for (const region of selectedRegions) commands.push(...region.commands);

    // Group by (pen, color) so the plan runs coarse-to-fine and each color is
    // selected once per group instead of thrashing the palette, then chain each
    // group's runs into serpentine polylines.
    const groups = new Map();
    for (const stroke of remainingStrokes) {
        const key = `${stroke.diameter},${stroke.color}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(stroke);
    }
    const orderedKeys = [...groups.keys()].sort((first, second) => {
        const [firstDiameter, firstColor] = first.split(",").map(Number);
        const [secondDiameter, secondColor] = second.split(",").map(Number);
        return secondDiameter - firstDiameter || firstColor - secondColor;
    });

    const toCanvas = point => ({
        x: (point.x + 0.5) * gridScale + offset.x,
        y: (point.y + 0.5) * gridScale + offset.y
    });

    for (const key of orderedKeys) {
        const group = groups.get(key);
        const [diameter, color] = key.split(",").map(Number);
        const chains = chainSerpentines
            ? chainRuns(group)
            : group.map(run => [{ x: run.x1, y: run.y1 }, { x: run.x2, y: run.y2 }]);
        for (const chain of chains) {
            const points = chain.map(toCanvas);
            if (points.length === 2) {
                commands.push({
                    kind: "stroke",
                    color: colors[color],
                    diameter,
                    from: points[0],
                    to: points[1]
                });
                continue;
            }
            commands.push({ kind: "polyline", color: colors[color], diameter, points });
        }
    }

    return {
        mode: "color",
        confidence: 0,
        commands,
        target: null,
        metrics: {
            colors: colors.length,
            commands: commands.length,
            baselineCommands,
            filledRegions: selectedRegions.length,
            grid: { width: gridImage.width, height: gridImage.height }
        }
    };
};

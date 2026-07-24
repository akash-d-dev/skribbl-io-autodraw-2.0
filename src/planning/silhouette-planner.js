import { colorsEqual } from "./color-utils.js";
import {
    binaryIntersectionOverUnion,
    rasterizeBinaryPlan
} from "./binary-rasterizer.js";
import { traceContours } from "./contour-tracer.js";
import { distanceInsideValue } from "./distance-map.js";
import { offsetClosedContour, pointInPolygon } from "./geometry.js";

const white = { r: 255, g: 255, b: 255 };
const fidelityFloor = 0.98;
const optimizationCommandThreshold = 80;
const toleranceCandidates = [1.25, 1.75, 2.5, 3.5, 5];

const findFillSeed = function (contour, mask, width, height, targetValue, distance) {
    const minX = Math.max(0, Math.floor(contour.bounds.minX));
    const minY = Math.max(0, Math.floor(contour.bounds.minY));
    const maxX = Math.min(width - 1, Math.ceil(contour.bounds.maxX));
    const maxY = Math.min(height - 1, Math.ceil(contour.bounds.maxY));
    let best = null;
    let bestDistance = -1;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const pixel = y * width + x;
            if (mask[pixel] !== targetValue || distance[pixel] <= bestDistance) continue;
            const point = { x: x + 0.5, y: y + 0.5 };
            if (!pointInPolygon(point, contour.points)) continue;
            best = point;
            bestDistance = distance[pixel];
        }
    }
    return best ? { ...best, clearance: bestDistance } : null;
};

const contourCommands = function (points, color, offset) {
    const commands = [];
    for (let index = 0; index < points.length; index++) {
        const next = points[(index + 1) % points.length];
        commands.push({
            kind: "stroke",
            color,
            diameter: 4,
            from: {
                x: points[index].x + offset.x,
                y: points[index].y + offset.y
            },
            to: {
                x: next.x + offset.x,
                y: next.y + offset.y
            }
        });
    }
    return commands;
};

const createCanvasMask = function (mask, width, height, canvas, offset) {
    const canvasMask = new Uint8Array(canvas.width * canvas.height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!mask[y * width + x]) continue;
            const canvasX = x + offset.x;
            const canvasY = y + offset.y;
            if (canvasX < 0 || canvasX >= canvas.width || canvasY < 0 || canvasY >= canvas.height) {
                continue;
            }
            canvasMask[canvasY * canvas.width + canvasX] = 1;
        }
    }
    return canvasMask;
};

export const planSilhouette = function ({
    analysis,
    width,
    height,
    canvas,
    offset,
    contourTolerance = 1.25
}) {
    const foregroundDistance = distanceInsideValue(analysis.mask, width, height, 1);
    const backgroundDistance = distanceInsideValue(analysis.mask, width, height, 0);
    const target = {
        kind: "binary",
        width: canvas.width,
        height: canvas.height,
        mask: createCanvasMask(analysis.mask, width, height, canvas, offset),
        foregroundColor: analysis.foregroundColor,
        backgroundColor: analysis.backgroundColor
    };

    const buildCandidate = function (tolerance) {
        const contours = traceContours(analysis.mask, width, height, tolerance);
        const commands = [];
        if (!colorsEqual(analysis.backgroundColor, white)) {
            commands.push({
                kind: "fill",
                color: analysis.backgroundColor,
                point: { x: 1, y: 1 }
            });
        }

        for (const contour of contours) {
            const targetValue = contour.depth % 2 === 0 ? 1 : 0;
            const color = targetValue ? analysis.foregroundColor : analysis.backgroundColor;
            const seed = findFillSeed(
                contour,
                analysis.mask,
                width,
                height,
                targetValue,
                targetValue ? foregroundDistance : backgroundDistance
            );
            const drawableContour = seed && seed.clearance >= 3
                ? offsetClosedContour(contour.points, 1.45, targetValue === 1)
                : contour.points;
            commands.push(...contourCommands(drawableContour, color, offset));
            if (seed && seed.clearance >= 1.5) {
                commands.push({
                    kind: "fill",
                    color,
                    point: {
                        x: seed.x + offset.x,
                        y: seed.y + offset.y
                    }
                });
            }
        }
        return { contours, commands, tolerance };
    };

    const requestedTolerance = Math.max(contourTolerance, toleranceCandidates[0]);
    let best = buildCandidate(requestedTolerance);
    let fidelity = null;
    if (best.commands.length >= optimizationCommandThreshold) {
        const basePlan = { commands: best.commands, target };
        fidelity = binaryIntersectionOverUnion(
            rasterizeBinaryPlan(basePlan),
            target.mask
        );
        for (const tolerance of toleranceCandidates) {
            if (tolerance <= requestedTolerance) continue;
            const candidate = buildCandidate(tolerance);
            if (candidate.commands.length >= best.commands.length) continue;
            const candidateFidelity = binaryIntersectionOverUnion(
                rasterizeBinaryPlan({ commands: candidate.commands, target }),
                target.mask
            );
            if (candidateFidelity < fidelityFloor) continue;
            best = candidate;
            fidelity = candidateFidelity;
        }
    }

    return {
        mode: "silhouette",
        confidence: analysis.confidence,
        commands: best.commands,
        target,
        metrics: {
            contours: best.contours.length,
            commands: best.commands.length,
            contourTolerance: best.tolerance,
            simulatedIoU: fidelity,
            foregroundCoverage: analysis.stats.foregroundCoverage
        }
    };
};

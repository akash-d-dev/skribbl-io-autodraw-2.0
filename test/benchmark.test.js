import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { PNG } from "pngjs";

import { closestPaletteColor, colorKey, colorsEqual } from "../src/planning/color-utils.js";
import { createDrawPlan } from "../src/planning/planner.js";

const palette = [
    { r: 255, g: 255, b: 255 },
    { r: 0, g: 0, b: 0 },
    { r: 128, g: 128, b: 128 },
    { r: 192, g: 192, b: 192 },
    { r: 255, g: 0, b: 0 },
    { r: 128, g: 0, b: 0 },
    { r: 255, g: 128, b: 0 },
    { r: 255, g: 255, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 128, b: 0 },
    { r: 0, g: 255, b: 255 },
    { r: 0, g: 128, b: 255 },
    { r: 0, g: 0, b: 255 },
    { r: 0, g: 0, b: 128 },
    { r: 128, g: 0, b: 255 },
    { r: 128, g: 0, b: 128 },
    { r: 255, g: 0, b: 255 },
    { r: 255, g: 128, b: 255 },
    { r: 128, g: 64, b: 0 },
    { r: 255, g: 192, b: 128 }
];

const pointInPolygon = function (x, y, polygon) {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1;
        current < polygon.length;
        previous = current++) {
        const a = polygon[current];
        const b = polygon[previous];
        if ((a.y > y) !== (b.y > y)
            && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
};

const createStarImage = function (width, height) {
    const center = { x: width / 2, y: height / 2 };
    const outerRadius = Math.min(width, height) * 0.44;
    const innerRadius = outerRadius * 0.43;
    const points = [];
    for (let index = 0; index < 10; index++) {
        const angle = -Math.PI / 2 + index * Math.PI / 5;
        const radius = index % 2 === 0 ? outerRadius : innerRadius;
        points.push({
            x: center.x + Math.cos(angle) * radius,
            y: center.y + Math.sin(angle) * radius
        });
    }

    const data = new Uint8ClampedArray(width * height * 4);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixel = y * width + x;
            const foreground = pointInPolygon(x + 0.5, y + 0.5, points);
            mask[pixel] = foreground ? 1 : 0;
            const index = pixel * 4;
            data[index + 3] = foreground ? 255 : 0;
        }
    }
    return { image: { width, height, data }, mask };
};

const createDonutImage = function (width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    const mask = new Uint8Array(width * height);
    const centerX = width / 2;
    const centerY = height / 2;
    const outerRadius = Math.min(width, height) * 0.42;
    const innerRadius = outerRadius * 0.42;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
            const foreground = distance <= outerRadius && distance >= innerRadius;
            const pixel = y * width + x;
            mask[pixel] = foreground ? 1 : 0;
            data[pixel * 4 + 3] = foreground ? 255 : 0;
        }
    }
    return { image: { width, height, data }, mask };
};

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

const rasterizeSilhouette = function (plan) {
    const target = plan.target;
    const raster = new Uint8Array(target.width * target.height);
    const foregroundColor = target.foregroundColor;

    for (const command of plan.commands) {
        const value = colorsEqual(command.color, foregroundColor) ? 1 : 0;
        if (command.kind === "stroke") {
            const radius = 1.45;
            const minX = Math.max(0, Math.floor(Math.min(command.from.x, command.to.x) - radius));
            const maxX = Math.min(target.width - 1,
                Math.ceil(Math.max(command.from.x, command.to.x) + radius));
            const minY = Math.max(0, Math.floor(Math.min(command.from.y, command.to.y) - radius));
            const maxY = Math.min(target.height - 1,
                Math.ceil(Math.max(command.from.y, command.to.y) + radius));
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    if (distanceToSegmentSquared(
                        x + 0.5,
                        y + 0.5,
                        command.from,
                        command.to
                    ) <= radius * radius) raster[y * target.width + x] = value;
                }
            }
            continue;
        }

        const seedX = Math.floor(command.point.x);
        const seedY = Math.floor(command.point.y);
        const seed = seedY * target.width + seedX;
        const replaced = raster[seed];
        if (replaced === value) continue;
        const queue = [seed];
        raster[seed] = value;
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const pixel = queue[cursor];
            const x = pixel % target.width;
            const y = Math.floor(pixel / target.width);
            for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (nextX < 0 || nextX >= target.width || nextY < 0 || nextY >= target.height) {
                    continue;
                }
                const next = nextY * target.width + nextX;
                if (raster[next] !== replaced) continue;
                raster[next] = value;
                queue.push(next);
            }
        }
    }
    return raster;
};

const intersectionOverUnion = function (first, second) {
    let intersection = 0;
    let union = 0;
    for (let pixel = 0; pixel < first.length; pixel++) {
        if (first[pixel] || second[pixel]) union++;
        if (first[pixel] && second[pixel]) intersection++;
    }
    return intersection / union;
};

const scanlineRuns = function (mask, width, height) {
    let runs = 0;
    for (let y = 0; y < height; y++) {
        let insideRun = false;
        for (let x = 0; x < width; x++) {
            const foreground = mask[y * width + x] === 1;
            if (foreground && !insideRun) runs++;
            insideRun = foreground;
        }
    }
    return runs;
};

const colorScanlineRuns = function (image) {
    const scale = 2.9;
    const width = Math.round(image.width / scale);
    const height = Math.round(image.height / scale);
    let runs = 0;
    for (let y = 0; y < height; y++) {
        let previous = null;
        for (let x = 0; x < width; x++) {
            const sourceX = Math.min(image.width - 1, Math.round((x + 0.5) * scale - 0.5));
            const sourceY = Math.min(image.height - 1, Math.round((y + 0.5) * scale - 0.5));
            const source = (sourceY * image.width + sourceX) * 4;
            const alpha = image.data[source + 3] / 255;
            const key = colorKey(closestPaletteColor({
                r: Math.round(image.data[source] * alpha + 255 * (1 - alpha)),
                g: Math.round(image.data[source + 1] * alpha + 255 * (1 - alpha)),
                b: Math.round(image.data[source + 2] * alpha + 255 * (1 - alpha))
            }, palette));
            if (key !== previous) runs++;
            previous = key;
        }
    }
    return runs;
};

test("large silhouette is fast, accurate, and uses at least 75% fewer commands", () => {
    const { image, mask } = createStarImage(760, 560);
    const startedAt = performance.now();
    const plan = createDrawPlan({
        image,
        palette,
        canvas: { width: 800, height: 600 },
        offset: { x: 20, y: 20 }
    });
    const elapsed = performance.now() - startedAt;
    const raster = rasterizeSilhouette(plan);
    const fidelity = intersectionOverUnion(raster, plan.target.mask);

    assert.equal(plan.mode, "silhouette");
    assert.ok(plan.commands.length <= scanlineRuns(mask, image.width, image.height) * 0.25);
    assert.ok(fidelity >= 0.98, `expected IoU >= 0.98, got ${fidelity}`);
    assert.ok(elapsed < 1000);
});

test("silhouette holes remain empty without flood leaks", () => {
    const { image, mask } = createDonutImage(700, 520);
    const plan = createDrawPlan({
        image,
        palette,
        canvas: { width: 800, height: 600 },
        offset: { x: 50, y: 40 }
    });
    const raster = rasterizeSilhouette(plan);

    assert.equal(plan.mode, "silhouette");
    assert.equal(plan.metrics.contours, 2);
    assert.ok(plan.commands.length <= scanlineRuns(mask, image.width, image.height) * 0.25);
    assert.ok(intersectionOverUnion(raster, plan.target.mask) >= 0.98);
    assert.equal(raster[300 * 800 + 400], 0);
});

for (const file of ["icon128.png", "promo-image.png"]) {
    test(`${file} uses color fallback with fewer commands than scanlines`, () => {
        const image = PNG.sync.read(fs.readFileSync(
            new URL(`../${file}`, import.meta.url)
        ));
        const plan = createDrawPlan({
            image,
            palette,
            canvas: { width: 800, height: 600 },
            offset: { x: 0, y: 0 }
        });
        assert.equal(plan.mode, "color");
        assert.ok(plan.commands.length < colorScanlineRuns(image) * 0.7);
        assert.ok(plan.metrics.planningMs < 1000);
    });
}

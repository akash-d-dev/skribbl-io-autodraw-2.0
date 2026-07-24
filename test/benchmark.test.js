import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { PNG } from "pngjs";

import {
    binaryIntersectionOverUnion,
    rasterizeBinaryPlan
} from "../src/planning/binary-rasterizer.js";
import { closestPaletteColor, colorKey } from "../src/planning/color-utils.js";
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

const createComplexSilhouette = function (width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    const mask = new Uint8Array(width * height);
    const centerX = width / 2;
    const centerY = height / 2;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            const angle = Math.atan2(dy, dx);
            const boundary = 190
                + 28 * Math.sin(23 * angle)
                + 12 * Math.sin(67 * angle);
            const pixel = y * width + x;
            const foreground = Math.hypot(dx, dy) < boundary;
            mask[pixel] = foreground ? 1 : 0;
            data[pixel * 4 + 3] = foreground ? 255 : 0;
        }
    }
    return { image: { width, height, data }, mask };
};

const createComplexColorImage = function (width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            const dx = x - 280;
            const dy = y - height / 2;
            const angle = Math.atan2(dy, dx);
            const redBoundary = 180 + 25 * Math.sin(13 * angle);
            const blue = (x - 580) ** 2 + (y - height / 2) ** 2 < 105 ** 2;
            const color = Math.hypot(dx, dy) < redBoundary
                ? { r: 255, g: 0, b: 0 }
                : blue
                    ? { r: 0, g: 0, b: 255 }
                    : { r: 255, g: 255, b: 255 };
            data[index] = color.r;
            data[index + 1] = color.g;
            data[index + 2] = color.b;
            data[index + 3] = 255;
        }
    }
    return { width, height, data };
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
    const raster = rasterizeBinaryPlan(plan);
    const fidelity = binaryIntersectionOverUnion(raster, plan.target.mask);

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
    const raster = rasterizeBinaryPlan(plan);

    assert.equal(plan.mode, "silhouette");
    assert.equal(plan.metrics.contours, 2);
    assert.ok(plan.commands.length <= scanlineRuns(mask, image.width, image.height) * 0.25);
    assert.ok(binaryIntersectionOverUnion(raster, plan.target.mask) >= 0.98);
    assert.equal(raster[300 * 800 + 400], 0);
});

test("complex silhouette increases tolerance only while fidelity stays above 98%", () => {
    const { image } = createComplexSilhouette(760, 560);
    const plan = createDrawPlan({
        image,
        palette,
        canvas: { width: 800, height: 600 },
        offset: { x: 20, y: 20 }
    });
    const raster = rasterizeBinaryPlan(plan);

    assert.equal(plan.mode, "silhouette");
    assert.ok(plan.metrics.contourTolerance > 1.25);
    assert.ok(plan.commands.length < 250);
    assert.ok(binaryIntersectionOverUnion(raster, plan.target.mask) >= 0.98);
});

test("large color regions use fills only when they beat the stroke plan", () => {
    const image = createComplexColorImage(760, 560);
    const plan = createDrawPlan({
        image,
        palette,
        canvas: { width: 800, height: 600 },
        offset: { x: 20, y: 20 }
    });

    assert.equal(plan.mode, "color");
    assert.ok(plan.metrics.filledRegions >= 1);
    assert.ok(plan.commands.length < plan.metrics.baselineCommands * 0.8);
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

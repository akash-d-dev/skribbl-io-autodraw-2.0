import assert from "node:assert/strict";
import test from "node:test";

import { traceContours } from "../src/planning/contour-tracer.js";
import { analyzeImage } from "../src/planning/image-analyzer.js";
import { createDrawPlan } from "../src/planning/planner.js";

const palette = [
    { r: 255, g: 255, b: 255 },
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 0, b: 255 }
];

const createImage = function (width, height, pixelAt) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const color = pixelAt(x, y);
            const index = (y * width + x) * 4;
            data[index] = color.r;
            data[index + 1] = color.g;
            data[index + 2] = color.b;
            data[index + 3] = color.a ?? 255;
        }
    }
    return { width, height, data };
};

const rectangleImage = createImage(80, 60, (x, y) =>
    x >= 15 && x < 65 && y >= 10 && y < 50
        ? { r: 0, g: 0, b: 0, a: 255 }
        : { r: 255, g: 255, b: 255, a: 0 });

test("transparent single-color image is classified as silhouette", () => {
    const analysis = analyzeImage(rectangleImage, palette);
    assert.equal(analysis.mode, "silhouette");
    assert.deepEqual(analysis.foregroundColor, palette[1]);
    assert.deepEqual(analysis.backgroundColor, palette[0]);
    assert.ok(analysis.confidence >= 0.72);
});

test("opaque black-on-white image is classified as silhouette", () => {
    const image = createImage(80, 60, (x, y) =>
        x >= 15 && x < 65 && y >= 10 && y < 50
            ? palette[1]
            : palette[0]);
    const analysis = analyzeImage(image, palette);
    assert.equal(analysis.mode, "silhouette");
    assert.deepEqual(analysis.foregroundColor, palette[1]);
});

test("multi-color image uses color fallback", () => {
    const image = createImage(90, 60, x => {
        if (x < 30) return palette[1];
        if (x < 60) return palette[2];
        return palette[3];
    });
    const analysis = analyzeImage(image, palette);
    assert.equal(analysis.mode, "color");
});

test("contour tracing preserves an outer component and hole", () => {
    const width = 40;
    const height = 40;
    const mask = new Uint8Array(width * height);
    for (let y = 4; y < 36; y++) {
        for (let x = 4; x < 36; x++) mask[y * width + x] = 1;
    }
    for (let y = 14; y < 26; y++) {
        for (let x = 14; x < 26; x++) mask[y * width + x] = 0;
    }

    const contours = traceContours(mask, width, height);
    assert.equal(contours.length, 2);
    assert.deepEqual(contours.map(contour => contour.depth), [0, 1]);
    assert.ok(contours.every(contour => contour.points.length === 4));
});

test("silhouette planner creates closed outline and fill commands", () => {
    const plan = createDrawPlan({
        image: rectangleImage,
        palette,
        canvas: { width: 100, height: 80 },
        offset: { x: 10, y: 10 }
    });

    assert.equal(plan.mode, "silhouette");
    assert.equal(plan.commands.filter(command => command.kind === "stroke").length, 4);
    assert.equal(plan.commands.filter(command => command.kind === "fill").length, 1);
    assert.equal(plan.target.mask.length, 8000);
    assert.ok(plan.metrics.planningMs >= 0);
});

test("silhouette planner reduces commands against scanline baseline", () => {
    const plan = createDrawPlan({
        image: rectangleImage,
        palette,
        canvas: { width: 100, height: 80 },
        offset: { x: 10, y: 10 }
    });
    const scanlineCommands = 40;
    assert.ok(plan.commands.length <= scanlineCommands * 0.25);
});

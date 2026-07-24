import { rgbDistance } from "./color-utils.js";

const boundaryRadius = 2;

const actualMatchesTarget = function (data, pixel, target, foreground, background) {
    const index = pixel * 4;
    const actual = {
        r: data[index],
        g: data[index + 1],
        b: data[index + 2]
    };
    const actualForeground = rgbDistance(actual, foreground) < rgbDistance(actual, background);
    return actualForeground === Boolean(target);
};

const isBoundaryPixel = function (mask, width, height, x, y) {
    const target = mask[y * width + x];
    for (let dy = -boundaryRadius; dy <= boundaryRadius; dy++) {
        for (let dx = -boundaryRadius; dx <= boundaryRadius; dx++) {
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            if (mask[nextY * width + nextX] !== target) return true;
        }
    }
    return false;
};

export const createSilhouetteRepairs = function (plan, actualImage) {
    const target = plan.target;
    if (!target || target.kind !== "binary") return [];
    if (actualImage.width !== target.width || actualImage.height !== target.height) return [];

    const mismatched = new Uint8Array(target.mask.length);
    for (let y = 0; y < target.height; y++) {
        for (let x = 0; x < target.width; x++) {
            const pixel = y * target.width + x;
            if (isBoundaryPixel(target.mask, target.width, target.height, x, y)) continue;
            if (!actualMatchesTarget(
                actualImage.data,
                pixel,
                target.mask[pixel],
                target.foregroundColor,
                target.backgroundColor
            )) mismatched[pixel] = 1;
        }
    }

    const commands = [];
    for (let y = 0; y < target.height; y++) {
        let x = 0;
        while (x < target.width) {
            while (x < target.width && !mismatched[y * target.width + x]) x++;
            if (x >= target.width) break;
            const start = x;
            const value = target.mask[y * target.width + x];
            while (x + 1 < target.width
                && mismatched[y * target.width + x + 1]
                && target.mask[y * target.width + x + 1] === value) x++;
            commands.push({
                kind: "stroke",
                color: value ? target.foregroundColor : target.backgroundColor,
                diameter: 4,
                from: { x: start, y },
                to: { x, y }
            });
            x++;
        }
    }
    return commands;
};

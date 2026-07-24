import {
    closestPaletteColor,
    colorKey,
    rgbDistance
} from "./color-utils.js";

const alphaBackgroundThreshold = 16;
const alphaForegroundThreshold = 128;
const minimumComponentArea = 3;

const pixelColor = (data, index) => ({
    r: data[index],
    g: data[index + 1],
    b: data[index + 2]
});

const meanColor = function (data, include) {
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let pixel = 0; pixel < data.length / 4; pixel++) {
        const index = pixel * 4;
        if (!include(pixel, index)) continue;
        red += data[index];
        green += data[index + 1];
        blue += data[index + 2];
        count++;
    }
    if (!count) return { r: 255, g: 255, b: 255 };
    return {
        r: Math.round(red / count),
        g: Math.round(green / count),
        b: Math.round(blue / count)
    };
};

const borderPixelIndexes = function (width, height) {
    const indexes = [];
    for (let x = 0; x < width; x++) {
        indexes.push(x, (height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y++) {
        indexes.push(y * width, y * width + width - 1);
    }
    return indexes;
};

const estimateOpaqueBackground = function (image) {
    const counts = new Map();
    const indexes = borderPixelIndexes(image.width, image.height);
    for (const pixel of indexes) {
        const index = pixel * 4;
        const key = `${image.data[index] >> 5},${image.data[index + 1] >> 5},${image.data[index + 2] >> 5}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const dominantBin = [...counts.entries()]
        .sort((first, second) => second[1] - first[1])[0]?.[0];

    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (const pixel of indexes) {
        const index = pixel * 4;
        const key = `${image.data[index] >> 5},${image.data[index + 1] >> 5},${image.data[index + 2] >> 5}`;
        if (key !== dominantBin) continue;
        red += image.data[index];
        green += image.data[index + 1];
        blue += image.data[index + 2];
        count++;
    }
    return {
        color: {
            r: Math.round(red / Math.max(1, count)),
            g: Math.round(green / Math.max(1, count)),
            b: Math.round(blue / Math.max(1, count))
        },
        support: count / Math.max(1, indexes.length)
    };
};

const otsuThreshold = function (values) {
    const histogram = new Uint32Array(256);
    for (const value of values) histogram[Math.max(0, Math.min(255, Math.round(value)))]++;

    let totalSum = 0;
    for (let value = 0; value < histogram.length; value++) totalSum += value * histogram[value];

    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let bestThreshold = 0;
    for (let value = 0; value < histogram.length; value++) {
        backgroundWeight += histogram[value];
        if (!backgroundWeight) continue;
        const foregroundWeight = values.length - backgroundWeight;
        if (!foregroundWeight) break;

        backgroundSum += value * histogram[value];
        const backgroundMean = backgroundSum / backgroundWeight;
        const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
        const variance = backgroundWeight * foregroundWeight
            * (backgroundMean - foregroundMean) ** 2;
        if (variance > bestVariance) {
            bestVariance = variance;
            bestThreshold = value;
        }
    }
    return bestThreshold;
};

const removeSmallComponents = function (mask, width, height) {
    const visited = new Uint8Array(mask.length);
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || visited[start]) continue;
        const queue = [start];
        const component = [];
        visited[start] = 1;
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const pixel = queue[cursor];
            component.push(pixel);
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            for (const [dx, dy] of neighbors) {
                const nextX = x + dx;
                const nextY = y + dy;
                if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
                const next = nextY * width + nextX;
                if (!mask[next] || visited[next]) continue;
                visited[next] = 1;
                queue.push(next);
            }
        }
        if (component.length < minimumComponentArea) {
            for (const pixel of component) mask[pixel] = 0;
        }
    }
};

const paletteDistribution = function (image, mask, palette) {
    const counts = new Map();
    let total = 0;
    for (let pixel = 0; pixel < mask.length; pixel++) {
        if (!mask[pixel]) continue;
        const index = pixel * 4;
        const mapped = closestPaletteColor(pixelColor(image.data, index), palette);
        const key = colorKey(mapped);
        const entry = counts.get(key) || { color: mapped, count: 0 };
        entry.count++;
        counts.set(key, entry);
        total++;
    }
    const dominant = [...counts.values()].sort((first, second) => second.count - first.count)[0];
    return {
        color: dominant?.color || palette[0],
        share: dominant ? dominant.count / total : 0
    };
};

const calculateConfidence = function ({
    foregroundCoverage,
    foregroundShare,
    backgroundSupport,
    contrast
}) {
    const coverageScore = foregroundCoverage >= 0.005 && foregroundCoverage <= 0.97 ? 1 : 0;
    const contrastScore = Math.min(1, contrast / 80);
    return foregroundShare * 0.4
        + Math.min(1, backgroundSupport / 0.7) * 0.25
        + contrastScore * 0.25
        + coverageScore * 0.1;
};

export const analyzeImage = function (image, palette) {
    const pixelCount = image.width * image.height;
    let transparentPixels = 0;
    for (let pixel = 0; pixel < pixelCount; pixel++) {
        if (image.data[pixel * 4 + 3] <= alphaBackgroundThreshold) transparentPixels++;
    }
    const usesAlpha = transparentPixels / pixelCount >= 0.01;
    const mask = new Uint8Array(pixelCount);
    let background;
    let backgroundSupport;

    if (usesAlpha) {
        background = { r: 255, g: 255, b: 255 };
        const border = borderPixelIndexes(image.width, image.height);
        backgroundSupport = border.filter(pixel =>
            image.data[pixel * 4 + 3] <= alphaBackgroundThreshold).length / border.length;
        for (let pixel = 0; pixel < pixelCount; pixel++) {
            mask[pixel] = image.data[pixel * 4 + 3] >= alphaForegroundThreshold ? 1 : 0;
        }
    } else {
        const estimate = estimateOpaqueBackground(image);
        background = estimate.color;
        backgroundSupport = estimate.support;
        const distances = new Uint8Array(pixelCount);
        for (let pixel = 0; pixel < pixelCount; pixel++) {
            distances[pixel] = Math.round(rgbDistance(
                pixelColor(image.data, pixel * 4),
                background
            ));
        }
        const threshold = Math.max(12, otsuThreshold(distances));
        for (let pixel = 0; pixel < pixelCount; pixel++) {
            mask[pixel] = distances[pixel] > threshold ? 1 : 0;
        }
    }

    removeSmallComponents(mask, image.width, image.height);
    const foregroundPixels = mask.reduce((total, value) => total + value, 0);
    const foregroundCoverage = foregroundPixels / pixelCount;
    const foregroundMean = meanColor(image.data, pixel => mask[pixel] === 1);
    const distribution = paletteDistribution(image, mask, palette);
    const confidence = calculateConfidence({
        foregroundCoverage,
        foregroundShare: distribution.share,
        backgroundSupport,
        contrast: rgbDistance(foregroundMean, background)
    });

    return {
        mode: confidence >= 0.72
            && distribution.share >= 0.7
            && foregroundCoverage >= 0.005
            && foregroundCoverage <= 0.97
            ? "silhouette"
            : "color",
        confidence,
        mask,
        foregroundColor: distribution.color,
        backgroundColor: closestPaletteColor(background, palette),
        stats: {
            usesAlpha,
            foregroundCoverage,
            foregroundShare: distribution.share,
            backgroundSupport
        }
    };
};

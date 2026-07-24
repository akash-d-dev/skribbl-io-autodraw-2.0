const diagonalCost = Math.SQRT2;

export const distanceInsideValue = function (mask, width, height, value) {
    const distance = new Float64Array(mask.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixel = y * width + x;
            distance[pixel] = mask[pixel] === value
                ? Math.min(x + 1, width - x, y + 1, height - y)
                : 0;
        }
    }

    const relax = function (pixel, neighbor, cost) {
        distance[pixel] = Math.min(distance[pixel], distance[neighbor] + cost);
    };

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixel = y * width + x;
            if (!distance[pixel]) continue;
            if (x > 0) relax(pixel, pixel - 1, 1);
            if (y > 0) relax(pixel, pixel - width, 1);
            if (x > 0 && y > 0) relax(pixel, pixel - width - 1, diagonalCost);
            if (x + 1 < width && y > 0) relax(pixel, pixel - width + 1, diagonalCost);
        }
    }

    for (let y = height - 1; y >= 0; y--) {
        for (let x = width - 1; x >= 0; x--) {
            const pixel = y * width + x;
            if (!distance[pixel]) continue;
            if (x + 1 < width) relax(pixel, pixel + 1, 1);
            if (y + 1 < height) relax(pixel, pixel + width, 1);
            if (x + 1 < width && y + 1 < height) {
                relax(pixel, pixel + width + 1, diagonalCost);
            }
            if (x > 0 && y + 1 < height) relax(pixel, pixel + width - 1, diagonalCost);
        }
    }
    return distance;
};

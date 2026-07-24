const colorDistanceSquared = function (first, second) {
    const red = first.r - second.r;
    const green = first.g - second.g;
    const blue = first.b - second.b;
    return red * red * 0.299 + green * green * 0.587 + blue * blue * 0.114;
};

export const closestPaletteColor = function (color, palette) {
    let closest = palette[0];
    let closestDistance = Infinity;
    for (const candidate of palette) {
        const distance = colorDistanceSquared(color, candidate);
        if (distance < closestDistance) {
            closest = candidate;
            closestDistance = distance;
        }
    }
    return closest;
};

export const colorsEqual = function (first, second) {
    return first.r === second.r && first.g === second.g && first.b === second.b;
};

export const rgbDistance = function (first, second) {
    const red = first.r - second.r;
    const green = first.g - second.g;
    const blue = first.b - second.b;
    return Math.sqrt((red * red + green * green + blue * blue) / 3);
};

export const colorKey = color => `${color.r},${color.g},${color.b}`;

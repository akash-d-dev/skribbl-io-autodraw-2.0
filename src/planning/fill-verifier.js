// Simulates "draw this outline, then bucket-fill inside it" on a grid raster and
// reports how well the result matches the region we meant to paint.
//
// This is what makes aggressive fill use safe. Measured on the live canvas, a bucket
// is a contiguous 4-connected flood fill, so a single gap in the outline lets it
// escape and recolor everything connected -- which is exactly how the old output got
// smeared. Simplifying a contour makes it cheaper to draw but eventually opens gaps
// or distorts the shape, and intersection-over-union catches both failures at once:
// an escaped fill is far larger than the region, a distorted one overlaps it poorly.

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

const OUTLINE = 1;
const FILLED = 2;

const strokeCapsule = function (raster, width, height, from, to, radius) {
    const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + radius));
    const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + radius));
    const radiusSquared = radius * radius;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (distanceToSegmentSquared(x + 0.5, y + 0.5, from, to) <= radiusSquared) {
                raster[y * width + x] = OUTLINE;
            }
        }
    }
};

// 4-connected, matching the measured behaviour of skribbl's bucket.
const floodFrom = function (raster, width, height, seedPixel) {
    if (raster[seedPixel] !== 0) return 0;
    const stack = [seedPixel];
    raster[seedPixel] = FILLED;
    let count = 0;

    while (stack.length) {
        const pixel = stack.pop();
        count++;
        const x = pixel % width;
        const y = (pixel - x) / width;
        if (x > 0 && raster[pixel - 1] === 0) {
            raster[pixel - 1] = FILLED;
            stack.push(pixel - 1);
        }
        if (x + 1 < width && raster[pixel + 1] === 0) {
            raster[pixel + 1] = FILLED;
            stack.push(pixel + 1);
        }
        if (y > 0 && raster[pixel - width] === 0) {
            raster[pixel - width] = FILLED;
            stack.push(pixel - width);
        }
        if (y + 1 < height && raster[pixel + width] === 0) {
            raster[pixel + width] = FILLED;
            stack.push(pixel + width);
        }
    }
    return count;
};

// Worst case on purpose: the outline is drawn on an otherwise empty field, so any
// gap lets the fill run to the edges. On the real canvas a gap only leaks into
// same-coloured neighbours, so this never under-reports a leak.
export const evaluateFilledRegion = function ({
    points,
    seedPixel,
    radius,
    width,
    height,
    regionPixels
}) {
    if (points.length < 2) return { intersectionOverUnion: 0, painted: 0, escaped: true };

    const raster = new Uint8Array(width * height);
    for (let index = 0; index < points.length - 1; index++) {
        strokeCapsule(raster, width, height, points[index], points[index + 1], radius);
    }
    // Close the loop explicitly; a simplified contour may not repeat its first point.
    strokeCapsule(raster, width, height, points[points.length - 1], points[0], radius);

    if (raster[seedPixel] === OUTLINE) {
        return { intersectionOverUnion: 0, painted: 0, escaped: false, seedCovered: true };
    }

    const painted = floodFrom(raster, width, height, seedPixel);

    const target = new Uint8Array(width * height);
    for (const pixel of regionPixels) target[pixel] = 1;

    let intersection = 0;
    let union = 0;
    for (let pixel = 0; pixel < raster.length; pixel++) {
        // The outline itself is drawn in the region's colour, so it counts as covered.
        const covered = raster[pixel] === FILLED || raster[pixel] === OUTLINE;
        const wanted = target[pixel] === 1;
        if (covered && wanted) intersection++;
        if (covered || wanted) union++;
    }

    return {
        intersectionOverUnion: union ? intersection / union : 0,
        painted,
        // A fill that swallows far more than its region has escaped.
        escaped: painted > regionPixels.length * 3
    };
};

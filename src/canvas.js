const logicalSize = { width: 800, height: 600 };
const boundsMaximumAgeMs = 500;

export default function createCanvas(canvasElement) {
    const context = canvasElement.getContext("2d", { willReadFrequently: true });

    let bounds = null;
    let boundsReadAt = 0;

    const invalidateBounds = function () {
        bounds = null;
    };

    // Reading the bounding rect forces layout, and a plan issues three pointer
    // events per stroke. Cache it, but never trust the cache for long: a stale
    // rect silently misplaces every stroke.
    const currentBounds = function (now) {
        if (bounds && now - boundsReadAt < boundsMaximumAgeMs) return bounds;
        bounds = canvasElement.getBoundingClientRect();
        boundsReadAt = now;
        return bounds;
    };

    if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(invalidateBounds).observe(canvasElement);
    }
    addEventListener("scroll", invalidateBounds, { passive: true, capture: true });
    addEventListener("resize", invalidateBounds, { passive: true });

    const toClientCoordinates = function (coordinates, now) {
        const rect = currentBounds(now);
        return {
            x: coordinates.x * rect.width / logicalSize.width + rect.x,
            y: coordinates.y * rect.height / logicalSize.height + rect.y
        };
    };

    const createPointerEvent = function (name, coordinates, pressed, now) {
        const client = toClientCoordinates(coordinates, now);
        return new PointerEvent(name, {
            pointerId: 1,
            pointerType: "mouse",
            bubbles: true,
            clientX: client.x,
            clientY: client.y,
            button: 0,
            buttons: pressed ? 1 : 0
        });
    };

    const dispatchClick = function (coordinates) {
        const now = performance.now();
        canvasElement.dispatchEvent(createPointerEvent("pointerdown", coordinates, true, now));
        canvasElement.dispatchEvent(createPointerEvent("pointerup", coordinates, false, now));
    };

    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

    // skribbl renders on requestAnimationFrame, and a segment is only drawn when a
    // frame boundary falls on BOTH sides of the pointermove. Measured over 12 long
    // strokes: down/move/up in one task drew 1 of 12 (the rest left only the
    // pointerdown dab), down/move/frame/up drew 6, and this shape drew 10-12.
    //
    // Two consequences worth remembering:
    //   - a bare pointerdown still paints a dab, so dropped strokes look like faint
    //     speckle rather than missing geometry, which is why this went unnoticed;
    //   - rAF is suspended while the tab is hidden, so nothing draws at all then.
    const drawSegment = async function (from, to) {
        const now = performance.now();
        canvasElement.dispatchEvent(createPointerEvent("pointerdown", from, true, now));
        await nextFrame();
        canvasElement.dispatchEvent(createPointerEvent("pointermove", to, true, now));
        await nextFrame();
        canvasElement.dispatchEvent(createPointerEvent("pointerup", to, false, now));
    };

    // Holding one gesture open and moving once per frame does not work: over 24
    // segments only 1 midpoint painted. So a polyline is drawn as independent
    // frame-bracketed segments.
    const drawPolyline = async function (points) {
        for (let index = 0; index < points.length - 1; index++) {
            await drawSegment(points[index], points[index + 1]);
        }
    };

    const signature = function () {
        const image = context.getImageData(
            0,
            0,
            canvasElement.width,
            canvasElement.height
        ).data;
        let hash = 2166136261;
        const stride = Math.max(4, Math.floor(image.length / 4096 / 4) * 4);
        for (let index = 0; index < image.length; index += stride) {
            hash ^= image[index];
            hash = Math.imul(hash, 16777619);
            hash ^= image[index + 1];
            hash = Math.imul(hash, 16777619);
            hash ^= image[index + 2];
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    };

    return {
        element: canvasElement,
        size: logicalSize,
        drawStroke: drawSegment,
        drawPolyline,
        fill: dispatchClick,
        signature,
        refreshBounds: invalidateBounds,
        snapshot: () => context.getImageData(
            0,
            0,
            canvasElement.width,
            canvasElement.height
        ),
        // Kept generous on purpose. skribbl echoes the clear command back from the
        // server and clears a second time ~100ms+ later; anything drawn inside that
        // window is destroyed. Shortening this needs the echo latency measured first.
        waitUntilStable: function ({
            quietMs = 120,
            maximumMs = 1500
        } = {}) {
            return new Promise(resolve => {
                const startedAt = performance.now();
                let stableSince = startedAt;
                let previous = signature();

                const poll = function () {
                    const now = performance.now();
                    const current = signature();
                    if (current !== previous) {
                        previous = current;
                        stableSince = now;
                    }
                    if (now - stableSince >= quietMs || now - startedAt >= maximumMs) {
                        resolve();
                        return;
                    }
                    setTimeout(poll, 16);
                };
                setTimeout(poll, 16);
            });
        }
    };
}

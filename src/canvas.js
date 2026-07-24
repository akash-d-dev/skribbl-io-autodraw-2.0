const logicalSize = { width: 800, height: 600 };

export default function createCanvas(canvasElement) {
    const context = canvasElement.getContext("2d", { willReadFrequently: true });

    const toClientCoordinates = function (coordinates) {
        const bounds = canvasElement.getBoundingClientRect();
        return {
            x: coordinates.x * bounds.width / logicalSize.width + bounds.x,
            y: coordinates.y * bounds.height / logicalSize.height + bounds.y
        };
    };

    const createPointerEvent = function (name, coordinates, pressed) {
        const client = toClientCoordinates(coordinates);
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
        canvasElement.dispatchEvent(createPointerEvent("pointerdown", coordinates, true));
        canvasElement.dispatchEvent(createPointerEvent("pointerup", coordinates, false));
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
        drawStroke: function (from, to) {
            canvasElement.dispatchEvent(createPointerEvent("pointerdown", from, true));
            canvasElement.dispatchEvent(createPointerEvent("pointermove", to, true));
            canvasElement.dispatchEvent(createPointerEvent("pointerup", to, false));
        },
        fill: dispatchClick,
        snapshot: () => context.getImageData(
            0,
            0,
            canvasElement.width,
            canvasElement.height
        ),
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

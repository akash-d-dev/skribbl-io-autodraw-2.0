import log from "./log.js";

export function prepareImage(size, image, margin = 12) {
    const availableWidth = Math.max(1, size.width - margin * 2);
    const availableHeight = Math.max(1, size.height - margin * 2);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const factor = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * factor));
    const height = Math.max(1, Math.round(sourceHeight * factor));
    const offset = {
        x: Math.round((size.width - width) / 2),
        y: Math.round((size.height - height) / 2)
    };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    return {
        image: context.getImageData(0, 0, width, height),
        offset
    };
}

export function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image;
        image.crossOrigin = "Anonymous";
        image.onload = function () {
            const blockedByCors = image.height === 0 || image.width === 0;
            const executor = blockedByCors ? reject : resolve;
            executor(image);
        };
        image.onerror = reject;

        log(`Attempting to load image: ${url}...`);
        image.src = url;
    });
}

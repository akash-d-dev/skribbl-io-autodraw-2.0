import createCanvas from "./canvas.js";
import createCommandRenderer from "./command-renderer.js";
import { getImgElementSrc, getImgFileUrl } from "./data-transfer-helper.js";
import createDomHelper from "./dom-helper.js";
import createDragDropListener from "./drag-drop-event-listener.js";
import createDrawSession from "./draw-session.js";
import { loadImage, prepareImage } from "./image-helper.js";
import log from "./log.js";
import createPlannerClient from "./planner-client.js";
import { createSilhouetteRepairs } from "./planning/silhouette-repair.js";
import createProgressControl from "./progress-control.js";
import createToolbar from "./toolbar.js";

const commandIntervals = {
    silhouette: 16,
    color: 18
};
const domHelper = createDomHelper(document);
const canvas = createCanvas(domHelper.getCanvasElement());
const toolbar = createToolbar(domHelper);
const renderer = createCommandRenderer(canvas, toolbar);
const planner = createPlannerClient();
const progress = createProgressControl(domHelper.getToolbarElement());
const clearToolElement = domHelper.getClearToolElement();

let activeSession = null;
let canvasGeneration = 0;
let internalClear = false;
let dropRequestId = 0;

const cancelActiveSession = function () {
    activeSession?.cancel();
    activeSession = null;
};

const cancelCurrentWork = function () {
    dropRequestId++;
    cancelActiveSession();
    progress.hide();
    domHelper.hideCanvasOverlay();
};

progress.setHandlers({
    pause: () => activeSession?.pause(),
    resume: () => activeSession?.resume(),
    cancel: cancelCurrentWork,
    speedChange: () => activeSession?.refresh()
});

const executePlan = async function (plan, requestId) {
    if (requestId !== dropRequestId) return;

    internalClear = true;
    try {
        await renderer.clear();
    } finally {
        internalClear = false;
    }

    const generation = canvasGeneration;
    const session = createDrawSession({
        execute: renderer.execute,
        intervalMs: () => progress.getCommandInterval(commandIntervals[plan.mode]),
        isValid: () => generation === canvasGeneration && toolbar.isEnabled(),
        onChange: progress.update
    });
    activeSession = session;

    log(`${plan.mode} plan: ${plan.commands.length} commands, ${plan.metrics.planningMs}ms planning.`);
    const result = await session.start(plan.commands, {
        createRepairs: plan.mode === "silhouette"
            ? async () => {
                await canvas.waitUntilStable();
                return createSilhouetteRepairs(plan, canvas.snapshot());
            }
            : null
    });
    if (activeSession === session) activeSession = null;
    log(`Drawing ${result.state}: ${result.cursor}/${result.total} commands.`);
};

const drawImage = async function (image, requestId) {
    const prepared = prepareImage(canvas.size, image);
    const plan = await planner.plan({
        image: prepared.image,
        offset: prepared.offset,
        canvas: canvas.size,
        palette: toolbar.getColors(),
        contourTolerance: 1.25
    });
    if (requestId !== dropRequestId) return;
    domHelper.hideCanvasOverlay();
    await executePlan(plan, requestId);
};

const handleDragEnter = function () {
    if (!toolbar.isEnabled()) return;
    domHelper.showCanvasOverlay("Drop image here to auto draw");
};

const handleDrop = function (event) {
    event.preventDefault();

    if (!domHelper.getCanvasContainerElement().contains(event.target)) {
        domHelper.hideCanvasOverlay();
        return;
    }
    if (!toolbar.isEnabled()) {
        log("Drawing is unavailable right now.");
        domHelper.hideCanvasOverlay();
        return;
    }

    const imageUrl = getImgFileUrl(event.dataTransfer)
        || getImgElementSrc(event.dataTransfer);
    if (!imageUrl) {
        domHelper.showCanvasOverlay("Dropped content is not an image");
        domHelper.hideCanvasOverlay(2000);
        return;
    }

    const requestId = ++dropRequestId;
    cancelActiveSession();
    progress.resetSpeed();
    progress.showAnalyzing();
    domHelper.showCanvasOverlay("Analyzing image");

    const fallbackUrl = "https://skribbl-io-autodraw-cors-proxy.galehouse5.workers.dev?";
    loadImage(imageUrl)
        .catch(error => {
            if (imageUrl.startsWith("blob:")) throw error;
            return loadImage(fallbackUrl + imageUrl);
        })
        .then(image => drawImage(image, requestId))
        .catch(error => {
            if (requestId !== dropRequestId) return;
            progress.hide();
            domHelper.showCanvasOverlay("Auto draw could not process this image");
            domHelper.hideCanvasOverlay(2500);
            log(`Image processing failed: ${error.message}`);
        })
        .finally(() => {
            if (imageUrl.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
        });
};

createDragDropListener(
    document,
    handleDragEnter,
    domHelper.hideCanvasOverlay,
    handleDrop
);

// skribbl renders on requestAnimationFrame, which the browser suspends while the tab
// is hidden or occluded. Nothing is drawn at all in that state, so draining commands
// would silently discard them. Pause instead, and resume when the tab comes back.
let pausedByVisibility = false;
document.addEventListener("visibilitychange", () => {
    if (!activeSession) return;
    if (document.hidden) {
        if (activeSession.getSnapshot().state !== "drawing") return;
        pausedByVisibility = true;
        activeSession.pause();
        log("Tab hidden: drawing paused (skribbl only renders while visible).");
        return;
    }
    if (!pausedByVisibility) return;
    pausedByVisibility = false;
    activeSession.resume();
    log("Tab visible: drawing resumed.");
});

clearToolElement.addEventListener("click", () => {
    if (internalClear) return;
    canvasGeneration++;
    cancelCurrentWork();
});

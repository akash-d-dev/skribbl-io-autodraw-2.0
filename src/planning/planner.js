import { analyzeImage } from "./image-analyzer.js";
import { planColorImage } from "./color-planner.js";
import { planSilhouette } from "./silhouette-planner.js";

export const createDrawPlan = function ({
    image,
    palette,
    canvas,
    offset,
    contourTolerance = 1.25
}) {
    const startedAt = performance.now();
    const analysis = analyzeImage(image, palette);
    const plan = analysis.mode === "silhouette"
        ? planSilhouette({
            analysis,
            width: image.width,
            height: image.height,
            canvas,
            offset,
            contourTolerance
        })
        : planColorImage({ image, palette, offset });

    plan.metrics.planningMs = Math.round(performance.now() - startedAt);
    plan.metrics.modeConfidence = analysis.confidence;
    return plan;
};

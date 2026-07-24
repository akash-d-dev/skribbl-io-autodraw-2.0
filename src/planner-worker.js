import { createDrawPlan } from "./planning/planner.js";

self.addEventListener("message", event => {
    const { id, request } = event.data;
    try {
        const plan = createDrawPlan({
            ...request,
            image: {
                width: request.image.width,
                height: request.image.height,
                data: new Uint8ClampedArray(request.image.dataBuffer)
            }
        });
        const transfer = [];
        if (plan.target?.mask) transfer.push(plan.target.mask.buffer);
        self.postMessage({ id, plan }, transfer);
    } catch (error) {
        self.postMessage({
            id,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            }
        });
    }
});

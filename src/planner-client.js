import { createDrawPlan } from "./planning/planner.js";

const workerTimeoutMs = 20000;

export default function createPlannerClient() {
    let worker = null;
    let nextRequestId = 1;
    const pending = new Map();

    const rejectPending = function (error) {
        for (const request of pending.values()) request.reject(error);
        pending.clear();
    };

    const ensureWorker = function () {
        if (worker) return worker;
        if (typeof Worker === "undefined" || typeof chrome === "undefined") return null;

        worker = new Worker(chrome.runtime.getURL("dist/planner-worker.js"));
        worker.addEventListener("message", event => {
            const request = pending.get(event.data.id);
            if (!request) return;
            pending.delete(event.data.id);
            clearTimeout(request.timeout);
            if (event.data.error) {
                const error = new Error(event.data.error.message);
                error.name = event.data.error.name;
                request.reject(error);
                return;
            }
            request.resolve(event.data.plan);
        });
        worker.addEventListener("error", event => {
            rejectPending(event.error || new Error(event.message));
            worker.terminate();
            worker = null;
        });
        return worker;
    };

    const planInWorker = function (request) {
        const activeWorker = ensureWorker();
        if (!activeWorker) return Promise.reject(new Error("Planner worker unavailable."));

        const id = nextRequestId++;
        const dataBuffer = request.image.data.slice().buffer;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pending.delete(id);
                reject(new Error("Planner worker timed out."));
                activeWorker.terminate();
                worker = null;
            }, workerTimeoutMs);
            pending.set(id, { resolve, reject, timeout });
            activeWorker.postMessage({
                id,
                request: {
                    ...request,
                    image: {
                        width: request.image.width,
                        height: request.image.height,
                        dataBuffer
                    }
                }
            }, [dataBuffer]);
        });
    };

    return {
        plan: async function (request) {
            try {
                return await planInWorker(request);
            } catch {
                await new Promise(resolve => setTimeout(resolve, 0));
                return createDrawPlan(request);
            }
        },
        destroy: function () {
            if (worker) worker.terminate();
            worker = null;
            rejectPending(new Error("Planner client destroyed."));
        }
    };
}

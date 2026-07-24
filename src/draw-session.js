const defaultWait = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds));

export default function createDrawSession({
    execute,
    isValid = () => true,
    intervalMs = 18,
    wait = defaultWait,
    now = () => performance.now(),
    onChange = () => {}
}) {
    let state = "idle";
    let commands = [];
    let cursor = 0;
    let paused = false;
    let canceled = false;
    let runId = 0;
    let activePromise = null;
    let wakePausedSession = null;
    let startedAt = 0;
    let pausedAt = null;
    let pausedDurationMs = 0;
    let stoppedAt = null;

    const currentIntervalMs = () => {
        const value = typeof intervalMs === "function" ? intervalMs() : intervalMs;
        return Math.max(0, Number(value) || 0);
    };

    const elapsedMs = () => {
        const endedAt = stoppedAt ?? pausedAt ?? now();
        return Math.max(0, endedAt - startedAt - pausedDurationMs);
    };

    const snapshot = function (message = null) {
        return {
            state,
            cursor,
            total: commands.length,
            progress: commands.length ? cursor / commands.length : 0,
            remainingMs: Math.max(0, commands.length - cursor) * currentIntervalMs(),
            elapsedMs: elapsedMs(),
            message
        };
    };

    const update = function (nextState = state, message = null) {
        state = nextState;
        if (["completed", "canceled", "failed"].includes(state) && stoppedAt === null) {
            stoppedAt = now();
        }
        onChange(snapshot(message));
    };

    const waitWhilePaused = async function (currentRunId) {
        while (paused && !canceled && currentRunId === runId) {
            if (!isValid()) {
                canceled = true;
                break;
            }
            await Promise.race([
                wait(100),
                new Promise(resolve => {
                    wakePausedSession = resolve;
                })
            ]);
            wakePausedSession = null;
        }
    };

    const drain = async function (currentRunId) {
        while (cursor < commands.length && currentRunId === runId && !canceled) {
            await waitWhilePaused(currentRunId);
            if (canceled || currentRunId !== runId) break;
            if (!isValid()) {
                canceled = true;
                break;
            }

            const startedAt = now();
            await execute(commands[cursor]);
            cursor++;
            update("drawing");
            const elapsed = now() - startedAt;
            await wait(Math.max(0, currentIntervalMs() - elapsed));
        }
    };

    return {
        start: function (initialCommands, {
            createRepairs = null,
            maximumRepairPasses = 2
        } = {}) {
            runId++;
            const currentRunId = runId;
            commands = initialCommands.slice();
            cursor = 0;
            paused = false;
            canceled = false;
            startedAt = now();
            pausedAt = null;
            pausedDurationMs = 0;
            stoppedAt = null;
            update("drawing");

            activePromise = (async function () {
                try {
                    let repairPass = 0;
                    while (!canceled && currentRunId === runId) {
                        await drain(currentRunId);
                        if (canceled || currentRunId !== runId) break;
                        if (!createRepairs || repairPass >= maximumRepairPasses) break;

                        update("verifying");
                        const repairs = await createRepairs(repairPass++);
                        if (!repairs.length) break;
                        commands.push(...repairs);
                        update("drawing");
                    }

                    if (canceled || currentRunId !== runId) {
                        update("canceled");
                        return { state: "canceled", cursor, total: commands.length };
                    }
                    update("completed");
                    return { state: "completed", cursor, total: commands.length };
                } catch (error) {
                    update("failed", error.message);
                    return { state: "failed", error, cursor, total: commands.length };
                }
            })();
            return activePromise;
        },
        pause: function () {
            if (state !== "drawing") return;
            paused = true;
            pausedAt = now();
            update("paused");
        },
        resume: function () {
            if (state !== "paused") return;
            pausedDurationMs += Math.max(0, now() - pausedAt);
            pausedAt = null;
            paused = false;
            wakePausedSession?.();
            update("drawing");
        },
        cancel: function () {
            if (["idle", "completed", "canceled", "failed"].includes(state)) return;
            canceled = true;
            if (pausedAt !== null) {
                pausedDurationMs += Math.max(0, now() - pausedAt);
                pausedAt = null;
            }
            paused = false;
            wakePausedSession?.();
            update("canceled");
        },
        refresh: function () {
            if (["drawing", "paused", "verifying"].includes(state)) update();
        },
        getSnapshot: snapshot,
        getActivePromise: () => activePromise
    };
}

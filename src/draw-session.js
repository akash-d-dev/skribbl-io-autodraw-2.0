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

    const snapshot = function (message = null) {
        return {
            state,
            cursor,
            total: commands.length,
            progress: commands.length ? cursor / commands.length : 0,
            remainingMs: Math.max(0, commands.length - cursor) * intervalMs,
            message
        };
    };

    const update = function (nextState = state, message = null) {
        state = nextState;
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
            await wait(Math.max(0, intervalMs - elapsed));
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
            update("paused");
        },
        resume: function () {
            if (state !== "paused") return;
            paused = false;
            wakePausedSession?.();
            update("drawing");
        },
        cancel: function () {
            if (["idle", "completed", "canceled", "failed"].includes(state)) return;
            canceled = true;
            paused = false;
            wakePausedSession?.();
            update("canceled");
        },
        getSnapshot: snapshot,
        getActivePromise: () => activePromise
    };
}

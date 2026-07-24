const padTimeUnit = value => value.toString().padStart(2, "0");

export const estimateRemainingTime = function ({
    elapsedMs,
    progress,
    remainingMs
}) {
    if (progress <= 0 || elapsedMs <= 0) return remainingMs;
    return elapsedMs * (1 - progress) / progress;
};

export const formatCountdown = function (milliseconds, hasRemainingWork = true) {
    const totalSeconds = hasRemainingWork
        ? Math.max(1, Math.ceil(milliseconds / 1000))
        : 0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;

    if (hours) {
        return `${padTimeUnit(hours)}:${padTimeUnit(minutes)}:${padTimeUnit(seconds)}`;
    }
    return `${padTimeUnit(minutes)}:${padTimeUnit(seconds)}`;
};

export default function createTimeEstimator(container) {
    const element = document.createElement("output");
    element.className = "autoDrawTimeEstimate";
    element.setAttribute("aria-label", "Estimated drawing time remaining");
    container.appendChild(element);

    return {
        update: function (snapshot) {
            if (snapshot.state === "verifying") {
                element.textContent = "--:--";
                return;
            }
            if (["failed", "canceled"].includes(snapshot.state)) {
                element.textContent = "--:--";
                return;
            }

            const hasRemainingWork = snapshot.cursor < snapshot.total;
            element.textContent = formatCountdown(
                estimateRemainingTime(snapshot),
                hasRemainingWork
            );
        },
        showCalculating: () => {
            element.textContent = "--:--";
        },
        clear: () => {
            element.textContent = "";
        }
    };
}

import createSpeedControl from "./speed-control.js";
import createTimeEstimator from "./time-estimator.js";

export default function createProgressControl(container) {
    const element = document.createElement("div");
    element.id = "autoDrawProgress";
    element.hidden = true;
    let handlers = {
        pause: () => {},
        resume: () => {},
        cancel: () => {},
        speedChange: () => {}
    };

    const label = document.createElement("span");
    label.className = "autoDrawProgressLabel";
    const progress = document.createElement("progress");
    progress.max = 1;
    progress.value = 0;
    const pauseButton = document.createElement("button");
    pauseButton.type = "button";
    pauseButton.textContent = "Pause";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";

    element.append(label, progress);
    const timeEstimator = createTimeEstimator(element);
    const speedControl = createSpeedControl(element, () => handlers.speedChange());
    element.append(pauseButton, cancelButton);
    container.appendChild(element);

    let hideTimer = null;

    pauseButton.addEventListener("click", () => {
        if (pauseButton.dataset.action === "resume") handlers.resume();
        else handlers.pause();
    });
    cancelButton.addEventListener("click", () => handlers.cancel());

    return {
        setHandlers: nextHandlers => {
            handlers = { ...handlers, ...nextHandlers };
        },
        update: function (snapshot) {
            clearTimeout(hideTimer);
            element.hidden = false;
            progress.value = snapshot.progress;
            timeEstimator.update(snapshot);
            const percent = Math.round(snapshot.progress * 100);

            if (snapshot.state === "paused") {
                label.textContent = `Paused ${percent}%`;
                pauseButton.textContent = "Resume";
                pauseButton.dataset.action = "resume";
            } else if (snapshot.state === "verifying") {
                label.textContent = "Verifying drawing";
                pauseButton.disabled = true;
            } else if (snapshot.state === "failed") {
                label.textContent = snapshot.message || "Drawing failed";
                pauseButton.disabled = true;
            } else if (snapshot.state === "canceled") {
                label.textContent = "Drawing canceled";
                pauseButton.disabled = true;
            } else {
                label.textContent = snapshot.state === "completed"
                    ? "Drawing complete"
                    : `Drawing ${percent}%`;
                pauseButton.textContent = "Pause";
                pauseButton.dataset.action = "pause";
                pauseButton.disabled = snapshot.state !== "drawing";
            }

            cancelButton.disabled = !["drawing", "paused", "verifying"].includes(snapshot.state);
            if (["completed", "canceled"].includes(snapshot.state)) {
                hideTimer = setTimeout(() => {
                    element.hidden = true;
                }, 1200);
            }
        },
        showAnalyzing: function () {
            clearTimeout(hideTimer);
            element.hidden = false;
            label.textContent = "Analyzing image";
            progress.removeAttribute("value");
            timeEstimator.showCalculating();
            pauseButton.disabled = true;
            cancelButton.disabled = false;
        },
        hide: function () {
            clearTimeout(hideTimer);
            element.hidden = true;
            progress.value = 0;
            timeEstimator.clear();
        },
        getCommandInterval: speedControl.getCommandInterval,
        resetSpeed: speedControl.reset
    };
}

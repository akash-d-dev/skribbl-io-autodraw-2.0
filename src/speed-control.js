export const minimumSpeed = 0;
export const maximumSpeed = 10;
export const speedStep = 0.5;

// Pacing is now inherent: each segment costs two animation frames because skribbl
// only renders a stroke when a frame boundary falls on both sides of the pointermove.
// That caps the real rate at ~30 segments/s on a 60Hz panel and ~70 on 144Hz, so the
// timer interval is pure added latency and the fastest setting is not a spam risk.
// Default to it; the slider now only slows drawing down.
export const defaultSpeed = maximumSpeed;

const clampSpeed = value => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return defaultSpeed;
    return Math.min(maximumSpeed, Math.max(minimumSpeed, numericValue));
};

export const normalizeSpeed = value =>
    Math.round(clampSpeed(value) / speedStep) * speedStep;

export const getCommandInterval = (baseIntervalMs, speed) =>
    Math.round(baseIntervalMs * 2 * (1 - normalizeSpeed(speed) / maximumSpeed));

const formatSpeed = speed => Number(speed).toString();

export default function createSpeedControl(container, onChange = () => {}) {
    const element = document.createElement("div");
    element.className = "autoDrawSpeed";

    const label = document.createElement("label");
    label.htmlFor = "autoDrawSpeedRange";
    label.textContent = "Speed ";

    const output = document.createElement("output");
    output.htmlFor = "autoDrawSpeedRange";

    const minimumButton = document.createElement("button");
    minimumButton.type = "button";
    minimumButton.className = "autoDrawSpeedButton";
    minimumButton.textContent = "Min";
    minimumButton.title = "Set minimum drawing speed";

    const range = document.createElement("input");
    range.id = "autoDrawSpeedRange";
    range.type = "range";
    range.min = minimumSpeed;
    range.max = maximumSpeed;
    range.step = speedStep;
    range.setAttribute("list", "autoDrawSpeedSteps");
    range.setAttribute("aria-label", "Drawing speed");

    const steps = document.createElement("datalist");
    steps.id = "autoDrawSpeedSteps";
    for (let value = minimumSpeed; value <= maximumSpeed; value += speedStep) {
        const option = document.createElement("option");
        option.value = value;
        steps.appendChild(option);
    }

    const maximumButton = document.createElement("button");
    maximumButton.type = "button";
    maximumButton.className = "autoDrawSpeedButton";
    maximumButton.textContent = "Max";
    maximumButton.title = "Set maximum drawing speed";

    label.appendChild(output);
    element.append(label, minimumButton, range, steps, maximumButton);
    container.appendChild(element);

    let speed = defaultSpeed;

    const setSpeed = function (value) {
        speed = normalizeSpeed(value);
        range.value = speed;
        range.style.setProperty(
            "--autoDrawSpeedProgress",
            `${speed / maximumSpeed * 100}%`
        );
        output.value = formatSpeed(speed);
        output.textContent = formatSpeed(speed);
        onChange(speed);
    };

    range.addEventListener("input", () => setSpeed(range.value));
    minimumButton.addEventListener("click", () => setSpeed(minimumSpeed));
    maximumButton.addEventListener("click", () => setSpeed(maximumSpeed));
    setSpeed(defaultSpeed);

    return {
        getSpeed: () => speed,
        getCommandInterval: baseIntervalMs => getCommandInterval(baseIntervalMs, speed),
        reset: () => setSpeed(defaultSpeed)
    };
}

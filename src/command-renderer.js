import { colorKey } from "./planning/color-utils.js";

export default function createCommandRenderer(canvas, toolbar) {
    let selectedTool = null;
    let selectedColor = null;
    let selectedDiameter = null;

    const setColor = function (color) {
        const key = colorKey(color);
        if (selectedColor === key) return;
        toolbar.setColor(color);
        selectedColor = key;
    };

    const setPen = function (diameter) {
        if (selectedTool !== "pen") {
            toolbar.setPenTool();
            selectedTool = "pen";
        }
        if (selectedDiameter !== diameter) {
            toolbar.setPenDiameter(diameter);
            selectedDiameter = diameter;
        }
    };

    const setFill = function () {
        if (selectedTool === "fill") return;
        toolbar.setFillTool();
        selectedTool = "fill";
    };

    const resetSelection = function () {
        selectedTool = null;
        selectedColor = null;
        selectedDiameter = null;
    };

    return {
        getSelection: () => ({
            tool: selectedTool,
            color: selectedColor,
            diameter: selectedDiameter
        }),
        execute: async function (command) {
            setColor(command.color);
            if (command.kind === "stroke") {
                setPen(command.diameter);
                await canvas.drawStroke(command.from, command.to);
                return;
            }
            if (command.kind === "polyline") {
                setPen(command.diameter);
                // drawPolyline issues one frame-bracketed gesture per segment; the
                // page drops moves batched inside a single gesture.
                await canvas.drawPolyline(command.points);
                return;
            }
            if (command.kind === "fill") {
                setFill();
                canvas.fill(command.point);
                return;
            }
            throw new Error(`Unsupported draw command: ${command.kind}`);
        },
        clear: async function () {
            toolbar.clear();
            resetSelection();
            await canvas.waitUntilStable();
        },
        resetSelection
    };
}

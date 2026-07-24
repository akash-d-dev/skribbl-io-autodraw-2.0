import { colorKey } from "./planning/color-utils.js";

const toRgbObject = function (rgbString) {
    const parts = rgbString.match(/\d+/g)?.map(Number);
    if (!parts || parts.length < 3) throw new Error(`Unsupported toolbar color: ${rgbString}`);
    return { r: parts[0], g: parts[1], b: parts[2] };
};

export default function createToolbar(domHelper) {
    const colorElements = Array.from(domHelper.getColorElements());
    const colors = colorElements.map(element => toRgbObject(
        element.style.backgroundColor || getComputedStyle(element).backgroundColor
    ));
    const colorElementsByKey = new Map(
        colorElements.map((element, index) => [colorKey(colors[index]), element])
    );
    const sizeElements = Array.from(domHelper.getSizeElements());
    const sizeElementsByDiameter = new Map(
        [4, 10, 20, 32, 40].map((diameter, index) => [diameter, sizeElements[index]])
    );

    return {
        getColors: () => colors,
        setColor: color => {
            const element = colorElementsByKey.get(colorKey(color));
            if (!element) throw new Error(`Toolbar color unavailable: ${colorKey(color)}`);
            element.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true,
                pointerId: 1,
                pointerType: "mouse",
                button: 0,
                buttons: 1
            }));
        },
        setPenDiameter: diameter => {
            const element = sizeElementsByDiameter.get(diameter);
            if (!element) throw new Error(`Toolbar pen diameter unavailable: ${diameter}`);
            element.click();
        },
        clear: () => domHelper.getClearToolElement().click(),
        setPenTool: () => domHelper.getPenToolElement().click(),
        setFillTool: () => domHelper.getFillToolElement().click(),
        // Measured: #game-toolbar keeps computed display:grid even when it is
        // someone else's turn, so a display check always reported "enabled" and the
        // draw session never stopped itself at the end of a turn. The real signal is
        // the "toolbar-hidden" class on #game-wrapper.
        isEnabled: function () {
            const wrapper = domHelper.getGameWrapperElement();
            if (wrapper?.classList.contains("toolbar-hidden")) return false;
            const toolbar = domHelper.getToolbarElement();
            if (!toolbar) return false;
            return getComputedStyle(toolbar).display !== "none";
        }
    };
}

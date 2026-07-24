// Geometry cost of a plan, in segment-equivalents.
//
// Command count stopped being a usable cost proxy once contours became single
// polylines: one command can now carry hundreds of segments. Plan searches that
// want "cheapest plan above a fidelity floor" must compare this instead, or they
// will happily pick a plan with fewer commands and far more work in them.
export const commandSegments = function (command) {
    if (command.kind === "polyline") return Math.max(1, command.points.length - 1);
    return 1;
};

export const planSegments = function (commands) {
    let total = 0;
    for (const command of commands) total += commandSegments(command);
    return total;
};

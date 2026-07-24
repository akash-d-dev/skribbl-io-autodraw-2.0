// Chains axis-aligned coverage runs into boustrophedon polylines.
//
// The coverage passes produce one run per row (or column) per color. Emitted as
// individual strokes that is enormously wasteful: most runs are a single grid cell,
// so the plan spends the bulk of its commands on dabs covering almost no area.
//
// Two runs are only chained when the connector between them stays inside the
// second run's own span. That keeps every painted pixel inside the color we are
// already drawing, so chaining never trades accuracy for command count.

const chainAxis = function (runs, axis) {
    const majorOf = run => axis === "row" ? run.y1 : run.x1;
    const lowOf = run => axis === "row" ? run.x1 : run.y1;
    const highOf = run => axis === "row" ? run.x2 : run.y2;
    const pointAt = (run, along) => axis === "row"
        ? { x: along, y: run.y1 }
        : { x: run.x1, y: along };

    const byMajor = new Map();
    for (const run of runs) {
        const major = majorOf(run);
        if (!byMajor.has(major)) byMajor.set(major, []);
        byMajor.get(major).push(run);
    }
    for (const list of byMajor.values()) list.sort((a, b) => lowOf(a) - lowOf(b));

    const used = new Set();
    const chains = [];

    for (const major of [...byMajor.keys()].sort((a, b) => a - b)) {
        for (const start of byMajor.get(major)) {
            if (used.has(start)) continue;
            used.add(start);

            // Traverse the first run low -> high, then alternate.
            const chain = [pointAt(start, lowOf(start)), pointAt(start, highOf(start))];
            let current = start;
            let endpoint = highOf(start);

            for (;;) {
                const next = (byMajor.get(majorOf(current) + 1) || []).find(candidate =>
                    !used.has(candidate)
                    && lowOf(candidate) <= endpoint
                    && highOf(candidate) >= endpoint);
                if (!next) break;

                used.add(next);
                // Step across into the next lane at the shared coordinate. We enter
                // mid-span, so sweep to the near end first and then to the far end;
                // going straight to the far end would leave the near part unpainted.
                const low = lowOf(next);
                const high = highOf(next);
                const nearFirst = endpoint - low <= high - endpoint;
                const near = nearFirst ? low : high;
                const far = nearFirst ? high : low;
                chain.push(pointAt(next, endpoint));
                if (near !== endpoint) chain.push(pointAt(next, near));
                if (far !== near) chain.push(pointAt(next, far));
                current = next;
                endpoint = far;
            }
            chains.push(chain);
        }
    }
    return chains;
};

// Runs must all share one color and diameter.
export const chainRuns = function (runs) {
    const horizontal = runs.filter(run => run.y1 === run.y2);
    const vertical = runs.filter(run => run.x1 === run.x2 && run.y1 !== run.y2);
    return [...chainAxis(horizontal, "row"), ...chainAxis(vertical, "column")];
};

import assert from "node:assert/strict";
import test from "node:test";

import { chainRuns } from "../src/planning/serpentine.js";

const horizontalRun = (y, x1, x2) => ({ x1, y1: y, x2, y2: y });

// Every grid cell a chain draws over, walking its segments.
const coveredCells = function (chains) {
    const cells = new Set();
    for (const chain of chains) {
        for (let index = 0; index < chain.length - 1; index++) {
            const from = chain[index];
            const to = chain[index + 1];
            const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
            for (let step = 0; step <= steps; step++) {
                const t = steps === 0 ? 0 : step / steps;
                cells.add(`${Math.round(from.x + (to.x - from.x) * t)},${
                    Math.round(from.y + (to.y - from.y) * t)}`);
            }
        }
    }
    return cells;
};

const runCells = function (runs) {
    const cells = new Set();
    for (const run of runs) {
        for (let y = Math.min(run.y1, run.y2); y <= Math.max(run.y1, run.y2); y++) {
            for (let x = Math.min(run.x1, run.x2); x <= Math.max(run.x1, run.x2); x++) {
                cells.add(`${x},${y}`);
            }
        }
    }
    return cells;
};

test("a solid block of rows chains into a single polyline", () => {
    const runs = [];
    for (let y = 0; y < 6; y++) runs.push(horizontalRun(y, 2, 9));

    const chains = chainRuns(runs);
    assert.equal(chains.length, 1);
});

test("chaining covers every cell the runs covered", () => {
    const runs = [];
    for (let y = 0; y < 6; y++) runs.push(horizontalRun(y, 2, 9));

    const covered = coveredCells(chainRuns(runs));
    for (const cell of runCells(runs)) {
        assert.ok(covered.has(cell), `chain lost cell ${cell}`);
    }
});

test("entering a wider lane mid-span still covers the whole lane", () => {
    // Row 0 is narrow, row 1 is wide, so the chain enters row 1 in the middle.
    const runs = [horizontalRun(0, 10, 11), horizontalRun(1, 4, 20)];

    const chains = chainRuns(runs);
    assert.equal(chains.length, 1);

    const covered = coveredCells(chains);
    for (const cell of runCells(runs)) {
        assert.ok(covered.has(cell), `chain lost cell ${cell}`);
    }
});

test("chaining never paints outside the runs", () => {
    const runs = [horizontalRun(0, 4, 20), horizontalRun(1, 10, 11)];

    const allowed = runCells(runs);
    for (const cell of coveredCells(chainRuns(runs))) {
        assert.ok(allowed.has(cell), `chain painted outside the runs at ${cell}`);
    }
});

test("lanes that do not overlap the entry point are not chained", () => {
    // Row 1 sits entirely to the right of row 0, so no connector stays inside it.
    const runs = [horizontalRun(0, 0, 2), horizontalRun(1, 40, 42)];

    assert.equal(chainRuns(runs).length, 2);
});

test("single cells stack into one chain and are not double-drawn", () => {
    const runs = [];
    for (let y = 0; y < 5; y++) runs.push(horizontalRun(y, 7, 7));

    const chains = chainRuns(runs);
    assert.equal(chains.length, 1);
    assert.deepEqual([...coveredCells(chains)].sort(), [
        "7,0", "7,1", "7,2", "7,3", "7,4"
    ].sort());
});

test("vertical runs chain across adjacent columns", () => {
    const runs = [];
    for (let x = 0; x < 4; x++) runs.push({ x1: x, y1: 3, x2: x, y2: 12 });

    const chains = chainRuns(runs);
    assert.equal(chains.length, 1);

    const covered = coveredCells(chains);
    for (const cell of runCells(runs)) {
        assert.ok(covered.has(cell), `chain lost cell ${cell}`);
    }
});

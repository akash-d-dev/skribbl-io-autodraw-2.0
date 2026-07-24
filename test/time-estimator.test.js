import assert from "node:assert/strict";
import test from "node:test";

import {
    estimateRemainingTime,
    formatCountdown
} from "../src/time-estimator.js";

test("time estimate uses elapsed progress rate", () => {
    assert.equal(estimateRemainingTime({
        elapsedMs: 3000,
        progress: 0.25,
        remainingMs: 100
    }), 9000);
});

test("countdown keeps a normal timer value while work remains", () => {
    assert.equal(formatCountdown(0), "00:01");
    assert.equal(formatCountdown(999), "00:01");
    assert.equal(formatCountdown(1001), "00:02");
});

test("countdown formats long durations and completion", () => {
    assert.equal(formatCountdown(61000), "01:01");
    assert.equal(formatCountdown(3661000), "01:01:01");
    assert.equal(formatCountdown(0, false), "00:00");
});

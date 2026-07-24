import assert from "node:assert/strict";
import test from "node:test";

import {
    defaultSpeed,
    getCommandInterval,
    normalizeSpeed
} from "../src/speed-control.js";

test("drawing speed snaps and clamps to supported half steps", () => {
    assert.equal(normalizeSpeed(-1), 0);
    assert.equal(normalizeSpeed(0.24), 0);
    assert.equal(normalizeSpeed(0.26), 0.5);
    assert.equal(normalizeSpeed(7.74), 7.5);
    assert.equal(normalizeSpeed(7.76), 8);
    assert.equal(normalizeSpeed(11), 10);
    assert.equal(normalizeSpeed("invalid"), defaultSpeed);
});

test("drawing speed starts at the fastest, since frame pacing is the real floor", () => {
    assert.equal(defaultSpeed, 10);
    assert.equal(getCommandInterval(18, defaultSpeed), 0);
});

test("minimum and maximum speeds map to slowest and fastest intervals", () => {
    assert.equal(getCommandInterval(18, 0), 36);
    assert.equal(getCommandInterval(18, 5), 18);
    assert.equal(getCommandInterval(18, 10), 0);
});

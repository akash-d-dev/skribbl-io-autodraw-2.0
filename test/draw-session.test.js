import assert from "node:assert/strict";
import test from "node:test";

import createDrawSession from "../src/draw-session.js";

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test("draw session pauses and resumes from exact command cursor", async () => {
    const executed = [];
    const waiters = [];
    const session = createDrawSession({
        execute: async command => executed.push(command.id),
        wait: () => new Promise(resolve => waiters.push(resolve)),
        now: () => 0
    });

    const resultPromise = session.start([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await nextTurn();
    assert.deepEqual(executed, [1]);

    session.pause();
    waiters.shift()();
    await nextTurn();
    assert.deepEqual(executed, [1]);
    assert.equal(session.getSnapshot().cursor, 1);

    session.resume();
    await nextTurn();
    assert.deepEqual(executed, [1, 2]);
    while (waiters.length) waiters.shift()();
    await nextTurn();
    assert.deepEqual(executed, [1, 2, 3]);
    while (waiters.length) waiters.shift()();

    const result = await resultPromise;
    assert.equal(result.state, "completed");
    assert.equal(result.cursor, 3);
});

test("draw session cancels when canvas generation becomes invalid", async () => {
    const waiters = [];
    let valid = true;
    const session = createDrawSession({
        execute: async () => {},
        isValid: () => valid,
        wait: () => new Promise(resolve => waiters.push(resolve)),
        now: () => 0
    });

    const resultPromise = session.start([{ id: 1 }, { id: 2 }]);
    await nextTurn();
    valid = false;
    waiters.shift()();
    const result = await resultPromise;

    assert.equal(result.state, "canceled");
    assert.equal(result.cursor, 1);
});

test("draw session appends bounded repair commands", async () => {
    const executed = [];
    let repairCalls = 0;
    const session = createDrawSession({
        execute: async command => executed.push(command.id),
        wait: async () => {},
        now: () => 0
    });

    const result = await session.start([{ id: 1 }], {
        createRepairs: async () => {
            repairCalls++;
            return repairCalls === 1 ? [{ id: 2 }] : [];
        }
    });

    assert.deepEqual(executed, [1, 2]);
    assert.equal(repairCalls, 2);
    assert.equal(result.state, "completed");
    assert.equal(result.total, 2);
});

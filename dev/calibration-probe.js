// Stage 0 calibration probes. Dev-only: not bundled, not in the manifest.
//
// Paste into the DevTools console on a skribbl.io tab, then:
//
//   __ad.discover()                          -> DOM + canvas geometry, no drawing
//   __ad.arm(["polyline","brush","fill","throughput"])
//   __ad.poll()                              -> {turn, queue, done, results}
//
// arm() queues probes and runs them whenever it is your turn to draw, surviving
// turn changes: a probe interrupted by the turn ending is retried next turn.
// Every probe clears the canvas after itself.

(function () {
    const $ = selector => document.querySelector(selector);
    const $$ = selector => Array.from(document.querySelectorAll(selector));

    const LOGICAL = { width: 800, height: 600 };

    const dom = () => ({
        canvas: $("#game-canvas canvas"),
        colors: $$("#game-toolbar .colors .color"),
        sizes: $$("#game-toolbar .sizes .size"),
        brush: $('#game-toolbar .tool[data-tooltip="Brush"]'),
        fill: $('#game-toolbar .tool[data-tooltip="Fill"]'),
        clear: $('#game-toolbar .tool[data-tooltip="Clear"]'),
        toolbar: $("#game-toolbar")
    });

    // Measured: #game-toolbar stays display:grid even when it is someone else's
    // turn. The real signal is the "toolbar-hidden" class on #game-wrapper.
    // (The shipped extension's toolbar.isEnabled() checks display and so never
    // detects the turn ending.)
    const isOurTurn = function () {
        const wrapper = $("#game-wrapper");
        if (wrapper && wrapper.classList.contains("toolbar-hidden")) return false;
        const d = dom();
        return Boolean(d.canvas && d.toolbar && d.clear && d.colors.length);
    };

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

    class TurnLost extends Error {}
    const requireTurn = function () {
        if (!isOurTurn()) throw new TurnLost("turn ended");
    };

    // --- input ---

    const toClient = function (canvas, point) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: point.x * rect.width / LOGICAL.width + rect.x,
            y: point.y * rect.height / LOGICAL.height + rect.y
        };
    };

    // Measured: skribbl accepts PointerEvent only (MouseEvent paints nothing), and
    // pointermove must target the canvas -- dispatching moves on window paints only
    // the initial dab.
    const pointer = function (canvas, name, point, pressed) {
        const client = toClient(canvas, point);
        canvas.dispatchEvent(new PointerEvent(name, {
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            clientX: client.x,
            clientY: client.y,
            button: 0,
            buttons: pressed ? 1 : 0
        }));
    };

    const gesture = function (canvas, points) {
        pointer(canvas, "pointerdown", points[0], true);
        for (let i = 1; i < points.length; i++) {
            pointer(canvas, "pointermove", points[i], true);
        }
        pointer(canvas, "pointerup", points[points.length - 1], false);
    };

    // Measured 12/12 reliable. A segment renders only when a frame boundary falls on
    // both sides of the move: down/move/up in one task renders 1 of 12.
    const stroke = async function (canvas, from, to) {
        pointer(canvas, "pointerdown", from, true);
        await frame();
        pointer(canvas, "pointermove", to, true);
        await frame();
        pointer(canvas, "pointerup", to, false);
    };

    // One gesture held open, one move per frame. If each move yields a segment this
    // is twice as fast as a per-segment gesture (1 frame vs 2 per segment).
    const framePacedPolyline = async function (canvas, points) {
        pointer(canvas, "pointerdown", points[0], true);
        await frame();
        for (let i = 1; i < points.length; i++) {
            pointer(canvas, "pointermove", points[i], true);
            await frame();
        }
        pointer(canvas, "pointerup", points[points.length - 1], false);
    };

    const click = function (canvas, point) {
        pointer(canvas, "pointerdown", point, true);
        pointer(canvas, "pointerup", point, false);
    };

    const parseRgb = function (value) {
        const parts = String(value).match(/\d+/g);
        return parts ? parts.slice(0, 3).map(Number) : [0, 0, 0];
    };

    const paletteRgb = () => dom().colors.map(element =>
        parseRgb(element.style.backgroundColor
            || getComputedStyle(element).backgroundColor));

    // The real toolbar has 26 swatches; never hardcode an index.
    const colorIndexNear = function (target) {
        const palette = paletteRgb();
        let best = 0;
        let bestDistance = Infinity;
        palette.forEach((rgb, index) => {
            const distance = (rgb[0] - target[0]) ** 2
                + (rgb[1] - target[1]) ** 2
                + (rgb[2] - target[2]) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = index;
            }
        });
        return best;
    };

    const selectColor = function (target) {
        const element = dom().colors[colorIndexNear(target)];
        element.dispatchEvent(new PointerEvent("pointerdown", {
            pointerId: 1,
            pointerType: "mouse",
            bubbles: true,
            button: 0,
            buttons: 1
        }));
    };

    const selectPen = function (sizeIndex) {
        dom().brush.click();
        dom().sizes[sizeIndex].click();
    };

    const clearCanvas = async function () {
        requireTurn();
        dom().clear.click();
        await sleep(600);
    };

    const BLACK = [0, 0, 0];
    const RED = [239, 19, 11];

    // --- pixels, in canvas backing-store coordinates ---

    const scaleOf = canvas => canvas.width / LOGICAL.width;

    const snapshot = function (canvas) {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        return context.getImageData(0, 0, canvas.width, canvas.height);
    };

    const isPainted = function (image, x, y) {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
        const i = (y * image.width + x) * 4;
        return image.data[i] < 240 || image.data[i + 1] < 240 || image.data[i + 2] < 240;
    };

    const colorAt = function (image, x, y) {
        const i = (y * image.width + x) * 4;
        return [image.data[i], image.data[i + 1], image.data[i + 2]];
    };

    const paintedNear = function (image, x, y, radius) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (isPainted(image, Math.round(x + dx), Math.round(y + dy))) return true;
            }
        }
        return false;
    };

    // --- probes ---

    const probes = {};

    // Does one gesture keep every pointermove, or does the page sample per frame?
    // A square wave is required: a straight line renders identically either way.
    probes.polyline = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);
        const runOne = async function (teeth) {
            await clearCanvas();
            requireTurn();
            selectColor(BLACK);
            selectPen(1);
            await frame();

            const points = [];
            for (let i = 0; i <= teeth; i++) {
                points.push({
                    x: 100 + i * (600 / teeth),
                    y: i % 2 === 0 ? 240 : 360
                });
            }
            gesture(canvas, points);
            await sleep(350);
            requireTurn();

            const image = snapshot(canvas);
            let apexHits = 0;
            for (let i = 1; i < points.length - 1; i++) {
                if (paintedNear(image, points[i].x * scale, points[i].y * scale, 6)) {
                    apexHits++;
                }
            }
            return {
                movesSent: points.length - 1,
                apexTotal: points.length - 2,
                apexHits,
                retention: apexHits / (points.length - 2)
            };
        };

        const sweep = [];
        for (const teeth of [4, 10, 20, 40, 80]) sweep.push(await runOne(teeth));
        await clearCanvas();

        const worst = Math.min(...sweep.map(entry => entry.retention));
        return {
            sweep,
            verdict: worst > 0.95
                ? "per-event: full polyline batching is safe"
                : "moves lost at some length: cap polyline length"
        };
    };

    probes.brush = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);
        const results = [];

        for (let index = 0; index < dom().sizes.length; index++) {
            await clearCanvas();
            requireTurn();
            selectColor(BLACK);
            selectPen(index);
            await frame();

            const y = 300;
            await stroke(canvas, { x: 150, y }, { x: 450, y });
            await sleep(200);
            requireTurn();

            const image = snapshot(canvas);
            const column = Math.round(300 * scale);
            let painted = 0;
            let solid = 0;
            for (let row = 0; row < image.height; row++) {
                if (!isPainted(image, column, row)) continue;
                painted++;
                const [r, g, b] = colorAt(image, column, row);
                if (r < 60 && g < 60 && b < 60) solid++;
            }
            results.push({
                sizeIndex: index,
                paintedDiameterPx: Number((painted / scale).toFixed(2)),
                solidDiameterPx: Number((solid / scale).toFixed(2))
            });
        }
        await clearCanvas();
        return { scale, results };
    };

    probes.fill = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);
        const report = { escapes: [] };
        const box = { left: 120, top: 140, right: 320, bottom: 340 };
        const inside = { x: 220, y: 240 };

        // Closed outline: measure any unfilled halo between the fill and the line.
        await clearCanvas();
        requireTurn();
        selectColor(BLACK);
        selectPen(0);
        await frame();
        gesture(canvas, [
            { x: box.left, y: box.top },
            { x: box.right, y: box.top },
            { x: box.right, y: box.bottom },
            { x: box.left, y: box.bottom },
            { x: box.left, y: box.top }
        ]);
        await sleep(250);
        requireTurn();
        selectColor(RED);
        dom().fill.click();
        click(canvas, inside);
        await sleep(500);
        requireTurn();

        let image = snapshot(canvas);
        const row = Math.round(inside.y * scale);
        let halo = 0;
        for (let x = Math.round(box.left * scale); x < Math.round(inside.x * scale); x++) {
            const [r, g, b] = colorAt(image, x, row);
            const black = r < 60 && g < 60 && b < 60;
            const red = r > 150 && g < 100 && b < 100;
            if (!black && !red) halo++;
        }
        report.haloPx = Number((halo / scale).toFixed(2));
        const center = colorAt(image, Math.round(inside.x * scale), row);
        report.filledInside = center[0] > 150 && center[1] < 100 && center[2] < 100;

        // Does the fill escape a gap of N logical px in the outline?
        for (const gapPx of [1, 2, 4, 8]) {
            await clearCanvas();
            requireTurn();
            selectColor(BLACK);
            selectPen(0);
            await frame();
            const mid = (box.left + box.right) / 2;
            gesture(canvas, [{ x: box.left, y: box.top }, { x: mid - gapPx / 2, y: box.top }]);
            gesture(canvas, [{ x: mid + gapPx / 2, y: box.top }, { x: box.right, y: box.top }]);
            gesture(canvas, [
                { x: box.right, y: box.top },
                { x: box.right, y: box.bottom },
                { x: box.left, y: box.bottom },
                { x: box.left, y: box.top }
            ]);
            await sleep(250);
            requireTurn();
            selectColor(RED);
            dom().fill.click();
            click(canvas, inside);
            await sleep(500);
            requireTurn();

            image = snapshot(canvas);
            // Far outside the box: only reachable through the gap.
            const outside = colorAt(
                image,
                Math.round(mid * scale),
                Math.round(40 * scale)
            );
            report.escapes.push({
                gapPx,
                escaped: outside[0] > 150 && outside[1] < 100 && outside[2] < 100
            });
        }

        await clearCanvas();
        return report;
    };

    // Is a held-open gesture worth 1 frame per segment instead of 2? Draws a
    // staircase so every segment is individually checkable, and times it.
    probes.framePolyline = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);

        const points = [];
        const count = 24;
        for (let i = 0; i <= count; i++) {
            points.push({
                x: 100 + i * 25,
                y: i % 2 === 0 ? 200 : 260
            });
        }

        await clearCanvas();
        requireTurn();
        selectColor(BLACK);
        selectPen(0);
        await frame();

        const startedAt = performance.now();
        await framePacedPolyline(canvas, points);
        const elapsedMs = performance.now() - startedAt;
        await sleep(500);
        requireTurn();

        const image = snapshot(canvas);
        // Every interior vertex must be painted, and so must each segment midpoint.
        let vertexHits = 0;
        let midpointHits = 0;
        for (let i = 1; i < points.length - 1; i++) {
            if (paintedNear(image, points[i].x * scale, points[i].y * scale, 5)) vertexHits++;
        }
        for (let i = 0; i < points.length - 1; i++) {
            const mx = (points[i].x + points[i + 1].x) / 2;
            const my = (points[i].y + points[i + 1].y) / 2;
            if (paintedNear(image, mx * scale, my * scale, 5)) midpointHits++;
        }

        await clearCanvas();
        const segments = points.length - 1;
        return {
            segments,
            vertexTotal: points.length - 2,
            vertexHits,
            midpointTotal: segments,
            midpointHits,
            elapsedMs: Math.round(elapsedMs),
            msPerSegment: Number((elapsedMs / segments).toFixed(1)),
            segmentsPerSecond: Math.round(segments / (elapsedMs / 1000))
        };
    };

    // Which gesture shape reliably renders a whole SEGMENT rather than just the
    // pointerdown dab?
    //
    // Measured: 20 gestures burst in one task render 1 full segment and 19 bare dabs;
    // one gesture per animation frame still renders only ~9 of 20. So the shipped
    // down/move/up primitive silently loses most strokes. A long run is easy to tell
    // from a dab by its painted length, which is what this counts.
    probes.primitive = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);

        const strategies = {
            downMoveUpBurst: async function (a, b) {
                pointer(canvas, "pointerdown", a, true);
                pointer(canvas, "pointermove", b, true);
                pointer(canvas, "pointerup", b, false);
            },
            moveThenFrameThenUp: async function (a, b) {
                pointer(canvas, "pointerdown", a, true);
                pointer(canvas, "pointermove", b, true);
                await frame();
                pointer(canvas, "pointerup", b, false);
            },
            frameAroundMove: async function (a, b) {
                pointer(canvas, "pointerdown", a, true);
                await frame();
                pointer(canvas, "pointermove", b, true);
                await frame();
                pointer(canvas, "pointerup", b, false);
            },
            doubleMoveNoFrame: async function (a, b) {
                pointer(canvas, "pointerdown", a, true);
                pointer(canvas, "pointermove", b, true);
                pointer(canvas, "pointermove", b, true);
                pointer(canvas, "pointerup", b, false);
            }
        };

        const rows = [];
        for (let i = 0; i < 12; i++) rows.push(70 + i * 40);

        const out = {};
        for (const [name, apply] of Object.entries(strategies)) {
            await clearCanvas();
            requireTurn();
            selectColor(BLACK);
            selectPen(0);
            await frame();

            for (const y of rows) {
                await apply({ x: 120, y }, { x: 620, y });
            }
            // Make sure no gesture is left open.
            pointer(canvas, "pointerup", { x: 620, y: rows[rows.length - 1] }, false);
            await sleep(500);
            requireTurn();

            const image = snapshot(canvas);
            let full = 0;
            let dabOnly = 0;
            let blank = 0;
            for (const y of rows) {
                let painted = 0;
                for (let x = 120; x <= 620; x++) {
                    for (let d = -3; d <= 3; d++) {
                        if (isPainted(image, Math.round(x * scale), Math.round((y + d) * scale))) {
                            painted++;
                            break;
                        }
                    }
                }
                if (painted > 400) full++;
                else if (painted > 0) dabOnly++;
                else blank++;
            }
            out[name] = { rows: rows.length, full, dabOnly, blank };
        }

        await clearCanvas();
        return out;
    };

    // Does an outline made of a few long segments enclose as reliably as one made of
    // many short ones? Continuity is verified pixel-by-pixel BEFORE filling, so a
    // leak can be attributed to a real gap rather than guessed at.
    probes.enclosure = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);
        const box = { l: 200, t: 180, r: 400, b: 380 };
        const inside = { x: 300, y: 280 };

        const variants = [
            {
                name: "fourLongSegments",
                draw: async function () {
                    await stroke(canvas, { x: box.l, y: box.t }, { x: box.r, y: box.t });
                    await stroke(canvas, { x: box.r, y: box.t }, { x: box.r, y: box.b });
                    await stroke(canvas, { x: box.r, y: box.b }, { x: box.l, y: box.b });
                    await stroke(canvas, { x: box.l, y: box.b }, { x: box.l, y: box.t });
                }
            },
            {
                name: "closedPolyline",
                draw: async function () {
                    await framePacedPolyline(canvas, [
                        { x: box.l, y: box.t }, { x: box.r, y: box.t },
                        { x: box.r, y: box.b }, { x: box.l, y: box.b },
                        { x: box.l, y: box.t }
                    ]);
                }
            },
            {
                name: "manyShortSegments",
                draw: async function () {
                    const step = 10;
                    const corners = [
                        { x: box.l, y: box.t }, { x: box.r, y: box.t },
                        { x: box.r, y: box.b }, { x: box.l, y: box.b },
                        { x: box.l, y: box.t }
                    ];
                    for (let i = 0; i < corners.length - 1; i++) {
                        const a = corners[i];
                        const b = corners[i + 1];
                        const length = Math.hypot(b.x - a.x, b.y - a.y);
                        const steps = Math.max(1, Math.ceil(length / step));
                        for (let s = 0; s < steps; s++) {
                            await stroke(
                                canvas,
                                {
                                    x: a.x + (b.x - a.x) * s / steps,
                                    y: a.y + (b.y - a.y) * s / steps
                                },
                                {
                                    x: a.x + (b.x - a.x) * (s + 1) / steps,
                                    y: a.y + (b.y - a.y) * (s + 1) / steps
                                }
                            );
                        }
                    }
                }
            }
        ];

        const results = [];
        for (const variant of variants) {
            await clearCanvas();
            requireTurn();
            selectColor(BLACK);
            selectPen(0);
            await frame();
            await variant.draw();
            await sleep(400);
            requireTurn();

            // Verify the barrier before trusting anything about the fill.
            let image = snapshot(canvas);
            const black = (x, y) => {
                const [r, g, b] = colorAt(image, Math.round(x), Math.round(y));
                return r < 60 && g < 60 && b < 60;
            };
            let gaps = 0;
            const edges = [
                { fixedIsY: true, fixed: box.t, from: box.l, to: box.r },
                { fixedIsY: true, fixed: box.b, from: box.l, to: box.r },
                { fixedIsY: false, fixed: box.l, from: box.t, to: box.b },
                { fixedIsY: false, fixed: box.r, from: box.t, to: box.b }
            ];
            for (const edge of edges) {
                for (let v = edge.from; v <= edge.to; v++) {
                    let ok = false;
                    for (let d = -4; d <= 4 && !ok; d++) {
                        if (edge.fixedIsY
                            ? black(v * scale, (edge.fixed + d) * scale)
                            : black((edge.fixed + d) * scale, v * scale)) ok = true;
                    }
                    if (!ok) gaps++;
                }
            }

            selectColor(RED);
            dom().fill.click();
            click(canvas, inside);
            await sleep(600);
            requireTurn();

            image = snapshot(canvas);
            const isRed = function (x, y) {
                const [r, g, b] = colorAt(image, Math.round(x), Math.round(y));
                return r > 150 && g < 100 && b < 100;
            };
            let insideRed = 0;
            let insideTotal = 0;
            let outsideRed = 0;
            let outsideTotal = 0;
            for (let y = 0; y < LOGICAL.height; y += 2) {
                for (let x = 0; x < LOGICAL.width; x += 2) {
                    const within = x > box.l + 10 && x < box.r - 10
                        && y > box.t + 10 && y < box.b - 10;
                    const beyond = x < box.l - 20 || x > box.r + 20
                        || y < box.t - 20 || y > box.b + 20;
                    if (within) {
                        insideTotal++;
                        if (isRed(x * scale, y * scale)) insideRed++;
                    } else if (beyond) {
                        outsideTotal++;
                        if (isRed(x * scale, y * scale)) outsideRed++;
                    }
                }
            }

            results.push({
                variant: variant.name,
                barrierGaps: gaps,
                insideFilledPct: Math.round(insideRed / insideTotal * 100),
                outsideFilledPct: Math.round(outsideRed / outsideTotal * 100)
            });
        }

        await clearCanvas();
        return { results };
    };

    // Two ways to amortise the 2-frame cost down towards 1 frame per segment:
    //   pipelined  - one gesture's pointerup shares a task with the next gesture's
    //                pointerdown+pointermove, so each frame retires one segment
    //   twoPointers- two independent pointerIds in flight at once, in case the page
    //                tracks pointers separately (multi-touch style)
    probes.pipeline = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);

        const pointerWithId = function (id, name, point, pressed) {
            const client = toClient(canvas, point);
            canvas.dispatchEvent(new PointerEvent(name, {
                pointerId: id,
                pointerType: "mouse",
                isPrimary: id === 1,
                bubbles: true,
                cancelable: true,
                clientX: client.x,
                clientY: client.y,
                button: 0,
                buttons: pressed ? 1 : 0
            }));
        };

        const makeTargets = function () {
            const targets = [];
            for (let row = 0; row < 10; row++) {
                for (let column = 0; column < 6; column++) {
                    const x = 80 + column * 110;
                    const y = 60 + row * 50;
                    targets.push({ from: { x, y }, to: { x: x + 70, y } });
                }
            }
            return targets;
        };

        const score = function (image, targets) {
            let delivered = 0;
            for (const target of targets) {
                let painted = 0;
                for (let x = target.from.x; x <= target.to.x; x++) {
                    for (let d = -3; d <= 3; d++) {
                        if (isPainted(
                            image,
                            Math.round(x * scale),
                            Math.round((target.from.y + d) * scale)
                        )) {
                            painted++;
                            break;
                        }
                    }
                }
                if (painted > 55) delivered++;
            }
            return delivered;
        };

        const runs = {};

        // pipelined, single pointer
        {
            await clearCanvas();
            requireTurn();
            selectColor(BLACK);
            selectPen(0);
            await frame();
            const targets = makeTargets();
            const startedAt = performance.now();
            let open = null;
            for (const target of targets) {
                if (open) pointer(canvas, "pointerup", open, false);
                pointer(canvas, "pointerdown", target.from, true);
                pointer(canvas, "pointermove", target.to, true);
                open = target.to;
                await frame();
            }
            pointer(canvas, "pointerup", open, false);
            const elapsedMs = performance.now() - startedAt;
            await sleep(600);
            requireTurn();
            const delivered = score(snapshot(canvas), targets);
            runs.pipelinedSinglePointer = {
                attempted: targets.length,
                delivered,
                deliveryRate: Number((delivered / targets.length).toFixed(3)),
                msPerSegment: Number((elapsedMs / targets.length).toFixed(1)),
                segmentsPerSecond: Math.round(targets.length / (elapsedMs / 1000))
            };
        }

        // two pointer ids in flight
        {
            await clearCanvas();
            requireTurn();
            selectColor(BLACK);
            selectPen(0);
            await frame();
            const targets = makeTargets();
            const startedAt = performance.now();
            for (let i = 0; i < targets.length; i += 2) {
                const a = targets[i];
                const b = targets[i + 1];
                pointerWithId(1, "pointerdown", a.from, true);
                if (b) pointerWithId(2, "pointerdown", b.from, true);
                pointerWithId(1, "pointermove", a.to, true);
                if (b) pointerWithId(2, "pointermove", b.to, true);
                await frame();
                pointerWithId(1, "pointerup", a.to, false);
                if (b) pointerWithId(2, "pointerup", b.to, false);
                await frame();
            }
            const elapsedMs = performance.now() - startedAt;
            await sleep(600);
            requireTurn();
            const delivered = score(snapshot(canvas), targets);
            runs.twoPointerIds = {
                attempted: targets.length,
                delivered,
                deliveryRate: Number((delivered / targets.length).toFixed(3)),
                msPerSegment: Number((elapsedMs / targets.length).toFixed(1)),
                segmentsPerSecond: Math.round(targets.length / (elapsedMs / 1000))
            };
        }

        await clearCanvas();
        return runs;
    };

    // Can a segment be delivered in ONE frame instead of two? That is a straight 2x
    // on total draw time, so it is worth knowing exactly. Also tries pipelining, where
    // one gesture's pointerup shares a task with the next gesture's pointerdown.
    probes.frameCost = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);

        const shapes = {
            twoFrames: async function (from, to) {
                pointer(canvas, "pointerdown", from, true);
                await frame();
                pointer(canvas, "pointermove", to, true);
                await frame();
                pointer(canvas, "pointerup", to, false);
            },
            oneFrameAfterDown: async function (from, to) {
                pointer(canvas, "pointerdown", from, true);
                await frame();
                pointer(canvas, "pointermove", to, true);
                pointer(canvas, "pointerup", to, false);
            },
            oneFrameNoUp: async function (from, to) {
                // Leave the gesture open; the next pointerdown implicitly ends it.
                pointer(canvas, "pointerdown", from, true);
                await frame();
                pointer(canvas, "pointermove", to, true);
            },
            movePlusUpAfterFrame: async function (from, to) {
                pointer(canvas, "pointerdown", from, true);
                pointer(canvas, "pointermove", to, true);
                await frame();
                pointer(canvas, "pointerup", to, false);
                await frame();
            }
        };

        const out = {};
        for (const [name, apply] of Object.entries(shapes)) {
            await clearCanvas();
            requireTurn();
            selectColor(BLACK);
            selectPen(0);
            await frame();

            const targets = [];
            for (let row = 0; row < 10; row++) {
                for (let column = 0; column < 6; column++) {
                    const x = 80 + column * 110;
                    const y = 60 + row * 50;
                    targets.push({ from: { x, y }, to: { x: x + 70, y } });
                }
            }

            const startedAt = performance.now();
            for (const target of targets) await apply(target.from, target.to);
            pointer(canvas, "pointerup", targets[targets.length - 1].to, false);
            const elapsedMs = performance.now() - startedAt;
            await sleep(600);
            requireTurn();

            const image = snapshot(canvas);
            let delivered = 0;
            for (const target of targets) {
                let painted = 0;
                for (let x = target.from.x; x <= target.to.x; x++) {
                    for (let d = -3; d <= 3; d++) {
                        if (isPainted(
                            image,
                            Math.round(x * scale),
                            Math.round((target.from.y + d) * scale)
                        )) {
                            painted++;
                            break;
                        }
                    }
                }
                if (painted > 55) delivered++;
            }
            out[name] = {
                attempted: targets.length,
                delivered,
                deliveryRate: Number((delivered / targets.length).toFixed(3)),
                msPerSegment: Number((elapsedMs / targets.length).toFixed(1)),
                segmentsPerSecond: Math.round(targets.length / (elapsedMs / 1000))
            };
        }

        await clearCanvas();
        return out;
    };

    // The budget number that matters: with the frame-bracketed primitive, how many
    // segments actually land per second, and what fraction is lost? Draws a grid of
    // separated short strokes long enough to distinguish a real segment from a dab.
    probes.deliveryRate = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);
        await clearCanvas();
        requireTurn();
        selectColor(BLACK);
        selectPen(0);
        await frame();

        const targets = [];
        for (let row = 0; row < 14; row++) {
            for (let column = 0; column < 12; column++) {
                const x = 60 + column * 60;
                const y = 50 + row * 38;
                targets.push({ from: { x, y }, to: { x: x + 40, y } });
            }
        }

        const startedAt = performance.now();
        for (const target of targets) {
            await stroke(canvas, target.from, target.to);
        }
        const elapsedMs = performance.now() - startedAt;
        await sleep(600);
        requireTurn();

        const image = snapshot(canvas);
        let delivered = 0;
        let dabOnly = 0;
        for (const target of targets) {
            let painted = 0;
            for (let x = target.from.x; x <= target.to.x; x++) {
                for (let d = -3; d <= 3; d++) {
                    if (isPainted(image, Math.round(x * scale), Math.round((target.from.y + d) * scale))) {
                        painted++;
                        break;
                    }
                }
            }
            if (painted > 30) delivered++;
            else if (painted > 0) dabOnly++;
        }

        await clearCanvas();
        return {
            attempted: targets.length,
            delivered,
            dabOnly,
            deliveryRate: Number((delivered / targets.length).toFixed(3)),
            elapsedMs: Math.round(elapsedMs),
            msPerSegment: Number((elapsedMs / targets.length).toFixed(1)),
            segmentsPerSecond: Math.round(targets.length / (elapsedMs / 1000)),
            projectedSegmentsIn80s: Math.round(targets.length / (elapsedMs / 1000) * 80)
        };
    };

    // Widely spaced dots so a single missing one is detectable; overlapping
    // strokes would hide loss entirely.
    probes.throughput = async function () {
        const { canvas } = dom();
        const scale = scaleOf(canvas);
        const results = [];

        for (const perFrame of [1, 4, 16, 64]) {
            await clearCanvas();
            requireTurn();
            selectColor(BLACK);
            selectPen(0);
            await frame();

            const dots = [];
            for (let row = 0; row < 18; row++) {
                for (let column = 0; column < 32; column++) {
                    dots.push({ x: 40 + column * 23, y: 60 + row * 28 });
                }
            }

            const startedAt = performance.now();
            for (let i = 0; i < dots.length; i += perFrame) {
                for (let k = i; k < Math.min(i + perFrame, dots.length); k++) {
                    await stroke(canvas, dots[k], { x: dots[k].x + 1, y: dots[k].y });
                }
                await frame();
            }
            const elapsedMs = performance.now() - startedAt;
            await sleep(900);
            requireTurn();

            const image = snapshot(canvas);
            let present = 0;
            for (const dot of dots) {
                if (paintedNear(image, dot.x * scale, dot.y * scale, 4)) present++;
            }
            results.push({
                perFrame,
                sent: dots.length,
                presentLocally: present,
                localRetention: Number((present / dots.length).toFixed(4)),
                elapsedMs: Math.round(elapsedMs),
                commandsPerSecond: Math.round(dots.length / (elapsedMs / 1000))
            });
        }

        await clearCanvas();
        return {
            results,
            note: "local canvas only; a second client must confirm the server relayed these"
        };
    };

    // --- driver ---

    const api = {
        queue: [],
        results: {},
        running: null,
        log: [],

        discover: function () {
            const d = dom();
            return {
                found: {
                    canvas: Boolean(d.canvas),
                    colors: d.colors.length,
                    sizes: d.sizes.length,
                    brush: Boolean(d.brush),
                    fill: Boolean(d.fill),
                    clear: Boolean(d.clear)
                },
                ourTurn: isOurTurn(),
                canvasBacking: d.canvas
                    ? { width: d.canvas.width, height: d.canvas.height }
                    : null,
                canvasRect: d.canvas
                    ? (r => ({ width: r.width, height: r.height }))(
                        d.canvas.getBoundingClientRect())
                    : null,
                palette: paletteRgb(),
                blackIndex: d.colors.length ? colorIndexNear(BLACK) : null,
                redIndex: d.colors.length ? colorIndexNear(RED) : null
            };
        },

        arm: function (names) {
            api.queue = Array.isArray(names) ? names.slice() : [names];
            for (const name of api.queue) {
                if (!probes[name]) return `unknown probe: ${name}`;
            }
            if (!api.loopStarted) {
                api.loopStarted = true;
                api.loop();
            }
            return `armed: ${api.queue.join(", ")}`;
        },

        loop: async function () {
            while (api.queue.length) {
                if (!isOurTurn()) {
                    api.running = null;
                    await sleep(1000);
                    continue;
                }
                const name = api.queue[0];
                api.running = name;
                try {
                    api.results[name] = await probes[name]();
                    api.queue.shift();
                    api.log.push(`${name}: done`);
                } catch (error) {
                    if (error instanceof TurnLost) {
                        // Keep it queued and retry on the next turn.
                        api.log.push(`${name}: interrupted, will retry`);
                        await sleep(1000);
                        continue;
                    }
                    api.results[name] = { error: String(error && error.message || error) };
                    api.queue.shift();
                    api.log.push(`${name}: failed`);
                }
            }
            api.running = null;
            api.loopStarted = false;
        },

        poll: () => ({
            ourTurn: isOurTurn(),
            running: api.running,
            queue: api.queue,
            done: Object.keys(api.results),
            log: api.log.slice(-8),
            results: api.results
        })
    };

    window.__ad = api;
    return "probe ready";
})();

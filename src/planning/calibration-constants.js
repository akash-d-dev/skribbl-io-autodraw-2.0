// Measured against live skribbl.io on 2026-07-25 with dev/calibration-probe.js.
// These are measurements, not estimates. Re-run the probe after any skribbl UI
// change; the extension has already been broken twice by site updates.

// Canvas is exactly 800x600 in its backing store. At the default window size the
// CSS box is also 800x600, but never assume it: read the bounding rect.
export const canvasSize = { width: 800, height: 600 };

// Painted stroke diameter per toolbar size element, in canvas pixels, measured by
// drawing a horizontal stroke and counting the band height.
//
// There is NO anti-aliasing: the fully-saturated width equals the painted width,
// so a capsule model with these radii is exact.
//
// Note the shipped code labels these [4, 10, 20, 32, 40] (src/toolbar.js) and the
// planner assumed an effective factor of ~0.72 (coverageRadius 14.4 for "40").
// Both are wrong: the real diameters are the labels minus one, i.e. the factor is
// ~1.0. Underestimating the big pens by ~35% is what produced the measured 3x
// overdraw, because the greedy coverage pass under-credited every wide stroke.
export const penDiameters = [3, 9, 19, 31, 39];
export const penRadii = penDiameters.map(diameter => diameter / 2);

// skribbl accepts PointerEvent only. MouseEvent (mousedown/mousemove/mouseup)
// paints nothing at all. pointermove must be dispatched on the canvas element;
// dispatching moves on window paints only the initial dab.
export const pointerEventsOnly = true;

// skribbl renders on requestAnimationFrame. A segment is only drawn when a frame
// boundary falls on BOTH sides of the pointermove. Measured over 12 long strokes:
//
//   down,move,up in one task ............ 1 of 12 segments (11 left only a dab)
//   down,move,frame,up .................. 6 of 12
//   down,frame,move,frame,up ........... 10-12 of 12   <-- the usable primitive
//   down,move,move,up ................... 1 of 12
//
// So the shipped down/move/up primitive silently loses most strokes: a bare
// pointerdown still paints a dab, which is why the loss is easy to miss and why
// the earlier "throughput" probe reported 100% retention -- it counted dabs.
//
// Holding one gesture open and moving once per frame does NOT work: over 24
// segments only 1 midpoint was painted while 12 vertices got dabs. Polyline
// batching is therefore dead in every form; the renderer must issue one
// frame-bracketed gesture per segment.
export const reliableStrokeNeedsFrameAroundMove = true;

// Even the good primitive is not deterministic: repeat runs scored 12/12 and 10/12.
// Budget for ~85-100% delivery and treat the verify/repair pass as mandatory.
export const strokeDeliveryRate = 0.85;

// Two animation frames per segment. The wall-clock cost therefore depends on the
// display refresh rate, which must be measured rather than assumed to be 60Hz:
// this machine reported 7.1ms per frame-paced step, i.e. a 144Hz panel.
//   60Hz  -> ~33ms/segment -> ~30 segments/s
//   144Hz -> ~14ms/segment -> ~70 segments/s
// An 80s round is then roughly 2,400 (60Hz) to 5,600 (144Hz) segments, which
// brackets the ~3,000 design point.
export const framesPerSegment = 2;

// Because the cost is per SEGMENT and not per command, batching segments into one
// command buys nothing, and anything that adds segments to save commands is a loss.
// Measured on promo-image: chaining coverage runs into serpentine polylines cost
// 2,528 segments (35.1s) versus 1,599 (22.2s) unchained, at identical error -- every
// lane-to-lane connector is an extra segment. Optimise segment count, not command
// count, and prefer long segments: they are cheaper per pixel covered and measured
// more reliable to deliver.
export const costIsPerSegment = true;

// Pipelining and multiple pointerIds both run at 6.9ms/segment but deliver only
// ~50%, i.e. the same ~72 segments/s as the reliable 2-frame primitive. skribbl
// retires roughly one segment per two frames however the events are shaped, so there
// is no event-level trick left; speed has to come from emitting fewer segments.
export const effectiveSegmentsPerSecond = 72;

// CRITICAL: rAF is suspended while the tab is hidden or occluded, and skribbl
// renders on rAF, so NOTHING is drawn at all. Measured: visibilityState "hidden",
// zero rAF callbacks in 2.2s, and every queued stroke stalled. The extension must
// pause on visibilitychange rather than burning its plan into a frozen canvas.
export const requiresVisibleTab = true;

// The bucket IS a contiguous flood fill, and it contains correctly.
//
// Measured with a 39px-thick circle drawn as 120 short segments, whose continuity
// was verified pixel-by-pixel before filling (720 radial samples, zero gaps):
//   inside the ring:  100% became the fill color
//   outside the ring:   0% became the fill color
//
// So the 4-connected model in src/planning/binary-rasterizer.js is the right one.
//
// Earlier probes appeared to show a global, non-contiguous color replace: a
// 4-long-segment box leaked to the far corner, and a second fill crossed a black
// barrier. Both are explained by the barrier not actually being closed -- once two
// areas are joined by a single gap they are one region, so a later fill legitimately
// covers both. Those probes did NOT verify continuity first, and one of them ran
// after the turn had ended (nothing draws at all then), so they are discarded.
//
// Outline-then-fill works, and FEWER LONGER SEGMENTS ARE STRICTLY BETTER -- both
// cheaper and more reliable, because every extra gesture is another chance to drop a
// stroke. Measured on the same box, drawn with the frame-bracketed primitive:
//
//   4 long segments ....... 0 barrier gaps, inside 100%, outside   0%  (contained)
//   ~80 short segments .... 76 barrier gaps, inside 100%, outside 100%  (leaked)
//   1 closed polyline .... 398 barrier gaps, inside 100%, outside 100%  (leaked)
//
// So the planner should simplify contours aggressively and prefer long strokes, and
// must verify boundary continuity in the simulator before committing a fill.
export const fillIsContiguousFloodFill = true;
export const fillContainmentVerified = { ringGaps: 0, insidePct: 100, outsidePct: 0 };
export const preferFewLongSegments = true;

// It is someone else's turn iff #game-wrapper carries the "toolbar-hidden" class.
// #game-toolbar keeps computed display:grid regardless, so the shipped
// toolbar.isEnabled() display check never detects the turn ending.
export const turnHiddenClass = "toolbar-hidden";
export const turnWrapperSelector = "#game-wrapper";

// The live palette has 26 swatches, not the 20 used by test/benchmark.test.js.
// Read it from the DOM at runtime; this copy is for tests and offline planning.
export const palette = [
    { r: 255, g: 255, b: 255 }, { r: 193, g: 193, b: 193 },
    { r: 239, g: 19, b: 11 }, { r: 255, g: 113, b: 0 },
    { r: 255, g: 228, b: 0 }, { r: 0, g: 204, b: 0 },
    { r: 0, g: 255, b: 145 }, { r: 0, g: 178, b: 255 },
    { r: 35, g: 31, b: 211 }, { r: 163, g: 0, b: 186 },
    { r: 223, g: 105, b: 167 }, { r: 255, g: 172, b: 142 },
    { r: 160, g: 82, b: 45 }, { r: 0, g: 0, b: 0 },
    { r: 80, g: 80, b: 80 }, { r: 116, g: 11, b: 7 },
    { r: 194, g: 56, b: 0 }, { r: 232, g: 162, b: 0 },
    { r: 0, g: 70, b: 25 }, { r: 0, g: 120, b: 93 },
    { r: 0, g: 86, b: 158 }, { r: 14, g: 8, b: 101 },
    { r: 85, g: 0, b: 105 }, { r: 135, g: 53, b: 84 },
    { r: 204, g: 119, b: 77 }, { r: 99, g: 48, b: 13 }
];

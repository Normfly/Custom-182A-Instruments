// Focused tests for knob long/short press and PFD BARO STD behavior.
// Run with: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

// Load an instrument class into a sandbox with mocked SimVar / timers / clock / DOM.
function load(file, className) {
    const env = {
        now: 1000000,
        lvars: {},
        sets: [],
        timers: new Map(),
        nextTimer: 1,
    };
    const FakeDate = class extends Date {
        static now() { return env.now; }
    };
    const ctx = {
        console, Math, JSON, Promise, Number, String, Array, Object, Map, Set, isFinite, parseFloat,
        Date: FakeDate,
        setTimeout: (fn, ms) => { const id = env.nextTimer++; env.timers.set(id, { fn, at: env.now + ms }); return id; },
        clearTimeout: (id) => { env.timers.delete(id); },
        setInterval: () => 0,
        clearInterval: () => { },
        SimVar: {
            GetSimVarValue: (name) => (name in env.lvars ? env.lvars[name] : 0),
            SetSimVarValue: (name, unit, value) => { env.sets.push([name, value]); env.lvars[name] = value; return Promise.resolve(); },
        },
        BaseInstrument: class { connectedCallback() { } },
        document: { getElementById: () => null },
        Image: class { },
        window: {},
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8") + `\n;this.__Cls = ${className};`, ctx);
    const inst = new ctx.__Cls();
    inst.updates = 0;
    inst.Update = function () { this.updates++; };
    env.advance = (ms) => {
        env.now += ms;
        for (const [id, t] of [...env.timers]) {
            if (t.at <= env.now) { env.timers.delete(id); t.fn(); }
        }
    };
    env.clearSets = () => { env.sets.length = 0; };
    return { inst, env };
}

const SYNC_VARS = [
    "L:PMS50_APGA_SELECTED_ALTITUDE", "KOHLSMAN SETTING HG", "K:HEADING_BUG_SET", "L:TRK_SEL", "L:CRS_SEL",
];
const syncWrites = (env) => env.sets.filter(([n]) => SYNC_VARS.includes(n));

// ---------------- PFD helpers ----------------
function pfd() {
    const r = load("PFD_screen.js", "PFD_screen");
    r.inst.touchSelected = 3;
    return r;
}
function pfdOpenNested(p) {
    p.optionsClick();                 // open root
    p.optionsSel = p.getCurrentOptionsList().indexOf("Options");
    p.optionsClick();                 // -> Options
    p.optionsSel = p.getCurrentOptionsList().indexOf("NAV Options");
    p.optionsClick();                 // -> NAV Options
    p.optionsWindowStart = 2;
    p.optionsEditing = true;
    p.optionsEditKey = "CRS";
}
function pfdTouch(p, id, holdMs, env) {
    const box = p.touchBoxes.find(b => b.id === id);
    const ev = { clientX: box.x + 1, clientY: box.y + 1 };
    p.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    p._processTouchStart(ev);
    env.advance(holdMs);
    p._processTouchEnd(ev);
}
function assertPfdMenuClosed(p) {
    assert.strictEqual(p.showOptions, false);
    assert.strictEqual(p.optionsLevel, 0);
    assert.strictEqual(p.optionsParent, "");
    assert.strictEqual(p.optionsSel, 1);
    assert.strictEqual(p.optionsWindowStart, 0);
    assert.strictEqual(p.optionsEditing, false);
    assert.strictEqual(p.optionsEditKey, "");
    assert.deepStrictEqual(Array.from(p.menuHistory), []);
    assert.strictEqual(p._inMiscLayout, false);
}
function drawnBaro(p) {
    let text = null;
    const ctx = { save() { }, restore() { }, fillText(t) { text = t; } };
    p.drawBaro(ctx);
    return text;
}

// ---------------- PFD: long press closes menu ----------------
for (const sel of [2, 3, 4]) {
    test(`PFD long press closes root menu without sync (touchSelected=${sel})`, () => {
        const { inst: p, env } = pfd();
        p.touchSelected = sel;
        p.optionsClick();
        env.clearSets();
        p.handleKnobLongPress();
        assertPfdMenuClosed(p);
        assert.deepStrictEqual(syncWrites(env), []);
        assert.strictEqual(p.baroStd, false);
    });
}

test("PFD long press closes nested submenu and resets history/scroll/edit/layout", () => {
    const { inst: p, env } = pfd();
    pfdOpenNested(p);
    p._enterMiscLayout();
    assert.strictEqual(p.optionsLevel, 2);
    env.clearSets();
    p.handleKnobLongPress();
    assertPfdMenuClosed(p);
    assert.deepStrictEqual(syncWrites(env), []);
});

test("PFD mouse long press on knob button closes menu and release does not reopen it", () => {
    const { inst: p, env } = pfd();
    pfdOpenNested(p);
    env.clearSets();
    pfdTouch(p, "small_knob_button", 2100, env);
    assertPfdMenuClosed(p);
    assert.deepStrictEqual(syncWrites(env), []);
    assert.strictEqual(p.knobLongPressFired, false); // reset for next press
});

test("PFD mouse short press on knob button still opens menu when non-BARO selected", () => {
    const { inst: p, env } = pfd();
    p.touchSelected = 4;
    pfdTouch(p, "small_knob_button", 200, env);
    assert.strictEqual(p.showOptions, true);
});

test("PFD hardware long+short in the same poll cycle closes menu and does not reopen", () => {
    const { inst: p, env } = pfd();
    pfdOpenNested(p);
    env.clearSets();
    env.lvars["L:PFD_KnobButtonLong"] = 1;
    env.lvars["L:PFD_KnobButtonShort"] = 1;
    p.pollPFDKnobButtons();
    assertPfdMenuClosed(p);
    assert.strictEqual(env.lvars["L:PFD_KnobButtonLong"], 0);
    assert.strictEqual(env.lvars["L:PFD_KnobButtonShort"], 0);
    assert.deepStrictEqual(syncWrites(env), []);
    // Next genuine short press works again
    p.touchSelected = 4;
    env.now += 100;
    env.lvars["L:PFD_KnobButtonShort"] = 1;
    p.pollPFDKnobButtons();
    assert.strictEqual(p.showOptions, true);
});

test("PFD hardware short arriving on a later cycle after long is swallowed once", () => {
    const { inst: p, env } = pfd();
    p.touchSelected = 4;
    p.optionsClick();
    env.lvars["L:PFD_KnobButtonLong"] = 1;
    p.pollPFDKnobButtons();
    assert.strictEqual(p.showOptions, false);
    env.now += 300;
    env.lvars["L:PFD_KnobButtonShort"] = 1; // release of the long press
    p.pollPFDKnobButtons();
    assert.strictEqual(p.showOptions, false);
    assert.strictEqual(env.lvars["L:PFD_KnobButtonShort"], 0);
    env.now += 300;
    env.lvars["L:PFD_KnobButtonShort"] = 1; // a real short press
    p.pollPFDKnobButtons();
    assert.strictEqual(p.showOptions, true);
});

test("PFD hardware short well after the suppression window is handled normally", () => {
    const { inst: p, env } = pfd();
    p.touchSelected = 4;
    env.lvars["L:PFD_KnobButtonLong"] = 1;
    p.pollPFDKnobButtons();               // menu closed -> heading sync
    env.now += p.knobShortSuppressMs + 1;
    env.lvars["L:PFD_KnobButtonShort"] = 1;
    p.pollPFDKnobButtons();
    assert.strictEqual(p.showOptions, true);
});

test("PFD long press with menu closed keeps existing sync actions", () => {
    const { inst: p, env } = pfd();
    p.touchSelected = 2; p.alt = 4521.4;
    p.handleKnobLongPress();
    assert.strictEqual(p.altitudeBug, 4521);
    p.touchSelected = 4; p.trkHold = false; p.heading = 123;
    p.handleKnobLongPress();
    assert.strictEqual(p.headingBug, 123);
    assert.ok(env.sets.some(([n, v]) => n === "K:HEADING_BUG_SET" && v === 123));
});

// ---------------- PFD: BARO STD ----------------
test("PFD BARO short press enters STD (inHg), displays STD, and exits back to previous", () => {
    const { inst: p } = pfd();
    p.baro = 30.12;
    assert.strictEqual(drawnBaro(p), "30.12 in");
    p.handleKnobShortPress();
    assert.strictEqual(p.showOptions, false);
    assert.strictEqual(p.baroStd, true);
    assert.strictEqual(p.baro, 29.92);
    assert.strictEqual(drawnBaro(p), "STD");
    p.handleKnobShortPress();
    assert.strictEqual(p.baroStd, false);
    assert.strictEqual(p.baro, 30.12);
    assert.strictEqual(drawnBaro(p), "30.12 in");
});

test("PFD BARO STD in hPa displays STD and restores numeric hPa", () => {
    const { inst: p } = pfd();
    p.baroMode = 1;
    p.baro = 1020 / 33.8639;
    assert.strictEqual(drawnBaro(p), "1020 hPa");
    p.handleKnobShortPress();
    assert.strictEqual(drawnBaro(p), "STD");
    p.handleKnobShortPress();
    assert.strictEqual(drawnBaro(p), "1020 hPa");
});

test("PFD manually selected 29.92 is not STD; STD round-trip restores 29.92 numeric", () => {
    const { inst: p } = pfd();
    p.baro = 29.92;
    assert.strictEqual(p.baroStd, false);
    assert.strictEqual(drawnBaro(p), "29.92 in");
    p.handleKnobShortPress();
    assert.strictEqual(drawnBaro(p), "STD");
    p.handleKnobShortPress();
    assert.strictEqual(p.baroStd, false);
    assert.strictEqual(drawnBaro(p), "29.92 in");
    p.baroMode = 1;
    assert.strictEqual(drawnBaro(p), "1013 hPa");
});

test("PFD manual BARO adjustment exits STD and adjusts from standard", () => {
    const { inst: p } = pfd();
    p.baro = 30.12;
    p.handleKnobShortPress();
    p.handleKnobDelta(+1, "small");
    assert.strictEqual(p.baroStd, false);
    assert.strictEqual(p.baro, 29.93);
    assert.strictEqual(drawnBaro(p), "29.93 in");
    // Next short press enters STD again, remembering the adjusted value
    p.handleKnobShortPress();
    assert.strictEqual(drawnBaro(p), "STD");
    p.handleKnobShortPress();
    assert.strictEqual(p.baro, 29.93);
});

test("PFD manual BARO adjustment in hPa exits STD and steps from 1013 hPa", () => {
    const { inst: p } = pfd();
    p.baroMode = 1;
    p.baro = 1020 / 33.8639;
    p.handleKnobShortPress();
    assert.strictEqual(drawnBaro(p), "STD");
    p.handleKnobDelta(-1, "small");
    assert.strictEqual(p.baroStd, false);
    assert.strictEqual(drawnBaro(p), "1012 hPa");
});

test("PFD long press BARO enters STD coherently, keeping remembered pressure", () => {
    const { inst: p, env } = pfd();
    p.baro = 29.75;
    p.handleKnobLongPress();
    assert.strictEqual(p.baroStd, true);
    assert.strictEqual(p.baro, 29.92);
    assert.ok(env.sets.some(([n, v]) => n === "KOHLSMAN SETTING HG" && v === 29.92));
    p.handleKnobLongPress(); // already STD: must not overwrite remembered pressure
    p.handleKnobShortPress();
    assert.strictEqual(p.baroStd, false);
    assert.strictEqual(p.baro, 29.75);
});

test("PFD short press with menu open selects menu items (BARO selected)", () => {
    const { inst: p } = pfd();
    p.handleKnobShortPress();        // BARO selected, menu closed -> STD toggle, not menu
    assert.strictEqual(p.showOptions, false);
    p.handleKnobShortPress();        // back out of STD
    p.touchSelected = 4;
    p.handleKnobShortPress();        // opens menu
    assert.strictEqual(p.showOptions, true);
    p.touchSelected = 3;
    p.optionsSel = p.getCurrentOptionsList().indexOf("Options");
    p.handleKnobShortPress();        // menu open -> enters submenu, no STD
    assert.strictEqual(p.optionsParent, "Options");
    assert.strictEqual(p.baroStd, false);
});

test("PFD non-BARO short press with menu closed still opens menu", () => {
    for (const sel of [1, 2, 4]) {
        const { inst: p } = pfd();
        p.touchSelected = sel;
        p.handleKnobShortPress();
        assert.strictEqual(p.showOptions, true);
        assert.strictEqual(p.baroStd, false);
    }
});

// ---------------- MFD ----------------
function mfd() {
    const r = load("MFD_screen.js", "MFD_screen");
    r.inst.activeBox = "trk";
    r.inst.trkHold = 0;
    r.inst.heading = 200;
    return r;
}
function mfdOpenNested(m) {
    m.OptionsClick();
    m.optionsSelIndex = m.getCurrentOptionsList().indexOf("Misc. Field");
    m.OptionsClick();
    m.optionsSelIndex = m.getCurrentOptionsList().indexOf("Wind Settings");
    m.OptionsClick();
    m.optionsScroll = 1;
}
function assertMfdMenuClosed(m) {
    assert.strictEqual(m.showOptions, false);
    assert.strictEqual(m.optionsLevel, 0);
    assert.strictEqual(m.optionsParent, "");
    assert.strictEqual(m.optionsScroll, 0);
    assert.strictEqual(m.optionsSelIndex, 1);
    assert.deepStrictEqual(Array.from(m.menuHistory), []);
}

test("MFD long press closes root and nested menus without sync", () => {
    for (const nested of [false, true]) {
        const { inst: m, env } = mfd();
        if (nested) { mfdOpenNested(m); assert.strictEqual(m.optionsParent, "Wind Settings"); }
        else m.OptionsClick();
        env.clearSets();
        m.handleKnobSyncRaw();
        assertMfdMenuClosed(m);
        assert.deepStrictEqual(syncWrites(env), []);
    }
});

test("MFD hardware long+short same cycle closes menu and does not reopen", () => {
    const { inst: m, env } = mfd();
    mfdOpenNested(m);
    env.clearSets();
    env.lvars["L:MFD_KnobButtonLong"] = 1;
    env.lvars["L:MFD_KnobButtonShort"] = 1;
    m.pollMFDKnobButton();
    assertMfdMenuClosed(m);
    assert.deepStrictEqual(syncWrites(env), []);
    assert.strictEqual(env.lvars["L:MFD_KnobButtonShort"], 0);
});

test("MFD hardware short on later cycle after long is swallowed once, then works", () => {
    const { inst: m, env } = mfd();
    m.OptionsClick();
    env.lvars["L:MFD_KnobButtonLong"] = 1;
    m.pollMFDKnobButton();
    env.now += 400;
    env.lvars["L:MFD_KnobButtonShort"] = 1;
    m.pollMFDKnobButton();
    assert.strictEqual(m.showOptions, false);
    env.now += 400;
    env.lvars["L:MFD_KnobButtonShort"] = 1;
    m.pollMFDKnobButton();
    assert.strictEqual(m.showOptions, true);
});

test("MFD mouse long press on knob button closes menu; release does not reopen", () => {
    const { inst: m, env } = mfd();
    mfdOpenNested(m);
    env.clearSets();
    const box = m.touchBoxes.find(b => b.id === "small_knob_button");
    m.canvas = { width: 1, height: 1, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) };
    m.TRKbox_timer = { start() { } };
    const ev = { clientX: box.x + 1, clientY: box.y + 1 };
    m._touchStart(ev);
    env.advance(2100);
    m._touchEnd(ev);
    assertMfdMenuClosed(m);
    assert.deepStrictEqual(syncWrites(env), []);
});

test("MFD long press with menu closed still syncs heading", () => {
    const { inst: m, env } = mfd();
    m.handleKnobSyncRaw();
    assert.ok(env.sets.some(([n, v]) => n === "K:HEADING_BUG_SET" && v === 200));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { standings, defaultWeek } from "../js/scoring.js";
import { OWNERS, league } from "./helpers.js";

const baseline = { through_week: 8, totals: { JD: 572, Galli: -458, Art: 134, Mxue: -218, Vince: -530, JohnO: 592, Kevin: -92 } };
const wk9 = { Art: -6000, Mxue: 44800, Vince: -19600, Kevin: -4200, Galli: 10600, JD: -7200, JohnO: -18400 };
const settle = (totals) => Object.fromEntries(OWNERS.map((o) => [o, { lightning: 0, teamPot: 0, total: totals[o] }]));
const after9 = { Art: 7400, Mxue: 23000, Vince: -72600, Kevin: -13400, Galli: -35200, JD: 50000, JohnO: 40800 };

test("standings add a recorded week to the baseline", () => {
  const s = standings(baseline, [{ week: 9, recorded: true, final: true, settlement: settle(wk9) }], league);
  assert.equal(s.recordedThrough, 9);
  assert.deepEqual(s.base, after9);
  assert.deepEqual(s.open, []);
  assert.deepEqual(s.totals, after9);
  assert.deepEqual(s.order, { Vince: 1, Galli: 2, Kevin: 3, Art: 4, Mxue: 5, JohnO: 6, JD: 7 });
});

test("standings show an unrecorded week as an open, provisional column", () => {
  const s = standings(baseline, [{ week: 9, recorded: false, final: false, settlement: settle(wk9) }], league);
  assert.equal(s.recordedThrough, 8);
  assert.deepEqual(s.base, { Art: 13400, Mxue: -21800, Vince: -53000, Kevin: -9200, Galli: -45800, JD: 57200, JohnO: 59200 });
  assert.deepEqual(s.open, [{ week: 9, provisional: true, amounts: wk9 }]);
  assert.deepEqual(s.totals, after9);
});

test("an unrecorded week that is final is open but not provisional", () => {
  const s = standings(baseline, [{ week: 9, recorded: false, final: true, settlement: settle(wk9) }], league);
  assert.equal(s.open[0].provisional, false);
});

test("a week that could not be loaded is open with no amounts and adds nothing", () => {
  const s = standings(
    baseline,
    [
      { week: 9, recorded: true, final: true, settlement: settle(wk9) },
      { week: 10, recorded: false, final: false, settlement: null },
    ],
    league,
  );
  assert.deepEqual(s.open, [{ week: 10, provisional: true, amounts: null }]);
  assert.deepEqual(s.totals, after9);
  assert.equal(s.recordedThrough, 9);
});

test("order breaks ties by league owner order", () => {
  const flat = { through_week: 8, totals: Object.fromEntries(OWNERS.map((o) => [o, 0])) };
  const s = standings(flat, [], league);
  assert.deepEqual(s.order, { Art: 1, Mxue: 2, Vince: 3, Kevin: 4, Galli: 5, JD: 6, JohnO: 7 });
});

test("defaultWeek picks the earliest unrecorded week that has started, else the last week", () => {
  assert.equal(defaultWeek([{ week: 9, recorded: true, started: true }, { week: 10, recorded: false, started: false }]), 10);
  assert.equal(defaultWeek([{ week: 9, recorded: false, started: true }, { week: 10, recorded: false, started: false }]), 9);
  assert.equal(defaultWeek([{ week: 9, recorded: true, started: true }, { week: 10, recorded: false, started: true }]), 10);
  assert.equal(defaultWeek([{ week: 9, recorded: true, started: true }]), 9);
});

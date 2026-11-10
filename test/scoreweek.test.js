import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreWeek, validateWeekFile } from "../js/scoring.js";
import { OWNERS, league, build, column } from "./helpers.js";

const sumTotals = (r) => OWNERS.reduce((a, o) => a + r.settlement[o].total, 0);
const allStates = (state, prefix) => {
  const s = {};
  for (const o of OWNERS) for (let i = 0; i < 7; i++) s[`${prefix}-${o}-${i}`] = state;
  return s;
};

test("lightning column: two tied winners split what the others pay", () => {
  const pts = { Art: 17, Mxue: 21, Vince: 17, Kevin: 36, Galli: 6, JD: 36, JohnO: 19 }; // Week 9 QB3
  const { weekFile, playersById } = build({}, column(2, pts));
  const r = scoreWeek(weekFile, playersById, league);
  const col = r.lightning.columns[2];
  assert.equal(col.name, "QB3");
  assert.deepEqual(col.winners, ["Kevin", "JD"]);
  assert.deepEqual(col.money, { Art: -3800, Mxue: -3000, Vince: -3800, Kevin: 10000, Galli: -6000, JD: 10000, JohnO: -3400 });
  assert.equal(col.cells.Kevin.points, 36);
  assert.equal(sumTotals(r), 0);
});

test("lightning column: three tied winners, leftover cent goes in owner order", () => {
  const pts = { Art: 10, Mxue: 10, Vince: 10, Kevin: 9, Galli: 9, JD: 9, JohnO: 5 };
  const { weekFile, playersById } = build({}, column(0, pts));
  const r = scoreWeek(weekFile, playersById, league);
  assert.deepEqual(r.lightning.columns[0].money, { Art: 534, Mxue: 533, Vince: 533, Kevin: -200, Galli: -200, JD: -200, JohnO: -1000 });
  assert.equal(sumTotals(r), 0);
});

test("lightning net adds the columns per owner", () => {
  const a = column(0, { Art: 10, Mxue: 0, Vince: 0, Kevin: 0, Galli: 0, JD: 0, JohnO: 0 });
  const b = column(1, { Art: 0, Mxue: 5, Vince: 0, Kevin: 0, Galli: 0, JD: 0, JohnO: 0 });
  const both = {};
  for (const o of OWNERS) both[o] = a[o].map((v, i) => v + b[o][i]);
  const { weekFile, playersById } = build({}, both);
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.lightning.net.Art, 6 * 2000 - 1000);
  assert.equal(r.lightning.net.Mxue, -2000 + 6 * 1000);
  assert.equal(r.lightning.net.Vince, -3000);
  assert.equal(r.settlement.Vince.lightning, -3000);
});

test("team pot: single winner takes $140", () => {
  const { weekFile, playersById } = build({ Galli: [15, 32, 20, 23, 25], Vince: [27, 13, 20, 21, 25] }, {});
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.team.rows.Galli.total, 115);
  assert.equal(r.team.rows.Galli.players.length, 5);
  assert.deepEqual(r.team.winners, ["Galli"]);
  assert.deepEqual(r.team.money, { Art: -2000, Mxue: -2000, Vince: -2000, Kevin: -2000, Galli: 12000, JD: -2000, JohnO: -2000 });
  assert.equal(r.settlement.Galli.teamPot, 12000);
  assert.equal(r.settlement.Galli.total, 12000);
  assert.equal(sumTotals(r), 0);
});

test("team pot: three-way tie splits with leftover cents in owner order", () => {
  const t = [20, 20, 20, 20, 26];
  const { weekFile, playersById } = build({ Vince: t, Galli: t, JohnO: t }, {});
  const r = scoreWeek(weekFile, playersById, league);
  assert.deepEqual(r.team.winners, ["Vince", "Galli", "JohnO"]);
  assert.deepEqual(r.team.money, { Art: -2000, Mxue: -2000, Vince: 2667, Kevin: -2000, Galli: 2667, JD: -2000, JohnO: 2666 });
  assert.equal(sumTotals(r), 0);
});

test("a live player makes only its own column and the week provisional", () => {
  const { weekFile, playersById } = build({}, column(3, { Art: 5, Mxue: 1, Vince: 1, Kevin: 1, Galli: 1, JD: 1, JohnO: 1 }), { "L-Mxue-3": "live" });
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.final, false);
  assert.equal(r.lightning.columns[3].provisional, true);
  assert.equal(r.lightning.columns[3].started, true);
  assert.deepEqual(r.lightning.columns[3].winners, ["Art"]);
  assert.equal(r.lightning.columns[2].provisional, false);
  assert.equal(r.team.provisional, false);
});

test("bye and did-not-play players do not block final", () => {
  const { weekFile, playersById } = build({}, {}, { "L-Art-0": "bye", "T-JD-1": "dnp" });
  assert.equal(scoreWeek(weekFile, playersById, league).final, true);
});

test("unknown players block final; a missing id counts as unknown with 0", () => {
  const { weekFile, playersById } = build({ Art: [9, 9, 9, 9, 9] }, {});
  delete playersById["T-Art-0"];
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.final, false);
  assert.equal(r.team.provisional, true);
  assert.deepEqual(r.team.rows.Art.players[0], { name: "Art T0", id: "T-Art-0", points: 0, state: "unknown" });
  assert.equal(r.team.rows.Art.total, 36);
});

test("nothing started: no winners and no money", () => {
  const { weekFile, playersById } = build({}, {}, { ...allStates("not_started", "T"), ...allStates("not_started", "L") });
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.final, false);
  assert.equal(r.team.started, false);
  assert.deepEqual(r.team.winners, []);
  assert.equal(r.lightning.columns[0].started, false);
  assert.deepEqual(r.lightning.columns[0].winners, []);
  for (const o of OWNERS) assert.deepEqual(r.settlement[o], { lightning: 0, teamPot: 0, total: 0 });
});

test("validateWeekFile names the week when a roster has the wrong length", () => {
  const { weekFile, playersById } = build();
  weekFile.team_table.rosters.Art.pop();
  assert.throws(() => validateWeekFile(weekFile, league), /2026-9.*Art/);
  assert.throws(() => scoreWeek(weekFile, playersById, league), /2026-9/);
});

test("validateWeekFile names the week when an owner is missing", () => {
  const { weekFile } = build();
  delete weekFile.lightning_table.rosters.JD;
  assert.throws(() => validateWeekFile(weekFile, league), /2026-9.*JD/);
});

// --- added after Task 2 review ---

test("mixed column: one final player, the rest not started", () => {
  const states = {};
  for (const o of OWNERS) if (o !== "Art") states[`L-${o}-1`] = "not_started";
  const { weekFile, playersById } = build({}, column(1, { Art: 5, Mxue: 0, Vince: 0, Kevin: 0, Galli: 0, JD: 0, JohnO: 0 }), states);
  const col = scoreWeek(weekFile, playersById, league).lightning.columns[1];
  assert.equal(col.started, true);
  assert.equal(col.provisional, true);
  assert.deepEqual(col.winners, ["Art"]);
  assert.deepEqual(col.money, { Art: 6000, Mxue: -1000, Vince: -1000, Kevin: -1000, Galli: -1000, JD: -1000, JohnO: -1000 });
});

test("started needs a game under way: bye and unknown players do not start a table", () => {
  const states = { ...allStates("not_started", "T"), ...allStates("not_started", "L"), "T-Art-0": "bye", "T-JD-3": "unknown", "L-Art-0": "bye" };
  const { weekFile, playersById } = build({}, {}, states);
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.team.started, false);
  assert.deepEqual(r.team.winners, []);
  assert.equal(r.lightning.columns[0].started, false);
  assert.deepEqual(r.lightning.columns[0].winners, []);
});

test("nothing started: no money even when points are on the board", () => {
  const states = { ...allStates("not_started", "T"), ...allStates("not_started", "L") };
  const { weekFile, playersById } = build({ Art: [9, 9, 9, 9, 9] }, column(0, { Art: 7, Mxue: 0, Vince: 0, Kevin: 0, Galli: 0, JD: 0, JohnO: 0 }), states);
  const r = scoreWeek(weekFile, playersById, league);
  for (const o of OWNERS) {
    assert.equal(r.team.money[o], 0);
    assert.equal(r.lightning.columns[0].money[o], 0);
  }
});

test("a blocking player in any team slot makes the team table provisional", () => {
  const { weekFile, playersById } = build({}, {}, { "T-Kevin-4": "live" });
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.team.provisional, true);
  assert.equal(r.team.started, true);
  assert.equal(r.final, false);
});

test("a column that has not started keeps the week from being final", () => {
  const states = {};
  for (const o of OWNERS) states[`L-${o}-6`] = "not_started";
  const { weekFile, playersById } = build({}, {}, states);
  assert.equal(scoreWeek(weekFile, playersById, league).final, false);
});

test("team pot: two-way tie; seven-way tie pays nobody", () => {
  const t = [20, 20, 20, 20, 20];
  let { weekFile, playersById } = build({ Mxue: t, JD: t }, {});
  assert.deepEqual(scoreWeek(weekFile, playersById, league).team.money, { Art: -2000, Mxue: 5000, Vince: -2000, Kevin: -2000, Galli: -2000, JD: 5000, JohnO: -2000 });
  ({ weekFile, playersById } = build({}, {}));
  const r = scoreWeek(weekFile, playersById, league);
  assert.deepEqual(r.team.winners, OWNERS);
  for (const o of OWNERS) assert.equal(r.team.money[o], 0);
});

test("result has exactly the documented shape", () => {
  const { weekFile, playersById } = build();
  const r = scoreWeek(weekFile, playersById, league);
  assert.deepEqual(Object.keys(r).sort(), ["final", "lightning", "settlement", "team"]);
  assert.deepEqual(Object.keys(r.team).sort(), ["money", "provisional", "rows", "started", "winners"]);
  assert.deepEqual(Object.keys(r.lightning).sort(), ["columns", "net"]);
  assert.equal(r.lightning.columns.length, 7);
  assert.deepEqual(Object.keys(r.lightning.columns[0]).sort(), ["cells", "money", "name", "provisional", "started", "winners"]);
});

for (const t of ["team_table", "lightning_table"]) {
  test(`validateWeekFile checks ${t}: short, long, missing and extra owners, bad entries`, () => {
    const bad = (mutate, pattern) => {
      const { weekFile } = build();
      mutate(weekFile[t].rosters);
      assert.throws(() => validateWeekFile(weekFile, league), pattern);
    };
    bad((r) => r.Vince.pop(), /2026-9.*Vince/);
    bad((r) => r.Vince.push({ name: "X", id: "x", team: "AAA" }), /2026-9.*Vince/);
    bad((r) => delete r.Kevin, /2026-9.*Kevin/);
    bad((r) => (r.Mike = r.Galli), /2026-9.*Mike/);
    bad((r) => (r.Art[0] = "Josh Allen"), /2026-9.*Art/);
    bad((r) => (r.Art[1] = null), /2026-9.*Art/);
    bad((r) => (r.Art[2] = { name: "No Id", team: "AAA" }), /2026-9.*Art/);
  });
}

test("scoreWeek names the week and player when points are not an integer", () => {
  const { weekFile, playersById } = build();
  playersById["T-Art-0"] = { points: "9", state: "final" };
  assert.throws(() => scoreWeek(weekFile, playersById, league), /2026-9.*Art T0/);
  playersById["T-Art-0"] = { state: "final" };
  assert.throws(() => scoreWeek(weekFile, playersById, league), /2026-9.*Art T0/);
});

test("validateWeekFile rejects one player id listed with two different teams or names", () => {
  const { weekFile } = build();
  weekFile.lightning_table.rosters.Mxue[0] = { ...weekFile.team_table.rosters.Art[0], team: "ZZZ" };
  assert.throws(() => validateWeekFile(weekFile, league), /2026-9.*Art T0/);
  const ok = build().weekFile;
  ok.lightning_table.rosters.Mxue[0] = { ...ok.team_table.rosters.Art[0] };
  assert.doesNotThrow(() => validateWeekFile(ok, league));
});

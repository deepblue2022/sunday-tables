import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDraft, recordWeek, zeros, teamMismatches, formatWeek } from "../cli/lib.mjs";
import { scoreWeek, standings } from "../js/scoring.js";
import { OWNERS, TEAM_COLS, LIGHT_COLS, league, build } from "./helpers.js";

const roster = [
  { id: "1", name: "Justin Jefferson", team: "MIN", pos: "WR" },
  { id: "2", name: "Justin Jefferson", team: "CLE", pos: "LB" },
  { id: "3", name: "DeVonta Smith", team: "PHI", pos: "WR" },
  { id: "4", name: "Josh Allen", team: "BUF", pos: "QB" },
  { id: "5", name: "Josh Allen", team: "XYZ", pos: "QB" },
  { id: "6", name: "George Kittle", team: "SF", pos: "TE" },
  { id: "7", name: "Kyle Juszczyk", team: "SF", pos: "FB" },
  { id: "8", name: "Derrick Henry", team: "BAL", pos: "RB" },
];
// A draft where every slot is DeVonta Smith except what the test overrides.
const draft = (overrides = {}) => {
  const table = (cols, key) => ({
    columns: cols,
    rosters: Object.fromEntries(OWNERS.map((o) => [o, cols.map((_, i) => overrides[`${key}.${o}.${i}`] ?? "DeVonta Smith")])),
  });
  return { season: 2026, week: 10, team_table: table(TEAM_COLS, "team"), lightning_table: table(LIGHT_COLS, "light") };
};

test("resolveDraft writes name, id and team, ignoring defenders with the same name", () => {
  const w = resolveDraft(draft({ "team.Art.0": "Justin Jefferson", "light.JD.4": "George Kittle", "light.JD.6": "Kyle Juszczyk" }), roster);
  assert.deepEqual(w.team_table.rosters.Art[0], { name: "Justin Jefferson", id: "1", team: "MIN" });
  assert.deepEqual(w.lightning_table.rosters.JD[4], { name: "George Kittle", id: "6", team: "SF" });
  assert.deepEqual(w.lightning_table.rosters.JD[6], { name: "Kyle Juszczyk", id: "7", team: "SF" });
  assert.deepEqual(w.team_table.rosters.Mxue[1], { name: "DeVonta Smith", id: "3", team: "PHI" });
  assert.equal(w.season, 2026);
  assert.equal(w.week, 10);
  assert.deepEqual(w.team_table.columns, TEAM_COLS);
  assert.equal(w.recorded, undefined);
});

test("resolveDraft fails on a real duplicate and lists the candidates; a team settles it", () => {
  assert.throws(() => resolveDraft(draft({ "team.Art.0": "Josh Allen" }), roster), /Josh Allen.*BUF.*XYZ/s);
  const w = resolveDraft(draft({ "team.Art.0": { name: "Josh Allen", team: "BUF" } }), roster);
  assert.deepEqual(w.team_table.rosters.Art[0], { name: "Josh Allen", id: "4", team: "BUF" });
});

test("resolveDraft never guesses: unknown names fail, and every failure is reported at once", () => {
  assert.throws(() => resolveDraft(draft({ "team.Art.0": "Jon Nobody" }), roster), /Jon Nobody/);
  assert.throws(() => resolveDraft(draft({ "team.Art.0": "Allen" }), roster), /Allen/);
  try {
    resolveDraft(draft({ "team.Art.0": "Jon Nobody", "light.Kevin.2": "Josh Allen" }), roster);
    assert.fail("should have thrown");
  } catch (err) {
    assert.match(err.message, /Jon Nobody/);
    assert.match(err.message, /Josh Allen/);
    assert.match(err.message, /Art/);
    assert.match(err.message, /Kevin/);
  }
});

test("recordWeek freezes every rostered player's points and state", () => {
  const { weekFile, playersById } = build({ Art: [9, 0, 0, 0, 0] }, {}, { "T-JD-1": "dnp" });
  const out = recordWeek(weekFile, playersById, scoreWeek(weekFile, playersById, league), {});
  assert.equal(Object.keys(out.recorded.players).length, 84);
  assert.deepEqual(out.recorded.players["T-Art-0"], { points: 9, state: "final" });
  assert.deepEqual(out.recorded.players["T-JD-1"], { points: 0, state: "dnp" });
  assert.equal(weekFile.recorded, undefined); // input not mutated
  // scoring the recorded file gives the same settlement
  assert.deepEqual(scoreWeek(out, out.recorded.players, league).settlement, scoreWeek(weekFile, playersById, league).settlement);
});

test("recordWeek refuses an already-recorded week and a week that is not final", () => {
  const { weekFile, playersById } = build();
  const result = scoreWeek(weekFile, playersById, league);
  assert.throws(() => recordWeek({ ...weekFile, recorded: { players: {} } }, playersById, result, {}), /already recorded/);
  const live = build({}, {}, { "L-Art-0": "live" });
  assert.throws(() => recordWeek(live.weekFile, live.playersById, scoreWeek(live.weekFile, live.playersById, league), {}), /not final/);
});

test("recordWeek refuses a zero for a player whose team has changed, but not a player who played", () => {
  const { weekFile, playersById } = build({}, {}, { "T-JD-1": "dnp" });
  const result = scoreWeek(weekFile, playersById, league);
  assert.throws(() => recordWeek(weekFile, playersById, result, { "T-JD-1": "ZZZ" }), /JD T1.*AAA.*ZZZ/s);
  // T-Art-0 has a final stat line for AAA, so a later move to ZZZ does not matter
  assert.doesNotThrow(() => recordWeek(weekFile, playersById, result, { "T-Art-0": "ZZZ" }));
});

test("teamMismatches lists rostered players whose current team differs", () => {
  const { weekFile } = build();
  assert.deepEqual(teamMismatches(weekFile, { "T-Art-0": "ZZZ", "T-Art-1": "AAA" }), [{ name: "Art T0", id: "T-Art-0", team: "AAA", current: "ZZZ" }]);
});

test("zeros lists only did-not-play and bye players, once each", () => {
  const { weekFile, playersById } = build({}, {}, { "T-JD-1": "dnp", "L-Art-0": "bye" });
  assert.deepEqual(zeros(weekFile, playersById), [
    { name: "JD T1", team: "AAA", state: "dnp" },
    { name: "Art L0", team: "AAA", state: "bye" },
  ]);
});

test("formatWeek prints both tables, the settlement and the standings", () => {
  const { weekFile, playersById } = build({ Galli: [15, 32, 20, 23, 25] }, {}, { "L-Mxue-3": "live" });
  const result = scoreWeek(weekFile, playersById, league);
  const flat = { through_week: 8, totals: Object.fromEntries(OWNERS.map((o) => [o, 0])) };
  const s = standings(flat, [{ week: 9, recorded: false, final: result.final, settlement: result.settlement }], league);
  const text = formatWeek(result, s, league);
  assert.match(text, /Team table/);
  assert.match(text, /Galli.*115/);
  assert.match(text, /Lightning table/);
  assert.match(text, /QB4.*provisional/);
  assert.match(text, /LIVE/);
  assert.match(text, /Settlement/);
  assert.match(text, /Team pot.*\+\$120/);
  assert.match(text, /RB2\s+all tied/);
  assert.match(text, /Standings/);
  assert.match(text, /Wk 9.*provisional/);
});

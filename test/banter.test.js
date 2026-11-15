// Banter: lines written from the week's live scores, and the pool the banner rotates through.
// Each situation has several wordings, so the tests look for the facts (owner, column, numbers)
// rather than one exact sentence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveBanter, banterPool } from "../js/banter.js";
import { scoreWeek } from "../js/scoring.js";
import { build, column, league, OWNERS } from "./helpers.js";

// standings stub: totals now, and base = before this week (both in cents)
const standings = (totals, base = null) => {
  const zero = Object.fromEntries(OWNERS.map((o) => [o, 0]));
  return { totals: { ...zero, ...totals }, ...(base ? { base: { ...zero, ...base } } : {}) };
};
const run = ({ team = {}, light = {}, states = {}, st = null, extra = {}, edit = null }) => {
  const { weekFile, playersById } = build(team, light, states);
  if (edit) edit(weekFile, playersById);
  return liveBanter({ result: scoreWeek(weekFile, playersById, league), standings: st, league, weekFile, extra });
};
// some line contains every one of these strings
const about = (list, ...parts) =>
  assert.ok(list.some((l) => parts.every((p) => l.includes(p))), `no line has ${JSON.stringify(parts)}:\n  ${list.join("\n  ")}`);
const notAbout = (list, ...parts) => assert.ok(!list.some((l) => parts.every((p) => l.includes(p))), `unexpected line with ${JSON.stringify(parts)}`);

// every player not started, except lightning column `i`, whose players get `byOwner` states (default final)
const onlyColumn = (i, byOwner = {}) => {
  const states = {};
  for (const o of OWNERS) {
    for (let c = 0; c < 7; c++) states[`L-${o}-${c}`] = c === i ? byOwner[o] ?? "final" : "not_started";
    for (let c = 0; c < 5; c++) states[`T-${o}-${c}`] = "not_started";
  }
  return states;
};
const nothingStarted = onlyColumn(-1);

test("before kickoff: one line, naming whoever is last or first", () => {
  const l = run({ states: nothingStarted, st: standings({ Vince: -72600, JD: 50000 }) });
  assert.equal(l.length, 1);
  assert.ok(/Vince|JD/.test(l[0]), l[0]);
});

test("a column leader gets one line: a big game, else a runaway, else a big pot", () => {
  const big = run({ light: column(2, { Kevin: 30, JD: 12 }), states: onlyColumn(2) });
  about(big, "30", "Kevin");
  assert.ok(!big.some((l) => /worth \$|collecting \$|leads QB3 by|to lose/.test(l)), "only the big-game line for QB3");
  const runaway = run({ light: column(2, { Kevin: 20, JD: 8 }), states: onlyColumn(2) });
  about(runaway, "Kevin", "QB3");
  const pot = run({ light: column(2, { Kevin: 24, JD: 15 }), states: onlyColumn(2) }); // margin 9, takes $258
  about(pot, "$258", "Kevin", "QB3");
});

test("a tie at the top names both owners", () => {
  const l = run({ light: column(2, { Kevin: 36, JD: 36, Art: 17 }), states: onlyColumn(2) });
  about(l, "Kevin", "JD", "36", "QB3");
});

test("zeros: finished 0s and DNPs in either table get a line; a 0 still to play does not; two zeros get a pile-on", () => {
  const states = onlyColumn(0, { Vince: "dnp", Kevin: "not_started" });
  states["T-Mxue-1"] = "final"; // a finished 0 in the Team table too
  const l = run({ light: column(0, { Art: 5 }), states });
  // players are named "<owner> L0" etc.; lines use the last word ("L0")
  about(l, "L0", "Mxue");
  about(l, "L0", "Vince");
  about(l, "T1", "Mxue");
  assert.ok(!l.some((x) => /Kevin's L0: |gave Kevin a clean 0|Kevin started L0|L0 put up a 0 for Kevin/.test(x)), "Kevin's player has not played");
  about(l, "2", "Mxue", "zero"); // two zeros for Mxue
});

test("a close race still being played, and an owner still alive", () => {
  const l = run({ light: column(4, { Galli: 14, JohnO: 13, Art: 6 }), states: onlyColumn(4, { Galli: "live", JohnO: "live", Art: "not_started" }) });
  about(l, "WR2", "14", "13"); // close race
  about(l, "Art", "WR2", "8"); // Art 8 back, player still to play
});

test("one owner leading three or more columns", () => {
  const light = { JD: [9, 9, 9, 0, 0, 0, 0] };
  const states = {};
  for (const o of OWNERS) for (let c = 0; c < 7; c++) states[`L-${o}-${c}`] = c < 3 ? "final" : "not_started";
  const l = run({ light, states });
  about(l, "JD", "3", "RB2");
});

test("a column still at 0 after games started", () => {
  const l = run({ states: onlyColumn(5, { Art: "live" }) });
  about(l, "WR3", "0");
});

test("identical Team tables, the Team leader and a close Team race while games are on", () => {
  const states = {};
  for (const o of OWNERS) for (let c = 0; c < 5; c++) states[`T-${o}-${c}`] = c === 4 ? "live" : "final";
  const l = run({
    team: { Art: [10, 10, 10, 10, 10], JD: [10, 10, 10, 10, 7] },
    states,
    edit: (w) => {
      w.team_table.rosters.Mxue = w.team_table.rosters.Galli; // same five players
    },
  });
  about(l, "Galli", "Mxue"); // same Team table
  about(l, "Art", "JD"); // leader, and a close race: 50 vs 47
  assert.ok(!l.some((x) => /bottom of the Team table|finished on/.test(x)), "no bottom line while their games are on");
});

test("when the Team table is done: the winner takes the pot, and the bottom gets a line", () => {
  const l = run({ team: { Art: [10, 10, 10, 10, 10], JD: [10, 10, 10, 10, 7], Kevin: [9, 9, 9, 9, 9], Mxue: [8, 8, 8, 8, 8], Galli: [9, 9, 9, 9, 8], JohnO: [9, 9, 9, 8, 8], Vince: [5, 5, 5, 5, 5] } });
  about(l, "Art", "50");
  about(l, "Vince", "25");
});

test("the week's money and the standings, with places changing hands", () => {
  const st = standings({ Vince: -60000, Kevin: -70000, Mxue: 60000 }, { Vince: -72600, Kevin: -13400, JD: 50000, Mxue: 23000 });
  const l = run({ team: { Art: [10, 10, 10, 10, 10] }, light: column(1, { Mxue: 30 }), st, extra: { onLast: { Kevin: ["Welcome."] } } });
  about(l, "Mxue", "this week"); // biggest winner
  about(l, "Kevin is last in the live standings at −$700. Welcome.");
  about(l, "Mxue", "+$600");
  about(l, "Mxue", "JD"); // passes JD for first
  about(l, "Vince", "Kevin"); // Vince out of last, Kevin in
});

test("piling-up situations are capped: at most 6 zero lines and 1 all-zero column line", () => {
  // everything finished on 0: every box is a zero, every column is level on 0
  const l = run({});
  const zeros = l.filter((x) => /DNP|0 points|clean 0|got exactly what they paid for|put up a 0/.test(x));
  assert.equal(zeros.length, 6);
  assert.equal(l.filter((x) => /nobody has a point|0 across the board/.test(x)).length, 1);
});

test("lines are stable from one refresh to the next and never repeat", () => {
  const args = { light: column(2, { Kevin: 30 }), states: onlyColumn(2) };
  assert.deepEqual(run(args), run(args));
  const l = run(args);
  assert.equal(new Set(l).size, l.length);
});

test("wording stays neutral about the owners", () => {
  const src = readFileSync(new URL("../js/banter.js", import.meta.url), "utf8");
  const strings = src.match(/`[^`]*`/g).join(" ");
  assert.doesNotMatch(strings, /\b(he|him|his|she|her|hers)\b/i);
  const b = JSON.parse(readFileSync(new URL("../data/banter.json", import.meta.url), "utf8"));
  assert.doesNotMatch(JSON.stringify(b), /\b(he|him|his|she|her|hers)\b/i);
});

test("banterPool: live lines take turns with the written batch while a week is unrecorded; only written lines for a recorded week", () => {
  const { weekFile, playersById } = build({}, column(2, { Kevin: 30 }), onlyColumn(2));
  const result = scoreWeek(weekFile, playersById, league);
  const banter = { batch: "b", lines: ["written one", "", 7, "written two"] };
  const live = banterPool({ week: { recorded: false, started: true }, result, standings: null, league, weekFile, banter });
  assert.ok(live.length > 2);
  assert.deepEqual(live[1], { text: "written one", live: false });
  assert.deepEqual(live[3], { text: "written two", live: false });
  assert.equal(live[0].live, true);
  assert.equal(live[2].live, true);
  assert.deepEqual(banterPool({ week: { recorded: true, started: true }, result, standings: null, league, weekFile, banter }), [
    { text: "written one", live: false },
    { text: "written two", live: false },
  ]);
  assert.deepEqual(banterPool({ week: null, result: null, standings: null, league, weekFile, banter: null }), []);
});

test("the real banter file is well formed", () => {
  const b = JSON.parse(readFileSync(new URL("../data/banter.json", import.meta.url), "utf8"));
  assert.ok(typeof b.batch === "string" && b.batch);
  assert.ok(Array.isArray(b.lines) && b.lines.length >= 20);
  assert.ok(b.lines.every((l) => typeof l === "string" && l.length <= 200));
  assert.equal(new Set(b.lines).size, b.lines.length);
  for (const [owner, quips] of Object.entries(b.on_last ?? {})) {
    assert.ok(league.owners.some((o) => o.key === owner), owner);
    assert.ok(quips.every((q) => typeof q === "string"));
  }
});

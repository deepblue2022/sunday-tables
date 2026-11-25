// Banter: lines written from the week's live scores, and the pool the banner rotates through.
// Each situation has several wordings, so the tests look for the facts (owner, column, numbers)
// rather than one exact sentence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveBanter, banterPool, banterIfOn, tickerCommentary, banterStale } from "../js/banter.js";
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

test("the leader gets a restaurant line from on_first; nothing when the leader has none", () => {
  const st = standings({ Vince: -60000, Mxue: 60000 }, { Vince: -72600, Mxue: 23000 });
  const args = { team: { Art: [10, 10, 10, 10, 10] }, light: column(1, { Kevin: 30 }), st };
  const l = run({ ...args, extra: { onFirst: { Mxue: ["Mxue picks the restaurant."] } } });
  assert.ok(l.includes("Mxue picks the restaurant."));
  assert.ok(!run({ ...args, extra: { onFirst: { Art: ["Art picks."] } } }).includes("Art picks."));
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
  for (const map of [b.on_last, b.on_first]) {
    for (const [owner, quips] of Object.entries(map ?? {})) {
      assert.ok(league.owners.some((o) => o.key === owner), owner);
      assert.ok(quips.every((q) => typeof q === "string" && q.length <= 200));
    }
  }
  // the season ends with lunch, never dinner
  assert.doesNotMatch(JSON.stringify(b), /dinner/i);
});

test("the commentary has its own switch: only \"on\": true turns it on", () => {
  const b = { on: true, lines: ["x"] };
  assert.equal(banterIfOn(b), b);
  for (const off of [{ on: false, lines: ["x"] }, { lines: ["x"] }, { on: "yes", lines: ["x"] }, null, undefined]) assert.equal(banterIfOn(off), null);
  const real = JSON.parse(readFileSync(new URL("../data/banter.json", import.meta.url), "utf8"));
  assert.equal(typeof real.on, "boolean", 'data/banter.json needs "on": true or false');
});

test("tickerCommentary: nothing at all when switched off; written lines only without a matching live week; live lines with one", () => {
  const { weekFile, playersById } = build({}, column(2, { Kevin: 30 }), onlyColumn(2));
  weekFile.season = 2026;
  weekFile.week = 12;
  const result = scoreWeek(weekFile, playersById, league);
  const sb = { games: [{ id: "g1", phase: "in" }, { id: "g2", phase: "pre" }] };
  const live = { season: 2026, week: 12, recorded: false, result, scoreboard: { games: [{ id: "g2" }] } }; // a separate copy, sharing g2
  const banter = { on: true, lines: ["written one"] };
  const args = { weeks: [live], weekFiles: [weekFile], scoreboard: sb, standings: null, league };
  // off (null after banterIfOn): no live lines either
  assert.deepEqual(tickerCommentary({ ...args, banter: null }), []);
  assert.deepEqual(tickerCommentary({ ...args, banter: banterIfOn({ ...banter, on: false }) }), []);
  // on, matching week: live lines taking turns with the written one
  const on = tickerCommentary({ ...args, banter });
  assert.ok(on.length > 1 && on.includes("written one"));
  // on, but the ticker shows another week (no shared game) or the week is recorded: written only
  assert.deepEqual(tickerCommentary({ ...args, banter, scoreboard: { games: [{ id: "zz", phase: "in" }] } }), ["written one"]);
  assert.deepEqual(tickerCommentary({ ...args, banter, weeks: [{ ...live, recorded: true }] }), ["written one"]);
});

test("on_last / on_first must be lists: a single string is ignored, not cut to one character", () => {
  const st = standings({ Vince: -60000, Mxue: 60000 });
  const l = run({ team: { Art: [10, 10, 10, 10, 10] }, light: column(1, { Kevin: 30 }), st, extra: { onLast: { Vince: "oops" }, onFirst: { Mxue: "oops" } } });
  assert.ok(!l.some((x) => /\. o$|^o$|oops/.test(x)), l.join("\n"));
  about(l, "Vince is last in the live standings at −$600.");
});

test("banterStale: a reminder once a week after through_week is recorded; quiet when current or switched off", () => {
  assert.equal(banterStale({ on: true, through_week: 11 }, 11), null);
  assert.match(banterStale({ on: true, through_week: 11 }, 12), /through Week 11, but Week 12 is recorded/);
  assert.match(banterStale({ on: true }, 12), /through Week \?/);
  assert.equal(banterStale({ on: false, through_week: 3 }, 12), null);
  assert.equal(banterStale(null, 12), null);
  assert.equal(banterStale({ on: true, through_week: 12 }, 11), null); // written ahead of the latest record
  const real = JSON.parse(readFileSync(new URL("../data/banter.json", import.meta.url), "utf8"));
  assert.ok(Number.isInteger(real.through_week), 'data/banter.json needs "through_week"');
});

test("the command line warns about stale commentary at most once, at the end", async () => {
  const { execFileSync } = await import("node:child_process");
  const index = JSON.parse(readFileSync(new URL("../data/weeks/index.json", import.meta.url), "utf8"));
  const recorded = index.filter((w) => JSON.parse(readFileSync(new URL(`../data/weeks/${w.season}-${String(w.week).padStart(2, "0")}.json`, import.meta.url), "utf8")).recorded);
  const last = recorded.at(-1);
  // a recorded week needs no network
  const out = execFileSync(process.execPath, [new URL("../cli/score.mjs", import.meta.url).pathname, String(last.season), String(last.week)], { encoding: "utf8" });
  const warnings = out.match(/ticker commentary \(data\/banter\.json\)/g) ?? [];
  assert.ok(warnings.length <= 1, out);
  if (warnings.length) assert.match(out.trimEnd().split("\n").at(-1), /ticker commentary/, "the reminder comes last");
});

const SOLO = /Nobody else took|off the board|exactly one Team table/;
const solos = (l) => l.filter((x) => SOLO.test(x));

test("a Team-table pick nobody else made that pays off (20+) gets a line; a shared one doesn't", () => {
  // helpers give every owner their own players, so Art's 25 is a pick nobody else made
  const solo = run({ team: { Art: [25, 1, 1, 1, 1] } });
  assert.equal(solos(solo).length, 1);
  about(solos(solo), "Art", "25");
  assert.ok(!solos(solo).some((l) => /rankings|share/.test(l)), "no claims about rankings or Lightning");
  // the same player on another owner's Team table: no line
  const shared = run({ team: { Art: [25, 1, 1, 1, 1] }, edit: (wf) => (wf.team_table.rosters.JD[0] = { ...wf.team_table.rosters.Art[0] }) });
  assert.deepEqual(solos(shared), []);
  // the same player twice on Art's own table: still Art's alone, and one line, not two
  const twice = run({ team: { Art: [25, 1, 1, 1, 1] }, edit: (wf) => (wf.team_table.rosters.Art[1] = { ...wf.team_table.rosters.Art[0] }) });
  assert.equal(solos(twice).length, 1);
  // another owner has the player on the Lightning table only: still the only Team table
  const light = run({ team: { Art: [25, 1, 1, 1, 1] }, edit: (wf) => (wf.lightning_table.rosters.JD[0] = { ...wf.team_table.rosters.Art[0] }) });
  assert.equal(solos(light).length, 1);
});

test("the nobody-else line: 20 points or more, played or playing, at most two", () => {
  assert.deepEqual(solos(run({ team: { Art: [19, 1, 1, 1, 1] } })), []);
  assert.equal(solos(run({ team: { Art: [20, 1, 1, 1, 1] } })).length, 1);
  const live = run({ team: { Art: [22, 1, 1, 1, 1] }, states: { "T-Art-0": "live" } });
  assert.ok(solos(live).length === 1);
  for (const state of ["not_started", "dnp", "unknown"]) {
    assert.deepEqual(solos(run({ team: { Art: [22, 1, 1, 1, 1] }, states: { "T-Art-0": state } })), [], state);
  }
  const many = run({ team: { Art: [30, 1, 1, 1, 1], JD: [25, 1, 1, 1, 1], Kevin: [21, 1, 1, 1, 1], Mxue: [24, 1, 1, 1, 1] } });
  assert.equal(solos(many).length, 2);
});

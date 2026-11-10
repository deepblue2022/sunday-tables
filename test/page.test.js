// Task 7: HTML builders (js/render.js) and the page model (js/view.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderTeamTable, renderLightning, renderSettlement, renderStandings } from "../js/render.js";
import { refresh, newState } from "../js/view.js";
import { scoreWeek, standings } from "../js/scoring.js";
import { API } from "../js/espn.js";
import { OWNERS, TEAM_COLS, league, build, column, fixture, week9RawGames, week9WeekFile } from "./helpers.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const recorded = read("../data/weeks/2026-09.json");
const realLeague = read("../data/league.json");
const baseline = read("./fixtures/baseline-wk8.json");
const count = (html, needle) => html.split(needle).length - 1;
const allStates = (state) => {
  const s = {};
  for (const o of OWNERS) for (let i = 0; i < 7; i++) (s[`T-${o}-${i}`] = state), (s[`L-${o}-${i}`] = state);
  return s;
};

// ---------- render ----------

test("renderTeamTable: recorded Week 9 shows the winner, the pot and no provisional label", () => {
  const result = scoreWeek(recorded, recorded.recorded.players, realLeague);
  const html = renderTeamTable(result, realLeague, recorded.team_table.columns);
  assert.match(html, /Galli wins \$140/);
  assert.equal(count(html, '<tr class="win"'), 1);
  assert.match(html, /<tr class="win">\s*<th[^>]*>Galli</);
  assert.doesNotMatch(html, /provisional/);
  assert.match(html, /Josh Allen/);
  assert.match(html, />115</);
  for (const c of ["QB", "RB", "WR", "Total"]) assert.ok(html.includes(`>${c}</th>`), c);
});

test("renderTeamTable: a tie is described as a split, and a provisional lead as a lead", () => {
  const t = [20, 20, 20, 20, 26];
  let { weekFile, playersById } = build({ Vince: t, JohnO: t }, {});
  let html = renderTeamTable(scoreWeek(weekFile, playersById, league), league, TEAM_COLS);
  assert.match(html, /Vince &amp; JohnO split \$140/);
  assert.equal(count(html, '<tr class="win"'), 2);
  ({ weekFile, playersById } = build({ Vince: t, JohnO: t }, {}, { "T-Art-2": "live" }));
  html = renderTeamTable(scoreWeek(weekFile, playersById, league), league, TEAM_COLS);
  assert.match(html, /provisional/);
  assert.match(html, /Vince &amp; JohnO tied/);
  ({ weekFile, playersById } = build({ Galli: t }, {}, { "T-Art-2": "not_started" }));
  html = renderTeamTable(scoreWeek(weekFile, playersById, league), league, TEAM_COLS);
  assert.match(html, /Galli leads/);
});

test("renderLightning: a live player is tagged, the column is provisional, names are escaped", () => {
  const { weekFile, playersById } = build({}, column(3, { Art: 5, Mxue: 1, Vince: 1, Kevin: 1, Galli: 1, JD: 1, JohnO: 1 }), { "L-Mxue-3": "live" });
  weekFile.lightning_table.rosters.Art[3].name = '<img src=x onerror="alert(1)">';
  weekFile.lightning_table.rosters.JD[3].name = "D'Andre Swift";
  const html = renderLightning(scoreWeek(weekFile, playersById, league), league);
  assert.match(html, /LIVE/);
  assert.match(html, /provisional/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /D&#39;Andre Swift/);
  assert.equal(count(html, 'class="cell win'), 1); // only Art's QB4 cell: all-zero columns highlight nobody
  assert.match(html, /\+\$48/); // Art collects 6 x 4 pts x $2
});

test("renderLightning: nothing started shows dashes and no winners", () => {
  const { weekFile, playersById } = build({}, {}, allStates("not_started"));
  const html = renderLightning(scoreWeek(weekFile, playersById, league), league);
  assert.equal(count(html, "win"), 0);
  assert.equal(count(html, ">—<"), 49);
});

test("renderLightning: state tags for did-not-play, bye and unknown", () => {
  const { weekFile, playersById } = build({}, {}, { "L-Art-0": "dnp", "L-Art-1": "bye", "L-Art-2": "unknown" });
  const html = renderLightning(scoreWeek(weekFile, playersById, league), league);
  assert.match(html, />DNP</);
  assert.match(html, />BYE</);
  assert.match(html, />\?</);
});

test("renderLightning: recorded Week 9 money grid has the net row values", () => {
  const html = renderLightning(scoreWeek(recorded, recorded.recorded.players, realLeague), realLeague);
  assert.match(html, /\+\$468/); // Mxue net
  assert.match(html, /−\$176/); // Vince net
  assert.match(html, /\+\$190/); // Mxue RB2
  assert.equal(count(html, 'class="cell win'), 8); // 7 columns, QB3 has two winners
});

test("renderSettlement: recorded Week 9", () => {
  const html = renderSettlement(scoreWeek(recorded, recorded.recorded.players, realLeague), realLeague);
  assert.match(html, /\+\$448/);
  assert.match(html, /\+\$120/);
  assert.match(html, /−\$196/);
  assert.doesNotMatch(html, /provisional/);
  assert.match(html, /class="money neg"/);
  assert.match(html, /class="money pos"/);
});

test("renderStandings: recorded Week 9 lists owners in league order with totals and order", () => {
  const result = scoreWeek(recorded, recorded.recorded.players, realLeague);
  const s = standings(baseline, [{ week: 9, recorded: true, final: true, settlement: result.settlement }], realLeague);
  const html = renderStandings(s, realLeague);
  assert.match(html, /Thru Wk 9/);
  assert.match(html, /JD<\/th>.*\+\$500.*>7</s);
  assert.match(html, /Vince<\/th>.*−\$726.*>1</s);
  const pos = OWNERS.map((o) => html.indexOf(`>${o}</th>`));
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b));
  assert.ok(pos.every((p) => p >= 0));
  assert.doesNotMatch(html, /provisional/);
});

test("renderStandings: an open week is its own column, marked provisional or not loaded", () => {
  const { weekFile, playersById } = build({ Galli: [9, 9, 9, 9, 9] }, {}, { "T-Art-0": "live" });
  const result = scoreWeek(weekFile, playersById, league);
  const flat = { through_week: 8, totals: Object.fromEntries(OWNERS.map((o) => [o, 0])) };
  let html = renderStandings(standings(flat, [{ week: 9, recorded: false, final: false, settlement: result.settlement }], league), league);
  assert.match(html, /Thru Wk 8/);
  assert.match(html, /Wk 9/);
  assert.match(html, /provisional/);
  assert.match(html, /\+\$120/);
  html = renderStandings(standings(flat, [{ week: 10, recorded: false, final: false, settlement: null }], league), league);
  assert.match(html, /Wk 10/);
  assert.match(html, /not loaded/);
});

// ---------- view model ----------

const games = week9RawGames();
const liveWeek9 = () => week9WeekFile(); // Week 9 without `recorded`
const espn = (opts = {}) => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url.replace(API, ""));
    if (opts.down) throw new Error("network down");
    if (url.includes("scoreboard")) return opts.scoreboard ?? fixture("2026-09/scoreboard.json");
    const id = url.match(/event=(\d+)/)[1];
    if (opts.failGame === id) throw new Error("HTTP 503");
    return games[id];
  };
  return { fetchFn, calls };
};

test("refresh: a recorded week needs no ESPN calls", async () => {
  const state = newState({ league: realLeague, baseline, weekFiles: [recorded] });
  const { fetchFn, calls } = espn();
  const model = await refresh(state, fetchFn);
  assert.deepEqual(calls, []);
  assert.equal(model.weeks.length, 1);
  assert.equal(model.weeks[0].recorded, true);
  assert.equal(model.weeks[0].result.settlement.Mxue.total, 44800);
  assert.equal(model.standings.totals.JD, 50000);
  assert.equal(model.pollMs, null);
  assert.equal(model.unavailable, false);
  assert.equal(model.defaultWeek, 9);
});

test("refresh: an unrecorded finished week is scored live and matches the recorded numbers", async () => {
  const state = newState({ league: realLeague, baseline, weekFiles: [liveWeek9()] });
  const { fetchFn, calls } = espn();
  const model = await refresh(state, fetchFn);
  const expected = scoreWeek(recorded, recorded.recorded.players, realLeague);
  assert.deepEqual(model.weeks[0].result.settlement, expected.settlement);
  assert.equal(model.weeks[0].recorded, false);
  assert.equal(model.weeks[0].result.final, true);
  assert.deepEqual(model.standings.open.map((w) => [w.week, w.provisional]), [[9, false]]);
  assert.equal(model.standings.totals.JD, 50000);
  assert.equal(model.pollMs, null);
  assert.equal(calls.filter((c) => c.includes("scoreboard")).length, 1);
  // a second refresh reuses every finished game
  const before = calls.length;
  await refresh(state, fetchFn);
  assert.equal(calls.length - before, 1);
});

test("refresh: poll every minute while a relevant game is live, five minutes before kickoff", async () => {
  const sb = fixture("2026-09/scoreboard.json");
  const withType = (type) => ({ ...sb, events: sb.events.map((e, i) => (i === 0 ? { ...e, status: { type } } : e)) });
  let state = newState({ league: realLeague, baseline, weekFiles: [liveWeek9()] });
  let model = await refresh(state, espn({ scoreboard: withType({ state: "in", completed: false }) }).fetchFn);
  assert.equal(model.pollMs, 60000);
  assert.equal(model.weeks[0].result.final, false);
  assert.equal(model.standings.open[0].provisional, true);
  state = newState({ league: realLeague, baseline, weekFiles: [liveWeek9()] });
  model = await refresh(state, espn({ scoreboard: withType({ state: "pre", completed: false }) }).fetchFn);
  assert.equal(model.pollMs, 300000);
});

test("refresh: ESPN down on first load gives no result, a flag, and a retry", async () => {
  const state = newState({ league: realLeague, baseline, weekFiles: [liveWeek9()] });
  const model = await refresh(state, espn({ down: true }).fetchFn);
  assert.equal(model.unavailable, true);
  assert.equal(model.dataFrom, null);
  assert.equal(model.weeks[0].result, null);
  assert.deepEqual(model.standings.open, [{ week: 9, provisional: true, amounts: null }]);
  assert.equal(model.pollMs, 60000);
  // the rosters can still be shown, with every player unknown and no money
  const shown = model.weeks[0].placeholder;
  assert.equal(shown.team.rows.Art.players[0].name, "Josh Allen");
  assert.equal(shown.team.rows.Art.players[0].state, "unknown");
  assert.equal(shown.team.started, false);
  assert.equal(model.weeks[0].started, false);
});

test("refresh: ESPN going down later keeps the last good numbers and says when they are from", async () => {
  const state = newState({ league: realLeague, baseline, weekFiles: [liveWeek9()] });
  const t0 = new Date("2026-11-08T21:00:00Z");
  const good = await refresh(state, espn().fetchFn, t0);
  const model = await refresh(state, espn({ down: true }).fetchFn, new Date("2026-11-08T21:05:00Z"));
  assert.equal(model.unavailable, true);
  assert.equal(model.dataFrom.getTime(), t0.getTime());
  assert.deepEqual(model.weeks[0].result.settlement, good.weeks[0].result.settlement);
  assert.equal(model.standings.totals.JD, 50000);
});

test("refresh: one failed game leaves its players unknown and the week provisional", async () => {
  const state = newState({ league: realLeague, baseline, weekFiles: [liveWeek9()] });
  const model = await refresh(state, espn({ failGame: "401873049" }).fetchFn);
  assert.equal(model.unavailable, false);
  assert.equal(model.weeks[0].errors.length, 1);
  assert.equal(model.weeks[0].result.final, false);
  assert.equal(model.gameErrors, true);
  assert.equal(model.pollMs, 60000);
});

test("refresh: the page opens on the earliest unrecorded week that has started", async () => {
  const next = { ...liveWeek9(), week: 10 };
  const sb = fixture("2026-09/scoreboard.json");
  const pre = { ...sb, events: sb.events.map((e) => ({ ...e, status: { type: { state: "pre", completed: false } } })) };
  const state = newState({ league: realLeague, baseline, weekFiles: [recorded, next] });
  const model = await refresh(state, espn({ scoreboard: pre }).fetchFn);
  assert.equal(model.defaultWeek, 10);
  assert.equal(model.weeks[1].started, false);
  assert.equal(model.pollMs, 300000);
});

test("refresh: a malformed week file is reported by name and does not hide the other weeks", async () => {
  const bad = { ...liveWeek9(), week: 10, team_table: { columns: TEAM_COLS, rosters: {} } };
  const state = newState({ league: realLeague, baseline, weekFiles: [recorded, bad] });
  const model = await refresh(state, espn().fetchFn);
  assert.equal(model.weeks[0].result.settlement.Mxue.total, 44800);
  assert.equal(model.weeks[1].result, null);
  assert.match(model.weeks[1].problem, /2026-10/);
});

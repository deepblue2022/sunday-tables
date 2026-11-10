// Tests added after the Task 7 review.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderTeamTable, renderLightning, renderStandings } from "../js/render.js";
import { refresh, newState, statusLine, bannerLines, checkIndex } from "../js/view.js";
import { scoreWeek, standings } from "../js/scoring.js";
import { API } from "../js/espn.js";
import { OWNERS, TEAM_COLS, league, build, fixture, week9RawGames, week9WeekFile } from "./helpers.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const recorded = read("../data/weeks/2026-09.json");
const realLeague = read("../data/league.json");
const baseline = read("./fixtures/baseline-wk8.json");
const games = week9RawGames();
const sb9 = fixture("2026-09/scoreboard.json");
const allPhase = (type) => ({ ...sb9, events: sb9.events.map((e) => ({ ...e, status: { type } })) });
const PRE = { state: "pre", completed: false };
const espn = (opts = {}) => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url.replace(API, ""));
    const week = Number(url.match(/week=(\d+)/)?.[1]);
    if (opts.down === true || opts.down === week) throw new Error("network down");
    if (url.includes("scoreboard")) return opts.scoreboard ?? sb9;
    const id = url.match(/event=(\d+)/)[1];
    if (opts.failGame === id) throw new Error("HTTP 503");
    return games[id];
  };
  return { fetchFn, calls };
};
const fmt = (d) => d.toISOString().slice(11, 16);
const flat = { through_week: 8, totals: Object.fromEntries(OWNERS.map((o) => [o, 0])) };

test("newState carries finished-game caches and last results over from the previous state", async () => {
  const first = newState({ league: realLeague, baseline, weekFiles: [week9WeekFile()] });
  await refresh(first, espn().fetchFn);
  const second = newState({ league: realLeague, baseline, weekFiles: [week9WeekFile()] }, first);
  const { fetchFn, calls } = espn();
  await refresh(second, fetchFn);
  assert.equal(calls.filter((c) => c.includes("summary")).length, 0);
  // and still shows the old numbers if ESPN is now down
  const third = newState({ league: realLeague, baseline, weekFiles: [week9WeekFile()] }, second);
  const model = await refresh(third, espn({ down: true }).fetchFn);
  assert.equal(model.weeks[0].result.settlement.Mxue.total, 44800);
});

test("newState with a newly recorded week file stops using ESPN for it", async () => {
  const first = newState({ league: realLeague, baseline, weekFiles: [week9WeekFile()] });
  await refresh(first, espn().fetchFn);
  const second = newState({ league: realLeague, baseline, weekFiles: [recorded] }, first);
  const { fetchFn, calls } = espn();
  const model = await refresh(second, fetchFn);
  assert.deepEqual(calls, []);
  assert.equal(model.weeks[0].recorded, true);
});

test("each week remembers when its own live data last loaded", async () => {
  const wk10 = { ...week9WeekFile(), week: 10 };
  const state = newState({ league: realLeague, baseline, weekFiles: [week9WeekFile(), wk10] });
  const t0 = new Date("2026-11-08T21:00:00Z");
  const model = await refresh(state, espn({ down: 10 }).fetchFn, t0);
  const [w9, w10] = model.weeks;
  assert.equal(w9.unavailable, false);
  assert.equal(w9.dataFrom.getTime(), t0.getTime());
  assert.equal(w10.unavailable, true);
  assert.equal(w10.dataFrom, null);
  assert.deepEqual(bannerLines(model, w10, fmt), ["Live stats unavailable — no scores yet"]);
  assert.deepEqual(bannerLines(model, w9, fmt), ["Live stats unavailable for Week 10"]);
  // later ESPN is down for both: week 9 keeps its numbers and says when they are from
  const later = await refresh(state, espn({ down: true }).fetchFn, new Date("2026-11-08T21:07:00Z"));
  assert.deepEqual(bannerLines(later, later.weeks[0], fmt), ["Live stats unavailable — showing data from 21:00", "Live stats unavailable for Week 10"]);
});

test("bannerLines mentions games that could not be loaded, and is empty when all is well", async () => {
  const state = newState({ league: realLeague, baseline, weekFiles: [week9WeekFile()] });
  let model = await refresh(state, espn({ failGame: "401873049" }).fetchFn);
  assert.equal(bannerLines(model, model.weeks[0], fmt).length, 1);
  assert.match(bannerLines(model, model.weeks[0], fmt)[0], /Some games could not be loaded/);
  const ok = newState({ league: realLeague, baseline, weekFiles: [recorded] });
  model = await refresh(ok, espn().fetchFn);
  assert.deepEqual(bannerLines(model, model.weeks[0], fmt), []);
});

test("statusLine says exactly what state the week is in", async () => {
  const one = async (weekFiles, opts) => {
    const model = await refresh(newState({ league: realLeague, baseline, weekFiles }), espn(opts).fetchFn);
    return statusLine(model.weeks[0]);
  };
  assert.equal(await one([recorded]), "Week 9 · final");
  assert.equal(await one([week9WeekFile()]), "Week 9 · final (not yet recorded by the scorekeeper)");
  assert.equal(await one([week9WeekFile()], { down: true }), "Week 9 · scores not loaded yet");
  assert.equal(await one([week9WeekFile()], { scoreboard: allPhase(PRE) }), "Week 9 · not started");
  assert.equal(await one([week9WeekFile()], { failGame: "401873049" }), "Week 9 · provisional — some games could not be loaded");
  const live = { ...sb9, events: sb9.events.map((e, i) => (i === 0 ? { ...e, status: { type: { state: "in", completed: false } } } : e)) };
  assert.equal(await one([week9WeekFile()], { scoreboard: live }), "Week 9 · provisional — games still to finish");
  const bad = { ...week9WeekFile(), team_table: { columns: TEAM_COLS, rosters: {} } };
  assert.match(await one([bad]), /^Week 9 cannot be shown: .*2026-9/);
});

test("pollMs is the soonest of several open weeks", async () => {
  const wk10 = { ...week9WeekFile(), week: 10 };
  const live = { ...sb9, events: sb9.events.map((e, i) => (i === 0 ? { ...e, status: { type: { state: "in", completed: false } } } : e)) };
  const fetchFn = async (url) => {
    if (url.includes("scoreboard")) return url.includes("week=10") ? allPhase(PRE) : live;
    return games[url.match(/event=(\d+)/)[1]];
  };
  const model = await refresh(newState({ league: realLeague, baseline, weekFiles: [week9WeekFile(), wk10] }), fetchFn);
  assert.equal(model.pollMs, 60000);
});

test("a live week whose data cannot be scored is a problem, and the page keeps retrying", async () => {
  const state = newState({ league: realLeague, baseline, weekFiles: [week9WeekFile()] });
  const fetchFn = async (url) => (url.includes("scoreboard") ? { events: [{ id: "1", status: {}, competitions: [] }] } : {});
  const model = await refresh(state, fetchFn);
  assert.equal(model.weeks[0].result, null);
  assert.equal(model.pollMs, 60000);
});

test("scoreWeek rejects a player state it does not know", () => {
  const { weekFile, playersById } = build();
  playersById["T-Art-0"] = { points: 3, state: 'final" onmouseover="x' };
  assert.throws(() => scoreWeek(weekFile, playersById, league), /2026-9.*Art T0/);
});

test("checkIndex names the file when index.json or a week entry has the wrong shape", () => {
  assert.doesNotThrow(() => checkIndex([{ season: 2026, week: 9 }]));
  assert.doesNotThrow(() => checkIndex([]));
  assert.throws(() => checkIndex({ season: 2026, week: 9 }), /index\.json/);
  assert.throws(() => checkIndex([{ season: 2026, week: "<b>9" }]), /index\.json/);
  assert.throws(() => checkIndex([null]), /index\.json/);
});

test("builders escape owner names, column names and week labels", () => {
  const evil = { ...league, owners: league.owners.map((o) => (o.key === "Art" ? { key: "Art", display: "<i>Art</i>" } : o)) };
  const { weekFile, playersById } = build({ Art: [9, 9, 9, 9, 9] }, {});
  weekFile.lightning_table.columns[0] = "<u>RB2</u>";
  const result = scoreWeek(weekFile, playersById, evil);
  const team = renderTeamTable(result, evil, ["<s>QB</s>", "RB", "RB", "WR", "WR"]);
  const light = renderLightning(result, evil);
  const table = renderStandings(standings({ ...flat, through_week: "<b>8" }, [{ week: "<b>9", recorded: false, final: false, settlement: result.settlement }], evil), evil);
  for (const html of [team, light, table]) {
    assert.doesNotMatch(html, /<i>|<u>|<s>|<b>/);
    assert.match(html, /&lt;i&gt;Art&lt;\/i&gt;/);
  }
  assert.match(team, /&lt;i&gt;Art&lt;\/i&gt; wins \$140/);
  assert.match(team, /&lt;s&gt;QB&lt;\/s&gt;/);
  assert.match(light, /&lt;u&gt;RB2&lt;\/u&gt;/);
  assert.match(table, /Wk &lt;b&gt;9/);
  assert.match(table, /Thru Wk &lt;b&gt;8/);
});

test("provisional tables carry the prov class; settled ones do not", () => {
  const live = build({ Art: [9, 9, 9, 9, 9] }, {}, { "T-Kevin-4": "live" });
  assert.match(renderTeamTable(scoreWeek(live.weekFile, live.playersById, league), league, TEAM_COLS), /class="table-wrap prov"/);
  const done = build({ Art: [9, 9, 9, 9, 9] }, {});
  assert.doesNotMatch(renderTeamTable(scoreWeek(done.weekFile, done.playersById, league), league, TEAM_COLS), /prov/);
});

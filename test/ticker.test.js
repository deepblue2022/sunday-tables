// The banner ticker: NFL scores for the current week with league fun facts in between.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreItems, seasonFacts, tickerItems, LEAD_INS } from "../js/ticker.js";

// a fact without its lead-in ("Fun fact:", "Did you know?" ...)
const bare = (x) => LEAD_INS.reduce((t, l) => (t.startsWith(`${l} `) ? t.slice(l.length + 1) : t), x);
import { scoreWeek } from "../js/scoring.js";
import { build, column, league } from "./helpers.js";

const sb = {
  games: [
    { id: "1", teams: ["NYG", "WSH"], home: "NYG", phase: "done", kickoff: "2026-11-13T01:15Z", score: { NYG: 21, WSH: 24 }, detail: "Final" },
    { id: "2", teams: ["PHI", "DAL"], home: "PHI", phase: "in", kickoff: "2026-11-15T18:00Z", score: { PHI: 14, DAL: 17 }, detail: "8:42 - 3rd" },
    { id: "3", teams: ["DEN", "KC"], home: "DEN", phase: "pre", kickoff: "2026-11-15T21:25Z" },
    { id: "4", teams: ["MIA", "BUF"], home: "MIA", phase: "unresolved", kickoff: "2026-11-15T18:00Z" },
  ],
  byeTeams: [],
};

test("scoreItems: live first, then finished, then still to play; away @ home; live ones flagged", () => {
  const items = scoreItems(sb, () => "Sun 4:25 PM");
  assert.deepEqual(items, [
    { text: "DAL 17 – PHI 14 · 8:42 - 3rd", live: true },
    { text: "WSH 24 – NYG 21 · Final", live: false },
    { text: "KC @ DEN · Sun 4:25 PM", live: false },
    { text: "BUF @ MIA · postponed", live: false },
  ]);
  assert.deepEqual(scoreItems(null), []);
});

test("tickerItems: a comment after every 3 games, rotating where the comments start", () => {
  const games = ["a", "b", "c", "d", "e", "f", "g"].map((t) => ({ text: t, live: false }));
  const items = tickerItems({ games, comments: ["x", "y", "z"], every: 3 });
  assert.deepEqual(items.map((i) => i.text), ["a", "b", "c", "x", "d", "e", "f", "y", "g"]);
  assert.ok(items.filter((i) => i.comment).every((i) => ["x", "y"].includes(i.text)));
  assert.deepEqual(tickerItems({ games, comments: ["x", "y", "z"], every: 3, turn: 2 }).filter((i) => i.comment).map((i) => i.text), ["z", "x"]);
  // no games (nothing loaded yet): just the comments
  assert.deepEqual(tickerItems({ games: [], comments: ["x"] }), [{ text: "x", live: false, comment: true }]);
});

test("seasonFacts: side-pot droughts, pot droughts, streaks, leaders and season bests from locked-in weeks only", () => {
  const week = (n, light, team = {}) => {
    const { weekFile, playersById } = build(team, light);
    return { week: n, recorded: true, result: scoreWeek(weekFile, playersById, league) };
  };
  const weeks = [
    week(1, column(0, { Vince: 10 }), { Vince: [20, 0, 0, 0, 0] }), // Vince wins RB2 and the Team pot
    week(2, column(0, { Art: 10 }), { Art: [20, 0, 0, 0, 0] }),
    week(3, column(0, { Art: 12 }), { Art: [20, 0, 0, 0, 0] }),
    week(4, column(0, { Art: 30 }), { Art: [25, 0, 0, 0, 0] }),
    { week: 5, recorded: false, result: null }, // not locked in: ignored
  ];
  const f = seasonFacts(weeks, league);
  assert.ok(f.every((x) => LEAD_INS.some((l) => x.startsWith(`${l} `))));
  const b = f.map(bare);
  assert.ok(b.includes("Vince hasn't won a side pot in 3 weeks."), f.join("\n"));
  assert.ok(b.includes("Kevin hasn't won a side pot all season."), f.join("\n"));
  assert.ok(b.includes("Kevin has yet to win a Team pot this season."), f.join("\n"));
  assert.ok(b.includes("Vince hasn't won the Team pot since Week 1."), f.join("\n"));
  assert.ok(b.includes("Art has finished up 3 weeks in a row."), f.join("\n"));
  assert.ok(b.includes("Vince has finished down 3 weeks in a row."), f.join("\n"));
  assert.ok(b.includes("Art has won the most side pots this season: 3."), f.join("\n"));
  assert.ok(f.some((x) => /the best week of the season/.test(x) && x.includes("Art") && x.includes("Week 4")));
  assert.ok(f.some((x) => /top side-pot score this season is .* 30 for Art \(RB2, Week 4\)/.test(x)));
  assert.deepEqual(seasonFacts([{ week: 1, recorded: false, result: null }], league), []);
});

test("seasonFacts on the real season: plain facts that match the saved weeks", () => {
  const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), "utf8"));
  const realLeague = read("league.json");
  const weeks = [];
  for (let w = 1; w <= 9; w++) {
    const f = read(`weeks/2026-0${w}.json`);
    weeks.push({ week: w, recorded: true, result: scoreWeek(f, f.recorded.players, realLeague) });
  }
  const f = seasonFacts(weeks, realLeague);
  const b = f.map(bare);
  assert.ok(b.includes("Vince hasn't won a side pot in 3 weeks."), f.join("\n")); // last side pot: Week 6
  assert.ok(b.includes("Kevin has yet to win a Team pot this season."), f.join("\n"));
  assert.ok(b.includes("JohnO has won the most side pots this season: 14."), f.join("\n"));
  assert.ok(b.includes("Mxue's +$448 in Week 9 is the best week of the season."), f.join("\n"));
  assert.doesNotMatch(f.join(" "), /\b(he|him|his|she|her)\b/i);
});

test("hasLiveGame: the banner only shows while an NFL game is being played", async () => {
  const { hasLiveGame } = await import("../js/ticker.js");
  assert.equal(hasLiveGame(sb), true);
  assert.equal(hasLiveGame({ games: sb.games.filter((g) => g.phase !== "in") }), false);
  assert.equal(hasLiveGame(null), false);
});

test("the page does not use the banter yet (kept in js/banter.js for later), and the ticker has no close button", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(app, /from "\.\/banter\.js"|data\/banter\.json|banterPool\(|liveBanter\(/);
  assert.doesNotMatch(html, /quip-close/);
});

test("fun facts take the lead-ins in turn, and the same facts get the same lead-ins every time", () => {
  const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), "utf8"));
  const realLeague = read("league.json");
  const weeks = [];
  for (let w = 1; w <= 9; w++) {
    const f = read(`weeks/2026-0${w}.json`);
    weeks.push({ week: w, recorded: true, result: scoreWeek(f, f.recorded.players, realLeague) });
  }
  const once = seasonFacts(weeks, realLeague);
  assert.deepEqual(seasonFacts(weeks, realLeague), once);
  const used = new Set(once.map((x) => LEAD_INS.find((l) => x.startsWith(`${l} `))));
  assert.equal(used.size, Math.min(LEAD_INS.length, once.length), [...used].join(", "));
});

test("the ticker follows ESPN's current NFL week, before that week is on the site, and falls back if ESPN can't say", async () => {
  const { newState, refresh } = await import("../js/view.js");
  const { API } = await import("../js/espn.js");
  const { weekFile } = build();
  const recorded = { ...weekFile, recorded: { players: {} } };
  const baseline = { through_week: 0, totals: Object.fromEntries(league.owners.map((o) => [o.key, 0])) };
  // only a locked-in week on the site; ESPN's current week has Thursday's game on
  const current = { events: [{ id: "9", date: "2026-11-20T01:15Z", status: { type: { state: "in", shortDetail: "2:00 - 2nd" } }, competitions: [{ competitors: [{ homeAway: "home", score: "7", team: { abbreviation: "HOU" } }, { homeAway: "away", score: "3", team: { abbreviation: "IND" } }] }] }] };
  const model = await refresh(newState({ league, baseline, weekFiles: [recorded] }), async (url) => (url === `${API}/scoreboard` ? current : {}));
  assert.deepEqual(scoreItems(model.tickerScoreboard), [{ text: "IND 3 – HOU 7 · 2:00 - 2nd", live: true }]);
  assert.equal(model.pollMs, 60000);
  // ESPN's current week unreachable: no ticker, nothing else affected
  const down = await refresh(newState({ league, baseline, weekFiles: [recorded] }), async (url) => {
    if (url === `${API}/scoreboard`) throw new Error("down");
    return {};
  });
  assert.equal(down.tickerScoreboard, null);
  assert.equal(down.pollMs, null);
});

test("tickerPollMs: a minute during a game, else until the next kickoff (1 to 30 minutes), else stop", async () => {
  const { tickerPollMs } = await import("../js/espn.js");
  const now = new Date("2026-11-19T20:00:00Z");
  const g = (phase, kickoff) => ({ phase, kickoff });
  assert.equal(tickerPollMs({ games: [g("in"), g("pre", "2026-11-23T18:00Z")] }, now), 60000);
  assert.equal(tickerPollMs({ games: [g("pre", "2026-11-19T20:10:00Z")] }, now), 10 * 60000);
  assert.equal(tickerPollMs({ games: [g("pre", "2026-11-20T01:15Z")] }, now), 30 * 60000);
  assert.equal(tickerPollMs({ games: [g("pre", "2026-11-19T19:59:00Z")] }, now), 60000); // late start
  assert.equal(tickerPollMs({ games: [g("done")] }, now), null);
  assert.equal(tickerPollMs(null, now), null);
});

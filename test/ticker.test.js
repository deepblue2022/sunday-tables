// The banner ticker: NFL scores for the current week with league fun facts in between.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreItems, seasonFacts, tickerItems, LEAD_INS, mixComments, passComments } from "../js/ticker.js";

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
    { text: "KC @ DEN · Sun 4:25 PM", live: false, upcoming: true },
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

test("the ticker carries the league commentary, and has no close button", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  // the commentary only through its switch, and through tickerCommentary (which returns nothing when off)
  assert.match(app, /getData\("data\/banter\.json"\)\.then\(banterIfOn/);
  assert.match(app, /tickerCommentary\(/);
  assert.doesNotMatch(app, /banterPool\(|liveBanter\(/);
  assert.doesNotMatch(html, /quip-close/);
});

test("mixComments: facts and commentary take turns, the longer list carries on, repeats dropped", () => {
  assert.deepEqual(mixComments(["f1", "f2", "f3"], ["b1"]), ["f1", "b1", "f2", "f3"]);
  assert.deepEqual(mixComments(["f1"], ["b1", "b2", "f1"]), ["f1", "b1", "b2"]);
  assert.deepEqual(mixComments([], []), []);
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
  assert.equal(down.pollMs, 60000); // a failed request tries again in a minute
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

test("the ticker falls back to the latest week on the site when ESPN's current week can't be reached", async () => {
  const { newState, refresh } = await import("../js/view.js");
  const { API } = await import("../js/espn.js");
  const { weekFile } = build();
  const baseline = { through_week: 0, totals: Object.fromEntries(league.owners.map((o) => [o.key, 0])) };
  const live = { events: [{ id: "1", date: "2026-11-15T18:00Z", status: { type: { state: "in", shortDetail: "8:42 - 3rd" } }, competitions: [{ competitors: [{ homeAway: "home", score: "14", team: { abbreviation: "AAA" } }, { homeAway: "away", score: "17", team: { abbreviation: "BBB" } }] }] }] };
  const model = await refresh(newState({ league, baseline, weekFiles: [weekFile] }), async (url) => {
    if (url === `${API}/scoreboard`) throw new Error("down");
    return url.includes("/scoreboard") ? live : { boxscore: { players: [] } };
  });
  assert.deepEqual(scoreItems(model.tickerScoreboard), [{ text: "BBB 17 – AAA 14 · 8:42 - 3rd", live: true }]);
});

test("the ticker's request goes out first, alongside the weeks, instead of after them", async () => {
  const { newState, refresh } = await import("../js/view.js");
  const { API } = await import("../js/espn.js");
  const { weekFile } = build();
  const baseline = { through_week: 0, totals: Object.fromEntries(league.owners.map((o) => [o.key, 0])) };
  const order = [];
  await refresh(newState({ league, baseline, weekFiles: [weekFile] }), async (url) => {
    order.push(url === `${API}/scoreboard` ? "ticker" : "week");
    return { events: [] };
  });
  assert.equal(order[0], "ticker");
});

test("itemTime: live games stay longest, games still to play shortest, the rest in between", async () => {
  const { itemTime, ITEM_MS } = await import("../js/ticker.js");
  const items = scoreItems(sb, () => "Sun 4:25 PM");
  assert.equal(itemTime(items.find((i) => i.live)), ITEM_MS.live);
  assert.equal(itemTime(items.find((i) => i.upcoming)), ITEM_MS.upcoming);
  assert.equal(itemTime(items.find((i) => i.text.includes("Final"))), ITEM_MS.other);
  assert.equal(itemTime({ text: "Fun fact: x", comment: true }), ITEM_MS.other);
  assert.ok(ITEM_MS.live > ITEM_MS.other && ITEM_MS.other > ITEM_MS.upcoming);
  // every game of the week is in the ticker, including later days
  assert.ok(items.some((i) => i.text === "KC @ DEN · Sun 4:25 PM"));
});

test("more fun facts: idle picks, most-picked player, biggest payday, closest pot, one-week sweep, best average, longest streak", () => {
  const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), "utf8"));
  const realLeague = read("league.json");
  const weeks = [];
  for (let w = 1; w <= 10; w++) {
    const f = read(`weeks/2026-${String(w).padStart(2, "0")}.json`);
    weeks.push({ week: w, recorded: true, result: scoreWeek(f, f.recorded.players, realLeague) });
  }
  const b = seasonFacts(weeks, realLeague).map(bare);
  for (const want of [
    "Galli has had 4 picks not play this season, the most in the league.",
    "Jahmyr Gibbs is the most-picked player this season: 43 times.",
    "The biggest side-pot payday this season is Kevin's +$290 from RB4 in Week 7 (Pollard, 32).",
    "The closest Team pot this season: JD beat Kevin by 1 in Week 8.",
    "Mxue won 4 side pots in Week 9, the most in one week this season.",
    "JD has the best average Team table this season: 92.5.",
    "JohnO's 5 weeks up in a row (Weeks 4 to 8) is the longest streak this season.",
  ]) assert.ok(b.includes(want), `missing: ${want}\n${b.join("\n")}`);
});

test("more fun facts stay quiet on ties and small numbers", () => {
  // two identical weeks where every owner scores the same: no sole leader anywhere
  const level = () => {
    const { weekFile, playersById } = build({}, {});
    return { week: 1, recorded: true, result: scoreWeek(weekFile, playersById, league) };
  };
  const b = seasonFacts([level(), { ...level(), week: 2 }], league).map(bare);
  assert.ok(!b.some((x) => /not play|most-picked|best average|closest Team pot|side pots in Week|in a row/.test(x)), b.join("\n"));
});

test("ESPN still on last week while a site week's game is live (e.g. Wednesday): the ticker follows the site's week", async () => {
  const { newState, refresh } = await import("../js/view.js");
  const { API } = await import("../js/espn.js");
  const { weekFile } = build();
  const baseline = { through_week: 0, totals: Object.fromEntries(league.owners.map((o) => [o.key, 0])) };
  const ev = (id, state, completed, a, b) => ({ id, date: "2026-11-26T01:00Z", status: { type: { state, completed, shortDetail: state === "in" ? "5:00 - 1st" : "Final" } }, competitions: [{ competitors: [{ homeAway: "home", score: "7", team: { abbreviation: a } }, { homeAway: "away", score: "3", team: { abbreviation: b } }] }] });
  const espnCurrent = { events: [ev("old", "post", true, "XXX", "YYY")] }; // ESPN's "current week": last week, all final
  const siteWeek = { events: [ev("wed", "in", false, "AAA", "BBB")] }; // the site's week: Wednesday's game is on
  const fetchFn = async (url) => (url === `${API}/scoreboard` ? espnCurrent : url.includes("/scoreboard") ? siteWeek : { boxscore: { players: [] } });
  const model = await refresh(newState({ league, baseline, weekFiles: [weekFile] }), fetchFn);
  assert.deepEqual(scoreItems(model.tickerScoreboard), [{ text: "BBB 3 – AAA 7 · 5:00 - 1st", live: true }]);
  // once ESPN's current week has a live game of its own, the ticker follows ESPN again
  const espnLive = { events: [ev("thu", "in", false, "DET", "CHI")] };
  const later = await refresh(newState({ league, baseline, weekFiles: [weekFile] }), async (url) => (url === `${API}/scoreboard` ? espnLive : url.includes("/scoreboard") ? siteWeek : { boxscore: { players: [] } }));
  assert.equal(scoreItems(later.tickerScoreboard)[0].text, "CHI 3 – DET 7 · 5:00 - 1st");
});

test("two weeks open on the site and ESPN unreachable: the ticker picks the one with a game on, not just the newest", async () => {
  const { newState, refresh } = await import("../js/view.js");
  const { API } = await import("../js/espn.js");
  // Week 11's Monday game is on; Week 12 is posted but nothing has kicked off
  const w11 = { ...build().weekFile, week: 11 };
  const w12 = { ...build().weekFile, week: 12 };
  const baseline = { through_week: 0, totals: Object.fromEntries(league.owners.map((o) => [o.key, 0])) };
  const ev = (state) => ({ id: state, date: "2026-11-24T01:15Z", status: { type: { state, completed: false, shortDetail: state === "in" ? "2:00 - 4th" : "Sun 1:00 PM" } }, competitions: [{ competitors: [{ homeAway: "home", score: "21", team: { abbreviation: "AAA" } }, { homeAway: "away", score: "17", team: { abbreviation: "BBB" } }] }] });
  const model = await refresh(newState({ league, baseline, weekFiles: [w11, w12] }), async (url) => {
    if (url === `${API}/scoreboard`) throw new Error("down");
    if (url.includes("week=11")) return { events: [ev("in")] };
    if (url.includes("week=12")) return { events: [ev("pre")] };
    return { boxscore: { players: [] } };
  });
  assert.deepEqual(scoreItems(model.tickerScoreboard), [{ text: "BBB 17 – AAA 21 · 2:00 - 4th", live: true }]);
});

test("comments keep their places while the scores change: a refresh only updates the games", () => {
  const games = (score) => ["A", "B", "C", "D", "E", "F"].map((t) => ({ text: `${t} ${score}`, live: true }));
  const comments = ["fact one", "line one", "fact two"];
  const before = tickerItems({ games: games(0), comments, turn: 2 });
  const after = tickerItems({ games: games(7), comments, turn: 2 });
  assert.deepEqual(after.map((i) => (i.comment ? i.text : "game")), before.map((i) => (i.comment ? i.text : "game")));
});

test("passComments: the comments are worked out once per pass, again for a new pass, a changed commentary file or after a reset", () => {
  let n = 0;
  const compute = () => [`list ${++n}`];
  const on = { on: true };
  let kept = passComments(null, { pass: 0, banter: on }, compute);
  assert.deepEqual(kept.list, ["list 1"]);
  // refreshes during the pass: the same list, not recomputed
  assert.equal(passComments(kept, { pass: 0, banter: on }, compute), kept);
  assert.equal(n, 1);
  // the next pass
  kept = passComments(kept, { pass: 1, banter: on }, compute);
  assert.deepEqual(kept.list, ["list 2"]);
  // the commentary switched off (a reload gives null): straight away, not at the end of the pass
  kept = passComments(kept, { pass: 1, banter: null }, compute);
  assert.deepEqual(kept.list, ["list 3"]);
  // reset (the bar or the tab came back)
  assert.deepEqual(passComments(null, { pass: 1, banter: null }, compute).list, ["list 4"]);
});

test("the page uses passComments, and starts fresh comments when the tab comes back", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /passComments\(keptComments, \{ pass: tickerPass, banter: state\.banter \}/);
  assert.match(app, /visibilitychange[\s\S]{0,80}keptComments = null/);
});

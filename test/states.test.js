import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePlayers, relevantGames } from "../js/scoring.js";
import { loadLive, API } from "../js/espn.js";
import { build } from "./helpers.js";

// One rostered player "p" on team AAA, in a week file built by the helper (everyone else is on AAA too).
const game = (phase, id = "g1", teams = ["AAA", "BBB"]) => ({ id, teams, phase, kickoff: "2026-11-08T18:00Z" });
const one = (scoreboard, gamesById, player = { name: "Pat Player", id: "p", team: "AAA" }) => {
  const { weekFile } = build();
  weekFile.team_table.rosters.Art[0] = player;
  return derivePlayers(weekFile, scoreboard, gamesById).p;
};
const loaded = (stats = {}, twoPt = []) => ({ g1: { stats, twoPt } });

test("finished game: a stat line makes the player final with points", () => {
  assert.deepEqual(one({ games: [game("done")], byeTeams: [] }, loaded({ p: { rushYds: 107, rushTD: 1 } })), { points: 16, state: "final" });
});

test("finished game: no stat line and no 2-pt is did-not-play with 0", () => {
  assert.deepEqual(one({ games: [game("done")], byeTeams: [] }, loaded()), { points: 0, state: "dnp" });
});

test("finished game: a 2-pt conversion alone makes the player final with its points", () => {
  const r = one({ games: [game("done")], byeTeams: [] }, loaded({}, [{ name: "Pat Player", team: "AAA", points: 2 }]));
  assert.deepEqual(r, { points: 2, state: "final" });
});

test("2-pt points add to the stat line, and several conversions add up", () => {
  const twoPt = [{ name: "Pat Player", team: "AAA", points: 2 }, { name: "Pat Player", team: "AAA", points: 1 }];
  assert.deepEqual(one({ games: [game("done")], byeTeams: [] }, loaded({ p: { recYds: 58 } }, twoPt)), { points: 8, state: "final" });
});

test("a 2-pt conversion by a same-named player on the other team is not credited", () => {
  const r = one({ games: [game("done")], byeTeams: [] }, loaded({}, [{ name: "Pat Player", team: "BBB", points: 2 }]));
  assert.deepEqual(r, { points: 0, state: "dnp" });
});

test("game in progress: live with points so far, or 0 before any stats", () => {
  assert.deepEqual(one({ games: [game("in")], byeTeams: [] }, loaded({ p: { passYds: 100 } })), { points: 5, state: "live" });
  assert.deepEqual(one({ games: [game("in")], byeTeams: [] }, loaded()), { points: 0, state: "live" });
});

test("summary not loaded for a live or finished game is unknown", () => {
  assert.deepEqual(one({ games: [game("in")], byeTeams: [] }, {}), { points: 0, state: "unknown" });
  assert.deepEqual(one({ games: [game("done")], byeTeams: [] }, { g1: null }), { points: 0, state: "unknown" });
});

test("game not kicked off is not_started; a cancelled game is unknown even if stats exist", () => {
  assert.deepEqual(one({ games: [game("pre")], byeTeams: [] }, {}), { points: 0, state: "not_started" });
  assert.deepEqual(one({ games: [game("unresolved")], byeTeams: [] }, loaded({ p: { rushYds: 50 } })), { points: 0, state: "unknown" });
});

test("team on the bye list is bye; team in no game and not on the list is unknown", () => {
  assert.deepEqual(one({ games: [game("done", "g1", ["CCC", "DDD"])], byeTeams: ["AAA"] }, {}), { points: 0, state: "bye" });
  assert.deepEqual(one({ games: [game("done", "g1", ["CCC", "DDD"])], byeTeams: ["EEE"] }, {}), { points: 0, state: "unknown" });
});

test("derivePlayers covers every rostered player in both tables", () => {
  const { weekFile } = build();
  const players = derivePlayers(weekFile, { games: [game("pre")], byeTeams: [] }, {});
  assert.equal(Object.keys(players).length, 7 * 5 + 7 * 7);
});

test("relevantGames keeps only games with a rostered team", () => {
  const { weekFile } = build();
  const sb = { games: [game("done", "g1", ["AAA", "BBB"]), game("done", "g2", ["CCC", "DDD"])], byeTeams: [] };
  assert.deepEqual(relevantGames(weekFile, sb).map((g) => g.id), ["g1"]);
});

// --- loadLive ---

const sbJson = (phases) => ({
  events: Object.entries(phases).map(([id, [type, teams]]) => ({
    id,
    date: "2026-11-08T18:00Z",
    status: { type },
    competitions: [{ competitors: teams.map((abbreviation) => ({ team: { abbreviation } })) }],
  })),
});
const PRE = { state: "pre", completed: false };
const IN = { state: "in", completed: false };
const DONE = { state: "post", completed: true };
const fakeFetch = (phases, failing = []) => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url.replace(API, ""));
    if (url.includes("scoreboard")) {
      if (failing.includes("scoreboard")) throw new Error("scoreboard 503");
      return sbJson(phases);
    }
    const id = url.match(/event=(\w+)/)[1];
    if (failing.includes(id)) throw new Error(`summary ${id} 503`);
    return { boxscore: { players: [{ statistics: [{ name: "rushing", keys: ["rushingYards"], athletes: [{ athlete: { id: "z" }, stats: ["5"] }] }] }] }, scoringPlays: [] };
  };
  return { fetchFn, calls };
};
const summaries = (calls) => calls.filter((c) => c.startsWith("/summary")).map((c) => c.split("=")[1]).sort();

test("loadLive fetches relevant live and finished games only", async () => {
  const { weekFile } = build();
  const { fetchFn, calls } = fakeFetch({ a: [DONE, ["AAA", "BBB"]], b: [IN, ["AAA", "CCC"]], c: [PRE, ["AAA", "DDD"]], d: [DONE, ["XXX", "YYY"]] });
  const r = await loadLive(weekFile, fetchFn);
  assert.deepEqual(summaries(calls), ["a", "b"]);
  assert.deepEqual(Object.keys(r.gamesById).sort(), ["a", "b"]);
  assert.equal(r.scoreboard.games.length, 4);
  assert.deepEqual(r.errors, []);
});

test("loadLive caches finished games but refetches live ones", async () => {
  const { weekFile } = build();
  const cache = new Map();
  const { fetchFn, calls } = fakeFetch({ a: [DONE, ["AAA", "BBB"]], b: [IN, ["AAA", "CCC"]] });
  await loadLive(weekFile, fetchFn, cache);
  const r = await loadLive(weekFile, fetchFn, cache);
  assert.deepEqual(summaries(calls), ["a", "b", "b"]);
  assert.deepEqual(Object.keys(r.gamesById).sort(), ["a", "b"]);
});

test("loadLive refetches a game once more after it turns from live to finished", async () => {
  const { weekFile } = build();
  const cache = new Map();
  const live = fakeFetch({ a: [IN, ["AAA", "BBB"]] });
  await loadLive(weekFile, live.fetchFn, cache);
  const done = fakeFetch({ a: [DONE, ["AAA", "BBB"]] });
  await loadLive(weekFile, done.fetchFn, cache);
  await loadLive(weekFile, done.fetchFn, cache);
  assert.deepEqual(summaries(live.calls), ["a"]);
  assert.deepEqual(summaries(done.calls), ["a"]);
});

test("loadLive reports a failed game and still loads the others; a failure is not cached", async () => {
  const { weekFile } = build();
  const cache = new Map();
  const { fetchFn } = fakeFetch({ a: [DONE, ["AAA", "BBB"]], b: [DONE, ["AAA", "CCC"]] }, ["b"]);
  const r = await loadLive(weekFile, fetchFn, cache);
  assert.deepEqual(Object.keys(r.gamesById), ["a"]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /b/);
  assert.equal(cache.has("b"), false);
});

test("loadLive rejects when the scoreboard fails", async () => {
  const { weekFile } = build();
  await assert.rejects(loadLive(weekFile, fakeFetch({}, ["scoreboard"]).fetchFn), /scoreboard 503/);
});

// --- added after Task 5 review ---

test("a team in two games this week is unknown unless only one of them counts", () => {
  const g1 = game("done", "g1", ["AAA", "BBB"]);
  const stats = { g1: { stats: {}, twoPt: [] }, g2: { stats: { p: { rushYds: 100 } }, twoPt: [] } };
  // finished game plus one still to play: cannot be a final 0
  assert.deepEqual(one({ games: [g1, game("pre", "g2", ["AAA", "CCC"])], byeTeams: [] }, stats), { points: 0, state: "unknown" });
  // both played: ambiguous, the scorekeeper decides
  assert.deepEqual(one({ games: [g1, game("done", "g2", ["AAA", "CCC"])], byeTeams: [] }, stats), { points: 0, state: "unknown" });
  // a cancelled game plus a played one: the played one counts
  assert.deepEqual(one({ games: [game("unresolved", "g1", ["AAA", "BBB"]), game("done", "g2", ["AAA", "CCC"])], byeTeams: [] }, stats), { points: 10, state: "final" });
});

test("a team with a game is never bye, even if it is also on the bye list", () => {
  assert.deepEqual(one({ games: [game("pre")], byeTeams: ["AAA"] }, {}), { points: 0, state: "not_started" });
});

test("loadLive treats an empty summary for a finished game as a failure and does not cache it", async () => {
  const { weekFile } = build();
  const cache = new Map();
  const fetchFn = async (url) => (url.includes("scoreboard") ? sbJson({ a: [DONE, ["AAA", "BBB"]] }) : {});
  const r = await loadLive(weekFile, fetchFn, cache);
  assert.deepEqual(r.gamesById, {});
  assert.equal(r.errors.length, 1);
  assert.equal(cache.size, 0);
});

test("loadLive accepts an empty summary for a game that has only just started", async () => {
  const { weekFile } = build();
  const fetchFn = async (url) => (url.includes("scoreboard") ? sbJson({ a: [IN, ["AAA", "BBB"]] }) : {});
  const r = await loadLive(weekFile, fetchFn);
  assert.deepEqual(r.gamesById, { a: { stats: {}, twoPt: [] } });
  assert.deepEqual(r.errors, []);
});

test("loadLive drops a cached game if the scoreboard stops calling it finished", async () => {
  const { weekFile } = build();
  const cache = new Map();
  const full = { boxscore: { players: [{ statistics: [{ name: "rushing", keys: ["rushingYards"], athletes: [{ athlete: { id: "z" }, stats: ["5"] }] }] }] } };
  const mk = (type) => {
    const calls = [];
    return { calls, fetchFn: async (url) => (calls.push(url), url.includes("scoreboard") ? sbJson({ a: [type, ["AAA", "BBB"]] }) : full) };
  };
  await loadLive(weekFile, mk(DONE).fetchFn, cache);
  const again = mk(IN);
  await loadLive(weekFile, again.fetchFn, cache);
  assert.equal(again.calls.filter((c) => c.includes("summary")).length, 1);
  assert.equal(cache.has("a"), false);
});

test("loadLive survives a game fetch that rejects with a non-Error", async () => {
  const { weekFile } = build();
  const fetchFn = async (url) => {
    if (url.includes("scoreboard")) return sbJson({ a: [DONE, ["AAA", "BBB"]] });
    throw null;
  };
  const r = await loadLive(weekFile, fetchFn);
  assert.equal(r.errors.length, 1);
});

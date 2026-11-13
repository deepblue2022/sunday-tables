import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseScoreboard, parseGame, fetchScoreboard, fetchGame, fetchRosters, nextPollMs, API } from "../js/espn.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const event = (type, id = "1") => ({
  id,
  date: "2026-11-08T18:00Z",
  status: { type },
  competitions: [{ competitors: [{ team: { abbreviation: "AAA" } }, { team: { abbreviation: "BBB" } }] }],
});

test("parseScoreboard: Week 9 has 15 finished games and two bye teams", () => {
  const sb = parseScoreboard(fixture("2026-09/scoreboard.json"));
  assert.equal(sb.games.length, 15);
  assert.ok(sb.games.every((g) => g.phase === "done"));
  assert.deepEqual([...sb.byeTeams].sort(), ["PIT", "TEN"]);
  const gbne = sb.games.find((g) => g.id === "401873049");
  assert.deepEqual([...gbne.teams].sort(), ["GB", "NE"]);
  assert.equal(gbne.kickoff, "2026-11-08T21:25Z");
});

test("parseScoreboard: a cancelled game is unresolved, not done", () => {
  const sb = parseScoreboard(fixture("2022-17-scoreboard.json"));
  assert.equal(sb.games.find((g) => g.id === "401437947").phase, "unresolved");
  assert.deepEqual(sb.byeTeams, []);
});

test("parseScoreboard: phase comes from state and completed, whatever the status name", () => {
  const phase = (type) => parseScoreboard({ events: [event(type)] }).games[0].phase;
  assert.equal(phase({ name: "STATUS_SCHEDULED", state: "pre", completed: false }), "pre");
  assert.equal(phase({ name: "STATUS_IN_PROGRESS", state: "in", completed: false }), "in");
  assert.equal(phase({ name: "STATUS_HALFTIME", state: "in", completed: false }), "in");
  assert.equal(phase({ name: "STATUS_DELAYED", state: "in", completed: false }), "in");
  assert.equal(phase({ name: "STATUS_FINAL", state: "post", completed: true }), "done");
  assert.equal(phase({ name: "STATUS_POSTPONED", state: "post", completed: false }), "unresolved");
  assert.equal(phase({ name: "STATUS_WEIRD" }), "unresolved");
});

test("parseScoreboard: no week block means no bye teams", () => {
  assert.deepEqual(parseScoreboard({ events: [] }), { games: [], byeTeams: [] });
});

test("parseGame: stat lines are keyed by athlete id and merged across categories", () => {
  const g = parseGame(fixture("2026-09/game-401873049.json"));
  assert.deepEqual(g.stats["4036378"], { passCmp: 23, passAtt: 29, passYds: 372, passTD: 3, rushAtt: 1, rushYds: 13, rushTD: 1 }); // Jordan Love
});

test("parseGame: successful 2-pt run is credited, failed attempts are not", () => {
  const g = parseGame(fixture("2026-09/game-401873049.json"));
  assert.deepEqual(g.twoPt, [{ name: "Jordan Love", team: "GB", points: 2 }]);
});

test("parseGame: 2-pt pass credits passer 1 and receiver 2, keeping apostrophes and suffixes", () => {
  const plays = (texts) => ({ scoringPlays: texts.map((text) => ({ text, team: { abbreviation: "DEN" } })) });
  assert.deepEqual(parseGame(plays(["X 5 Yd Run (Bo Nix Pass to Ja'Marr Chase for Two-Point Conversion)"])).twoPt, [
    { name: "Bo Nix", team: "DEN", points: 1 },
    { name: "Ja'Marr Chase", team: "DEN", points: 2 },
  ]);
  assert.deepEqual(parseGame(plays(["Y 3 Yd pass from Z (Michael Penix Jr. Pass to Drake London for Two-Point Conversion)"])).twoPt, [
    { name: "Michael Penix Jr.", team: "DEN", points: 1 },
    { name: "Drake London", team: "DEN", points: 2 },
  ]);
  assert.deepEqual(parseGame(plays(["Q 9 Yd Rush (Two-Point Pass Conversion Failed)", "Q 1 Yd Rush (K Kicker Kick)"])).twoPt, []);
});

test("parseGame: a response with no box score yet gives empty stats", () => {
  assert.deepEqual(parseGame({}), { stats: {}, twoPt: [] });
});

test("nextPollMs: a minute while a game is on, five while one is still to start, else stop", () => {
  const g = (phase) => ({ phase });
  assert.equal(nextPollMs([g("in"), g("pre")]), 60000);
  assert.equal(nextPollMs([g("pre"), g("done")]), 300000);
  assert.equal(nextPollMs([g("done"), g("unresolved")]), null);
  assert.equal(nextPollMs([]), null);
});

test("fetchScoreboard and fetchGame request the right URLs and parse the result", async () => {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    return url.includes("scoreboard") ? fixture("2026-09/scoreboard.json") : fixture("2026-09/game-401873049.json");
  };
  const sb = await fetchScoreboard(2026, 9, fetchFn);
  const game = await fetchGame("401873049", fetchFn);
  assert.equal(sb.games.length, 15);
  assert.equal(game.stats["4036378"].passYds, 372);
  assert.deepEqual(seen, [`${API}/scoreboard?seasontype=2&week=9&dates=2026`, `${API}/summary?event=401873049`]);
});

test("fetchRosters takes team ids from the teams endpoint and flattens every roster group", async () => {
  const fetchFn = async (url) => {
    if (url === `${API}/teams`) {
      return { sports: [{ leagues: [{ teams: [{ team: { id: "33", abbreviation: "BAL" } }, { team: { id: "2", abbreviation: "BUF" } }] }] }] };
    }
    const id = url.match(/teams\/(\d+)\/roster$/)[1];
    const abbr = { 33: "BAL", 2: "BUF" }[id];
    return {
      team: { abbreviation: abbr },
      athletes: [
        { position: "offense", items: [{ id: `${id}01`, displayName: `${abbr} Passer`, position: { abbreviation: "QB" } }] },
        { position: "practiceSquad", items: [{ id: `${id}02`, displayName: `${abbr} Backup`, position: { abbreviation: "WR" } }] },
      ],
    };
  };
  const players = await fetchRosters(fetchFn);
  assert.deepEqual(players, [
    { id: "3301", name: "BAL Passer", team: "BAL", pos: "QB" },
    { id: "3302", name: "BAL Backup", team: "BAL", pos: "WR" },
    { id: "201", name: "BUF Passer", team: "BUF", pos: "QB" },
    { id: "202", name: "BUF Backup", team: "BUF", pos: "WR" },
  ]);
});

test("a rejected fetch propagates", async () => {
  await assert.rejects(fetchGame("1", async () => { throw new Error("boom 503"); }), /boom 503/);
});

// --- added after Task 4 review ---

test("parseGame: receiving lines map to recYds and recTD", () => {
  const raw = fixture("2026-09/game-401873049.json");
  const rec = raw.boxscore.players.flatMap((t) => t.statistics).filter((s) => s.name === "receiving").flatMap((s) => s.athletes);
  const watson = rec.find((a) => a.athlete.displayName === "Christian Watson");
  assert.deepEqual(parseGame(raw).stats[watson.athlete.id], { rec: 7, recYds: 171, recTD: 1 });
});

test("parseGame: junk or missing stat values become 0", () => {
  const g = parseGame({
    boxscore: { players: [{ statistics: [{ name: "rushing", keys: ["rushingAttempts", "rushingYards", "rushingTouchdowns"], athletes: [{ athlete: { id: 7 }, stats: ["1", "--"] }] }] }] },
  });
  assert.deepEqual(g.stats["7"], { rushAtt: 1, rushYds: 0, rushTD: 0 });
});

test("parseGame: completions/attempts split into passCmp and passAtt, junk becomes 0", () => {
  const passing = (value) =>
    parseGame({ boxscore: { players: [{ statistics: [{ name: "passing", keys: ["completions/passingAttempts"], athletes: [{ athlete: { id: 3 }, stats: [value] }] }] }] } }).stats["3"];
  assert.deepEqual(passing("16/26"), { passCmp: 16, passAtt: 26 });
  assert.deepEqual(passing("--"), { passCmp: 0, passAtt: 0 });
});

test("parseScoreboard: home is the competitor ESPN marks as home, or null when it does not say", () => {
  const ev = (comps) => ({ events: [{ id: 1, competitions: [{ competitors: comps }], status: { type: { state: "pre" } } }] });
  assert.equal(parseScoreboard(ev([{ homeAway: "home", team: { abbreviation: "WSH" } }, { homeAway: "away", team: { abbreviation: "NYG" } }])).games[0].home, "WSH");
  assert.equal(parseScoreboard(ev([{ team: { abbreviation: "WSH" } }, { team: { abbreviation: "NYG" } }])).games[0].home, null);
});

test("parseGame: 2-pt names never cross a parenthesis, and each parenthetical is judged on its own", () => {
  const plays = (text, abbr = "DEN") => ({ scoringPlays: [{ text, team: { abbreviation: abbr } }] });
  assert.deepEqual(parseGame(plays("X 12 Yd Rush (Ryan Fitzgerald Kick) (Bo Nix Run for Two-Point Conversion)")).twoPt, [{ name: "Bo Nix", team: "DEN", points: 2 }]);
  assert.deepEqual(parseGame(plays("X 12 Yd Rush (Two-Point Pass Conversion Failed) (Bo Nix Rush for Two-Point Conversion)")).twoPt, [{ name: "Bo Nix", team: "DEN", points: 2 }]);
  assert.deepEqual(parseGame(plays("X 1 Yd Rush (Bo Nix Run for Two-Point Conversion Failed)")).twoPt, []);
});

test("parseGame: each 2-pt entry carries the scoring team of its own play", () => {
  const g = parseGame({
    scoringPlays: [
      { text: "A 1 Yd Rush (Al One Run for Two-Point Conversion)", team: { abbreviation: "GB" } },
      { text: "B 1 Yd Rush (Bo Two Run for Two-Point Conversion)", team: { abbreviation: "NE" } },
    ],
  });
  assert.deepEqual(g.twoPt.map((t) => [t.name, t.team]), [["Al One", "GB"], ["Bo Two", "NE"]]);
});

test("fetchRosters falls back to the teams-list abbreviation", async () => {
  const fetchFn = async (url) =>
    url === `${API}/teams`
      ? { sports: [{ leagues: [{ teams: [{ team: { id: "9", abbreviation: "GB" } }] }] }] }
      : { athletes: [{ items: [{ id: 1, displayName: "A B", position: { abbreviation: "RB" } }] }] };
  assert.deepEqual(await fetchRosters(fetchFn), [{ id: "1", name: "A B", team: "GB", pos: "RB" }]);
});

// Stat lines: the saved weeks' stats must reproduce every saved score, and the stats card
// must show them (and any settled correction) the same way the scores were worked out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statsPoints, playerPoints, pointsBreakdown, scoreWeek } from "../js/scoring.js";
import { renderCard, renderTeamTable, renderLightning, statRows } from "../js/render.js";
import { recordWeek, formatWeek } from "../cli/lib.mjs";
import { build, league, TEAM_COLS } from "./helpers.js";
import { parseScoreboard } from "../js/espn.js";
import { derivePlayers } from "../js/scoring.js";

const DATA = new URL("../data/", import.meta.url);
const read = (rel) => JSON.parse(readFileSync(new URL(rel, DATA), "utf8"));
const recordedWeeks = read("weeks/index.json")
  .map((w) => read(`weeks/${w.season}-${String(w.week).padStart(2, "0")}.json`))
  .filter((f) => f.recorded);

test("every recorded week: the stat line gives the saved points, except a listed settled correction", () => {
  assert.ok(recordedWeeks.length >= 9);
  const corrections = [];
  for (const f of recordedWeeks) {
    for (const [id, p] of Object.entries(f.recorded.players)) {
      const where = `${f.season} week ${f.week} player ${id}`;
      if (p.state === "final") assert.ok(p.stats, `${where}: final but no stat line`);
      if (p.state === "dnp" || p.state === "bye") assert.equal(p.stats, undefined, `${where}: ${p.state} but has stats`);
      const rules = p.stats ? statsPoints(p.stats) : 0;
      if (p.override) {
        assert.equal(rules, p.override.rules, `${where}: correction says the rules give ${p.override.rules}, stats give ${rules}`);
        assert.notEqual(p.points, rules, `${where}: a correction must differ from the rules`);
        assert.ok(p.override.reason, `${where}: a correction needs a reason`);
        corrections.push(where);
      } else {
        assert.equal(rules, p.points, `${where}: stats give ${rules}, saved ${p.points}`);
      }
    }
  }
  // The one known settled correction: Week 5 Justin Jefferson, settled at 12 (rules: 13).
  assert.deepEqual(corrections, ["2026 week 5 player 4262921"]);
  const jj = recordedWeeks.find((f) => f.week === 5).recorded.players["4262921"];
  assert.equal(jj.points, 12);
  assert.equal(jj.override.rules, 13);
});

test("pointsBreakdown adds up to playerPoints", () => {
  const line = { passYds: 287, passTD: 2, rushYds: -11, rushTD: 1, recYds: 48, recTD: 0 };
  const b = pointsBreakdown(line, 2);
  assert.deepEqual(b, { pass: { yards: 14, td: 6 }, rush: { yards: 0, td: 6 }, rec: { yards: 4, td: 0 }, twoPt: 2 });
  assert.equal(playerPoints(line, 2), 32);
  assert.equal(statsPoints({ ...line, twoPt: 2 }), 32);
});

test("statRows: one line per category touched, negative yards shown, points per line", () => {
  assert.deepEqual(statRows({ passCmp: 18, passAtt: 27, passYds: 241, passTD: 2, rushAtt: 6, rushYds: 38, rushTD: 0 }), [
    { label: "Pass", line: "18/27, 241 yds, 2 TD", points: "12 + 6" },
    { label: "Rush", line: "6 car, 38 yds", points: "3" },
  ]);
  assert.deepEqual(statRows({ rushAtt: 1, rushYds: -11, rushTD: 0, rec: 6, recYds: 79, recTD: 1, twoPt: 2 }), [
    { label: "Rush", line: "1 car, −11 yds", points: "0" },
    { label: "Rec", line: "6 rec, 79 yds, 1 TD", points: "7 + 6" },
    { label: "2-pt", line: "conversion", points: "2" },
  ]);
  assert.deepEqual(statRows(undefined), []);
});

const jefferson = {
  name: "Justin Jefferson",
  team: "MIN",
  points: 12,
  state: "final",
  stats: { rushAtt: 1, rushYds: -11, rushTD: 0, rec: 6, recYds: 79, recTD: 1 },
  game: { opp: "CLE", home: false },
  override: { rules: 13, reason: "The scorer netted the yards." },
};

test("renderCard: a settled correction shows the rules total and the official score with its reason", () => {
  const html = renderCard(jefferson, "Art · WR2");
  assert.match(html, /Justin Jefferson/);
  assert.match(html, /Art · WR2 · MIN @ CLE · Final/);
  assert.match(html, /By the rules<\/span><strong>13</);
  assert.match(html, /\* Settled at 12<\/strong>, the official score\. The scorer netted the yards\./);
  assert.doesNotMatch(html, />Total</);
});

test("renderCard: live, finished, did-not-play, bye, not started and unsaved stats", () => {
  const live = renderCard({ name: "A", team: "WSH", points: 21, state: "live", stats: { passCmp: 18, passAtt: 27, passYds: 241, passTD: 2 }, game: { opp: "NYG", home: true } });
  assert.match(live, /WSH vs NYG · LIVE/);
  assert.match(live, /So far<\/span><strong>21</);
  assert.match(renderCard({ name: "B", team: "MIN", points: 8, state: "final", stats: { recYds: 80 }, game: { opp: "GB", home: null } }), /MIN v GB · Final.*Total<\/span><strong>8</);
  assert.match(renderCard({ name: "C", team: "SF", points: 0, state: "dnp", game: { opp: "LAR", home: true } }), /No stats in the box score.*Total<\/span><strong>0</);
  const bye = renderCard({ name: "D", team: "TB", points: 0, state: "bye" });
  assert.match(bye, /TB · Bye week/);
  assert.doesNotMatch(bye, /Total/);
  const pre = renderCard({ name: "E", team: "DAL", points: 0, state: "not_started", game: { opp: "PHI", home: false, kickoff: "2026-11-15T18:00Z" } }, "", () => "Sun 1:00 PM");
  assert.match(pre, /DAL @ PHI · Kickoff Sun 1:00 PM/);
  assert.doesNotMatch(pre, /Total/);
  assert.match(renderCard({ name: "F", team: "KC", points: 9, state: "final" }), /Stat line not saved for this week/);
});

test("renderCard before any live scores have loaded says so, instead of blaming the game", () => {
  const html = renderCard({ name: "G", team: "WSH", points: 0, state: "unknown" }, "Kevin · QB3", null, false);
  assert.match(html, /Kevin · QB3 · WSH/);
  assert.match(html, /Scores not loaded yet/);
  assert.doesNotMatch(html, /scorekeeper|Total/);
});

test("renderCard escapes names and reasons", () => {
  const html = renderCard({ ...jefferson, name: "<b>x</b>", override: { rules: 13, reason: "<script>" } });
  assert.doesNotMatch(html, /<b>x<\/b>|<script>/);
});

test("player boxes are buttons that name their place; a settled score gets a *", () => {
  const { weekFile, playersById } = build({ Art: [9, 9, 9, 9, 9] }, {});
  playersById["T-Art-1"] = { ...playersById["T-Art-1"], override: { rules: 10, reason: "r" } };
  const result = scoreWeek(weekFile, playersById, league);
  const team = renderTeamTable(result, league, TEAM_COLS);
  assert.match(team, /<button type="button" class="pcell" data-card="t\|Art\|0"/);
  assert.equal((team.match(/class="star"/g) ?? []).length, 1);
  assert.match(team, /aria-label="Art T1, 9 points \(settled score\)\. Show stats"/);
  assert.match(renderLightning(result, league), /data-card="l\|6\|JohnO"/);
});

test("boxes show the game state: kickoff time while yet to play, a state class for styling", () => {
  const { weekFile, playersById } = build({}, {}, { "T-Art-0": "not_started", "T-Art-1": "live", "T-Art-2": "not_started" });
  playersById["T-Art-0"].game = { opp: "BBB", home: true, kickoff: "2026-11-15T18:00Z" };
  const html = renderTeamTable(scoreWeek(weekFile, playersById, league), league, TEAM_COLS, () => "Sun 1:00 PM");
  assert.match(html, /<td class="cell not_started">.*?Art T0<\/span><span class="pts"><span class="kick">Sun 1:00 PM<\/span><\/span>/);
  assert.match(html, /<td class="cell live">.*?Art T1<\/span><span class="pts">0<\/span><span class="tag live">LIVE/);
  // no kickoff known (or no formatter): the usual dash
  assert.match(html, /Art T2<\/span><span class="pts">—<\/span>/);
  assert.match(renderTeamTable(scoreWeek(weekFile, playersById, league), league, TEAM_COLS), /Art T0<\/span><span class="pts">—<\/span>/);
});

test("scoreWeek scores the settled points, not the rules, and passes the details through", () => {
  const { weekFile, playersById } = build({ Art: [12, 0, 0, 0, 0] }, {});
  playersById["T-Art-0"] = { ...playersById["T-Art-0"], stats: jefferson.stats, game: jefferson.game, override: jefferson.override };
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.team.rows.Art.total, 12);
  const c = r.team.rows.Art.players[0];
  assert.deepEqual([c.team, c.stats, c.game, c.override], ["AAA", jefferson.stats, jefferson.game, jefferson.override]);
  assert.match(formatWeek(r, { recordedThrough: 0, base: {}, open: [], totals: {}, order: {} }, league), /Art     T0=12\* /);
});

test("recordWeek saves the stat line and opponent, not the kickoff time", () => {
  const { weekFile, playersById } = build({ Art: [5, 0, 0, 0, 0] }, {});
  playersById["T-Art-0"] = { points: 5, state: "final", stats: { passYds: 100 }, game: { opp: "BBB", home: true, kickoff: "2026-11-08T18:00Z" } };
  const out = recordWeek(weekFile, playersById, scoreWeek(weekFile, playersById, league), {});
  assert.deepEqual(out.recorded.players["T-Art-0"], { points: 5, state: "final", stats: { passYds: 100 }, game: { opp: "BBB", home: true } });
});

test("scoreboard: score and status text only once a game is under way", () => {
  const ev = (state, completed, shortDetail) => ({
    id: 1,
    status: { type: { state, completed, shortDetail } },
    competitions: [{ competitors: [{ homeAway: "home", score: "21", team: { abbreviation: "NYG" } }, { homeAway: "away", score: "24", team: { abbreviation: "WSH" } }] }],
  });
  const one = (...a) => parseScoreboard({ events: [ev(...a)] }).games[0];
  assert.deepEqual([one("in", false, "8:42 - 3rd").score, one("in", false, "8:42 - 3rd").detail], [{ NYG: 21, WSH: 24 }, "8:42 - 3rd"]);
  assert.deepEqual([one("post", true, "Final/OT").score, one("post", true, "Final/OT").detail], [{ NYG: 21, WSH: 24 }, "Final/OT"]);
  const pre = one("pre", false, "11/15 - 1:00 PM EST");
  assert.equal(pre.score, undefined);
  assert.equal(pre.detail, undefined);
});

test("a player's game carries the score from his side, and the status text", () => {
  const { weekFile } = build();
  weekFile.team_table.rosters.Art[0] = { name: "Pat", id: "p", team: "WSH" };
  const sb = { games: [{ id: "g", teams: ["NYG", "WSH"], home: "NYG", phase: "in", kickoff: "k", score: { NYG: 10, WSH: 17 }, detail: "8:42 - 3rd" }], byeTeams: [] };
  assert.deepEqual(derivePlayers(weekFile, sb, { g: { stats: {}, twoPt: [] } }).p.game, { opp: "NYG", home: false, kickoff: "k", score: { team: 17, opp: 10 }, detail: "8:42 - 3rd" });
});

test("card score line: live shows the clock, done shows Final, a saved week shows Final, none before kickoff", () => {
  const base = { name: "A", team: "WSH", points: 21, stats: { passYds: 300 } };
  const game = { opp: "NYG", home: false, score: { team: 17, opp: 10 } };
  assert.match(renderCard({ ...base, state: "live", game: { ...game, detail: "8:42 - 3rd" } }), /<div class="card-score">WSH 17 – NYG 10 · 8:42 - 3rd<\/div>/);
  assert.match(renderCard({ ...base, state: "final", game: { ...game, detail: "Final/OT" } }), /WSH 17 – NYG 10 · Final\/OT/);
  assert.match(renderCard({ ...base, state: "final", game }), /WSH 17 – NYG 10 · Final</);
  assert.doesNotMatch(renderCard({ ...base, state: "not_started", game: { opp: "NYG", home: false } }), /card-score/);
});

test("recordWeek keeps the final score but not the live status text", () => {
  const { weekFile, playersById } = build({ Art: [5, 0, 0, 0, 0] }, {});
  playersById["T-Art-0"] = { points: 5, state: "final", stats: { passYds: 100 }, game: { opp: "BBB", home: true, kickoff: "k", score: { team: 24, opp: 21 }, detail: "Final" } };
  const out = recordWeek(weekFile, playersById, scoreWeek(weekFile, playersById, league), {});
  assert.deepEqual(out.recorded.players["T-Art-0"].game, { opp: "BBB", home: true, score: { team: 24, opp: 21 } });
});

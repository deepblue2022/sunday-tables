// The 2-pt cross-check: a team's score rising by exactly 8 on one play must come with a credited
// 2-pt conversion (and the reverse); near-miss names against our players are flagged; the
// scorekeeper settles each flagged play with a two_pt_fixes entry in the week file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGame } from "../js/espn.js";
import { derivePlayers, twoPtWarnings, validateWeekFile } from "../js/scoring.js";
import { build, league } from "./helpers.js";

// Scoring plays with running scores; DEN is away, KC home.
const play = (id, text, team, away, home) => ({ id, text, team: { abbreviation: team }, awayScore: away, homeScore: home });

test("parseGame: an 8-point play with no credited 2-pt is flagged, and a credited 2-pt without 8 points", () => {
  const g = parseGame({
    scoringPlays: [
      play(1, "Bo Nix 5 Yd Run (Bo Nix Run for Two-Point Conversion)", "DEN", 8, 0), // fine
      play(2, "Pat Mahomes 3 Yd Run (Some New Wording Two Points Good)", "KC", 8, 8), // missed
      play(3, "X 10 Yd Pass From Y (Bo Nix Pass to Courtland Sutton for Two-Point Conversion)", "DEN", 14, 8), // only +6
      play(4, "Z 40 Yd Field Goal", "KC", 14, 11),
    ],
  });
  assert.deepEqual(g.twoPt.map((t) => [t.name, t.points, t.play]), [["Bo Nix", 2, "1"], ["Bo Nix", 1, "3"], ["Courtland Sutton", 2, "3"]]);
  assert.deepEqual(g.twoPtIssues.map((i) => [i.play, i.team, i.problem]), [
    ["2", "KC", "the score went up by 8 but no 2-pt conversion was credited"],
    ["3", "DEN", "a 2-pt conversion was credited but the score did not go up by 8"],
  ]);
});

test("parseGame: failed tries, defensive 2-pt returns and missing scores raise nothing", () => {
  const ok = parseGame({
    scoringPlays: [
      play(1, "A 5 Yd Run (Two-Point Pass Conversion Failed)", "DEN", 6, 0),
      play(2, "Kelee Ringo Defensive PAT Conversion", "KC", 6, 2),
      play(3, "B 1 Yd Run (C Kick)", "KC", 6, 9),
    ],
  });
  assert.equal(ok.twoPtIssues, undefined);
  // without running scores (e.g. a trimmed response) there is nothing to cross-check
  assert.equal(parseGame({ scoringPlays: [{ text: "A 5 Yd Run (New Words)", team: { abbreviation: "DEN" } }] }).twoPtIssues, undefined);
});

// A week where Art's QB is "Mitchell Trubisky" (BUF) and the game is finished.
function week(phase = "done", fixes) {
  const { weekFile } = build();
  weekFile.team_table.rosters.Art[0] = { name: "Mitchell Trubisky", id: "mt", team: "BUF" };
  weekFile.team_table.rosters.Art[3] = { name: "Aaron Jones Sr.", id: "aj", team: "BUF" };
  if (fixes) weekFile.two_pt_fixes = fixes;
  const scoreboard = { games: [{ id: "g", teams: ["BUF", "MIA"], phase, home: "BUF" }], byeTeams: [] };
  return { weekFile, scoreboard };
}
const summary = (twoPt, twoPtIssues) => ({ g: { stats: { mt: { passYds: 200 } }, twoPt, ...(twoPtIssues ? { twoPtIssues } : {}) } });

test("twoPtWarnings: near-miss names of our players are flagged; others' names and exact matches are not", () => {
  const { weekFile, scoreboard } = week();
  const games = summary([
    { name: "Mitch Trubisky", team: "BUF", points: 1, play: "7" }, // first-name variant
    { name: "Aaron Jones", team: "BUF", points: 2, play: "7" }, // suffix dropped
    { name: "Aaron Jones", team: "MIA", points: 2, play: "8" }, // other team: not ours
    { name: "Someone Else", team: "BUF", points: 2, play: "9" }, // not one of our players
  ]);
  const w = twoPtWarnings(weekFile, scoreboard, games);
  assert.equal(w.length, 2);
  assert.match(w[0], /play 7: the play text credits "Mitch Trubisky" \(BUF\) with 1, which is not exactly our player "Mitchell Trubisky"/);
  assert.match(w[1], /"Aaron Jones" \(BUF\) with 2, which is not exactly our player "Aaron Jones Sr\."/);
  // exact match: nothing to say
  assert.deepEqual(twoPtWarnings(weekFile, scoreboard, summary([{ name: "Mitchell Trubisky", team: "BUF", points: 1, play: "7" }])), []);
});

test("twoPtWarnings: score cross-check issues are reported for finished games only", () => {
  const issue = [{ play: "5", team: "BUF", text: "T", problem: "the score went up by 8 but no 2-pt conversion was credited" }];
  const done = week("done");
  assert.deepEqual(twoPtWarnings(done.weekFile, done.scoreboard, summary([], issue)), [
    'BUF v MIA (game g), play 5: the score went up by 8 but no 2-pt conversion was credited: "T"',
  ]);
  const live = week("in");
  assert.deepEqual(twoPtWarnings(live.weekFile, live.scoreboard, summary([], issue)), []);
});

test("a two_pt_fixes entry settles its play and credits the player; a 0-point entry just marks it checked", () => {
  const issue = [{ play: "5", team: "BUF", text: "T", problem: "p" }];
  const credited = week("done", [{ play: "5", id: "mt", points: 1, reason: "ESPN wording" }]);
  assert.deepEqual(twoPtWarnings(credited.weekFile, credited.scoreboard, summary([], issue)), []);
  const p = derivePlayers(credited.weekFile, credited.scoreboard, summary([], issue)).mt;
  assert.equal(p.points, 10 + 1);
  assert.equal(p.stats.twoPt, 1);

  const checked = week("done", [{ play: "5", id: null, points: 0, reason: "defensive return, nobody of ours" }]);
  assert.deepEqual(twoPtWarnings(checked.weekFile, checked.scoreboard, summary([], issue)), []);
  assert.equal(derivePlayers(checked.weekFile, checked.scoreboard, summary([], issue)).mt.points, 10);
});

test("two_pt_fixes entries are validated", () => {
  const bad = (fixes, re) => assert.throws(() => validateWeekFile(week("done", fixes).weekFile, league), re);
  const { weekFile } = week("done", [{ play: "5", id: "mt", points: 2, reason: "r" }]);
  weekFile.team_table.rosters.Art.forEach((p, i) => { if (!p.id) weekFile.team_table.rosters.Art[i] = { ...p, id: `x${i}` }; });
  bad("nope", /two_pt_fixes must be a list/);
  bad([{ id: "mt", points: 2, reason: "r" }], /needs the scoring play id/);
  bad([{ play: "5", id: "mt", points: 2 }], /needs a reason/);
  bad([{ play: "5", id: "zz", points: 2, reason: "r" }], /player id zz is not on this week's rosters/);
  bad([{ play: "5", id: "mt", points: 3, reason: "r" }], /points must be 1 \(passer\) or 2/);
  bad([{ play: "5", id: null, points: 2, reason: "r" }], /gives points but names no player/);
});

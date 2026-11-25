// The Thanksgiving Day pool (RULES.md rule 6): QB, RB, RB, WR, WR and a kicker from Thanksgiving
// Day games, the five players from different NFL teams (the kicker from any of them); $20 each, highest five-player total takes the
// pot, the kicker (1 per XP, 3 per FG) breaks a tie, still tied splits it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreWeek, validateWeekFile, kickPoints, thanksgivingDate, thanksgivingProblems, derivePlayers } from "../js/scoring.js";
import { parseGame } from "../js/espn.js";
import { renderThanksgiving, renderSettlement, renderCard } from "../js/render.js";
import { resolveDraft, recordWeek, applyPlayedTeams, formatWeek } from "../cli/lib.mjs";
import { build, league, OWNERS } from "./helpers.js";
import { liveBanter } from "../js/banter.js";

const TEAMS = ["CHI", "DET", "PHI", "DAL", "KC", "BUF"];
const COLS = ["QB", "RB", "RB", "WR", "WR", "K"];

// A Thanksgiving week: the usual tables from the helper plus a Thanksgiving table whose players
// are "G-<owner>-<i>" on the six Thanksgiving teams. `pts[owner]` = [QB, RB, RB, WR, WR] points,
// `kick[owner]` = {fgMade, xpMade}.
function week({ pts = {}, kick = {}, states = {} } = {}) {
  const { weekFile, playersById } = build();
  const rosters = {};
  for (const o of OWNERS) {
    rosters[o] = COLS.map((c, i) => ({ name: `${o} G${i}`, id: `G-${o}-${i}`, team: TEAMS[i] }));
    COLS.forEach((c, i) => {
      const id = `G-${o}-${i}`;
      const k = kick[o] ?? {};
      playersById[id] =
        c === "K"
          ? { points: 0, state: states[id] ?? "final", stats: { fgMade: k.fgMade ?? 0, fgAtt: k.fgMade ?? 0, xpMade: k.xpMade ?? 0, xpAtt: k.xpMade ?? 0 } }
          : { points: pts[o]?.[i] ?? 0, state: states[id] ?? "final" };
    });
  }
  weekFile.thanksgiving_table = { columns: COLS, rosters };
  return { weekFile, playersById };
}

test("kickPoints and the Thanksgiving date", () => {
  assert.equal(kickPoints({ fgMade: 2, xpMade: 3 }), 9);
  assert.equal(kickPoints(undefined), 0);
  assert.equal(thanksgivingDate(2026), "2026-11-26");
  assert.equal(thanksgivingDate(2025), "2025-11-27");
  assert.equal(thanksgivingDate(2027), "2027-11-25");
});

test("parseGame reads kickers' field goals and extra points", () => {
  const g = parseGame({
    boxscore: { players: [{ statistics: [{ name: "kicking", keys: ["fieldGoalsMade/fieldGoalAttempts", "fieldGoalPct", "extraPointsMade/extraPointAttempts"], athletes: [{ athlete: { id: 9 }, stats: ["2/3", "66.7", "4/4"] }] }] }] },
  });
  assert.deepEqual(g.stats["9"], { fgMade: 2, fgAtt: 3, xpMade: 4, xpAtt: 4 });
});

test("the highest five-player total takes the $140; the kicker doesn't add to it", () => {
  const { weekFile, playersById } = week({ pts: { Art: [20, 10, 10, 10, 10], Kevin: [20, 10, 10, 10, 9] }, kick: { Kevin: { fgMade: 5 } } });
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.thanksgiving.rows.Art.total, 60);
  assert.equal(r.thanksgiving.rows.Kevin.total, 59); // the 15 kicker points don't count
  assert.equal(r.thanksgiving.rows.Kevin.tiebreak, 15);
  assert.deepEqual(r.thanksgiving.winners, ["Art"]);
  assert.equal(r.thanksgiving.tiedOnTotal, false);
  assert.equal(r.settlement.Art.thanksgiving, 12000);
  assert.equal(r.settlement.Kevin.thanksgiving, -2000);
  // it adds to the week's money, and the week still adds up to $0
  assert.equal(r.settlement.Art.total, r.settlement.Art.lightning + r.settlement.Art.teamPot + 12000);
  assert.equal(OWNERS.reduce((n, o) => n + r.settlement[o].total, 0), 0);
});

test("a tie on the total goes to the better kicker; still tied splits the pot", () => {
  const tied = { Art: [20, 10, 10, 10, 10], Kevin: [20, 10, 10, 10, 10] };
  let r = scoreWeek(...Object.values(week({ pts: tied, kick: { Art: { xpMade: 3 }, Kevin: { fgMade: 1 } } })), league);
  assert.equal(r.thanksgiving.rows.Art.tiebreak, 3);
  assert.equal(r.thanksgiving.rows.Kevin.tiebreak, 3);
  assert.deepEqual(r.thanksgiving.winners, ["Art", "Kevin"]); // 3 v 3: split
  assert.equal(r.settlement.Art.thanksgiving + r.settlement.Kevin.thanksgiving, 2 * (7000 - 2000));
  r = scoreWeek(...Object.values(week({ pts: tied, kick: { Art: { xpMade: 2 }, Kevin: { fgMade: 1 } } })), league);
  assert.deepEqual(r.thanksgiving.winners, ["Kevin"]); // 3 beats 2
  assert.equal(r.thanksgiving.tiedOnTotal, true);
});

test("unanimous picks are fine in the Thanksgiving pool; weeks without it are unchanged", () => {
  const { weekFile, playersById } = week({ pts: { Art: [20] } });
  const star = weekFile.thanksgiving_table.rosters.Art[0];
  for (const o of OWNERS) weekFile.thanksgiving_table.rosters[o][0] = star;
  assert.doesNotThrow(() => scoreWeek(weekFile, playersById, league));
  const plain = build();
  const r = scoreWeek(plain.weekFile, plain.playersById, league);
  assert.equal(r.thanksgiving, undefined);
  assert.equal("thanksgiving" in r.settlement.Art, false);
});

test("the Thanksgiving table is validated like the others", () => {
  const { weekFile } = week();
  weekFile.thanksgiving_table.rosters.Art = weekFile.thanksgiving_table.rosters.Art.slice(0, 5);
  assert.throws(() => validateWeekFile(weekFile, league), /thanksgiving_table: Art has 5 players for 6 columns/);
});

test("live: the pool is provisional while a game or the kicker's game is on", () => {
  const { weekFile, playersById } = week({ pts: { Art: [20] }, states: { "G-Art-5": "live" } });
  const r = scoreWeek(weekFile, playersById, league);
  assert.equal(r.thanksgiving.provisional, true);
  assert.equal(r.final, false);
});

test("rule checks: the five players from different teams (the kicker can share one), all from Thanksgiving Day games", () => {
  const { weekFile } = week();
  assert.deepEqual(thanksgivingProblems(weekFile, league), []);
  // the kicker from the QB's team: allowed
  weekFile.thanksgiving_table.rosters.Art[5] = { ...weekFile.thanksgiving_table.rosters.Art[5], team: "CHI" };
  assert.deepEqual(thanksgivingProblems(weekFile, league), []);
  // two of the five from one team: not allowed (the kicker isn't listed)
  weekFile.thanksgiving_table.rosters.Art[1] = { ...weekFile.thanksgiving_table.rosters.Art[1], team: "CHI" };
  assert.deepEqual(thanksgivingProblems(weekFile, league), ["Thanksgiving Day pool: Art has more than one pick from CHI (Art G0, Art G1)"]);
  // with the week's scoreboard: a pick whose team doesn't play on Thanksgiving Day
  const game = (teams, kickoff) => ({ id: teams.join(""), teams, phase: "pre", kickoff });
  const scoreboard = {
    games: [
      game(["CHI", "DET"], "2026-11-26T17:30Z"),
      game(["PHI", "DAL"], "2026-11-26T21:30Z"),
      game(["KC", "BUF"], "2026-11-27T01:20Z"), // Thursday 8:20 PM Eastern
      game(["GB", "LAR"], "2026-11-26T01:00Z"), // Wednesday 8:00 PM Eastern
    ],
    byeTeams: [],
  };
  const fresh = week().weekFile;
  assert.deepEqual(thanksgivingProblems(fresh, league, scoreboard), []);
  fresh.thanksgiving_table.rosters.Kevin[0] = { name: "Jordan Love", id: "love", team: "GB" };
  assert.deepEqual(thanksgivingProblems(fresh, league, scoreboard), ["Thanksgiving Day pool: Kevin's Jordan Love (GB) isn't playing on Thanksgiving Day"]);
});

test("resolve: the K column looks up kickers; locking in and team corrections keep the table", () => {
  const draft = {
    season: 2026,
    week: 12,
    team_table: { columns: ["QB"], rosters: { Art: ["Pat One"] } },
    lightning_table: { columns: ["QB2"], rosters: { Art: ["Pat One"] } },
    thanksgiving_table: { columns: ["QB", "K"], rosters: { Art: ["Pat One", "Kip Kicker"] } },
  };
  const players = [
    { id: "1", name: "Pat One", team: "DET", pos: "QB" },
    { id: "2", name: "Kip Kicker", team: "BUF", pos: "PK" },
  ];
  const out = resolveDraft(draft, players);
  assert.deepEqual(out.thanksgiving_table.rosters.Art[1], { name: "Kip Kicker", id: "2", team: "BUF" });
  // a kicker can't be resolved into a non-K column
  assert.throws(() => resolveDraft({ ...draft, thanksgiving_table: { columns: ["QB", "RB"], rosters: { Art: ["Pat One", "Kip Kicker"] } } }, players), /Kip Kicker/);
  const { weekFile, playersById } = week({ pts: { Art: [20] } });
  const recorded = recordWeek(weekFile, playersById, scoreWeek(weekFile, playersById, league), {});
  assert.deepEqual(recorded.thanksgiving_table, weekFile.thanksgiving_table);
  assert.equal(recorded.recorded.players["G-Art-5"].stats.fgAtt, 0);
  assert.ok(applyPlayedTeams(weekFile, {}).weekFile.thanksgiving_table);
});

test("the site: the pool's table, its pot line, the settlement column and the kicker's card", () => {
  const { weekFile, playersById } = week({ pts: { Art: [20, 10, 10, 10, 10], Kevin: [20, 10, 10, 10, 10] }, kick: { Kevin: { fgMade: 2, xpMade: 1 } } });
  const r = scoreWeek(weekFile, playersById, league);
  const html = renderThanksgiving(r, league, COLS);
  assert.match(html, /<th>K<span class="note">tiebreak<\/span><\/th>/);
  assert.match(html, /data-card="g\|Kevin\|5"[^>]*><span class="pname">Kevin G5<\/span><span class="pts">7<\/span>/); // kicker box shows the tiebreak
  assert.match(html, /<td class="total">60<\/td>/);
  assert.match(html, /Kevin wins \$140 on the kicker tiebreak/);
  assert.match(renderSettlement(r, league), /data-sort="thanksgiving">Turkey</);
  assert.doesNotMatch(renderSettlement(scoreWeek(build().weekFile, build().playersById, league), league), /Turkey/);
  const card = renderCard({ ...r.thanksgiving.rows.Kevin.players[5] }, "Kevin · Thanksgiving K");
  assert.match(card, /2\/2 FG, 1\/1 XP/);
  assert.match(card, /Tiebreak<\/span><strong>7</);
  assert.equal(renderThanksgiving(scoreWeek(build().weekFile, build().playersById, league), league, COLS), "");
});

test("the CLI prints the pool and its pot", () => {
  const { weekFile, playersById } = week({ pts: { Art: [20, 10, 10, 10, 10] } });
  const r = scoreWeek(weekFile, playersById, league);
  const st = { recordedThrough: 0, base: Object.fromEntries(OWNERS.map((o) => [o, 0])), open: [], totals: Object.fromEntries(OWNERS.map((o) => [o, 0])), order: Object.fromEntries(OWNERS.map((o) => [o, 1])) };
  const text = formatWeek(r, st, league);
  assert.match(text, /== Thanksgiving Day pool ==/);
  assert.match(text, /TOTAL 60 \(K 0\)/);
  assert.match(text, /Pot: Art/);
  assert.match(text, /Thanksgiving pot +\+\$120 +−\$20/); // Art (first column) wins, the rest pay $20
});

test("derivePlayers scores Thanksgiving picks from the games, like the other tables", () => {
  const { weekFile } = week();
  const sb = { games: [{ id: "g", teams: ["CHI", "DET"], home: "DET", phase: "done", kickoff: "2026-11-26T17:30Z" }], byeTeams: [] };
  const players = derivePlayers(weekFile, sb, { g: { stats: { "G-Art-0": { passYds: 300, passTD: 2 } }, twoPt: [] } });
  assert.equal(players["G-Art-0"].points, 15 + 6);
  assert.equal(players["G-Art-0"].state, "final");
});

test("tapping a Thanksgiving player opens the stats card (the page listens on that table too)", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /for \(const id of \[[^\]]*"thanksgiving"[^\]]*\]\)/);
  assert.match(app, /if \(table === "g"\)/);
});

test("pot wording: the kicker is credited only when it decided the pot; all level is said plainly", () => {
  const tied = { Art: [20, 10, 10, 10, 10], Kevin: [20, 10, 10, 10, 10] };
  // kickers tied too: a split, and the kicker didn't decide it
  let { weekFile, playersById } = week({ pts: tied, kick: { Art: { xpMade: 3 }, Kevin: { fgMade: 1 } } });
  let r = scoreWeek(weekFile, playersById, league);
  assert.match(renderThanksgiving(r, league, COLS), /Art &amp; Kevin split \$140 \(kickers tied too\)/);
  const st = { recordedThrough: 0, base: Object.fromEntries(OWNERS.map((o) => [o, 0])), open: [], totals: Object.fromEntries(OWNERS.map((o) => [o, 0])), order: Object.fromEntries(OWNERS.map((o) => [o, 1])) };
  assert.match(formatWeek(r, st, league), /Pot: Art & Kevin \(kickers tied too: split\)/);
  // everyone level: the CLI says so instead of listing all seven
  ({ weekFile, playersById } = week());
  r = scoreWeek(weekFile, playersById, league);
  assert.match(formatWeek(r, st, league), /Pot: all level, returned/);
});

test("the Thanksgiving table needs exactly one K column", () => {
  const { weekFile } = week();
  weekFile.thanksgiving_table.columns = ["QB", "RB", "RB", "WR", "WR", "WR"];
  assert.throws(() => validateWeekFile(weekFile, league), /needs exactly one "K" column/);
  weekFile.thanksgiving_table.columns = ["QB", "RB", "RB", "WR", "K", "K"];
  assert.throws(() => validateWeekFile(weekFile, league), /needs exactly one "K" column/);
});

test("a week counts as started when only the Thanksgiving pool's games are on", async () => {
  const { newState, refresh } = await import("../js/view.js");
  const { API } = await import("../js/espn.js");
  const { weekFile } = week();
  // the main tables' players (team AAA) haven't played; CHI v DET (Thanksgiving picks) is on
  const ev = (id, a, b, state) => ({ id, date: "2026-11-26T17:30Z", status: { type: { state, completed: false } }, competitions: [{ competitors: [{ team: { abbreviation: a } }, { team: { abbreviation: b } }] }] });
  const scoreboard = { events: [ev("1", "AAA", "ZZZ", "pre"), ev("2", "CHI", "DET", "in")] };
  const box = { boxscore: { players: [{ team: { abbreviation: "CHI" }, statistics: [{ name: "passing", keys: ["passingYards"], athletes: [{ athlete: { id: "G-Art-0" }, stats: ["100"] }] }] }] } };
  const baseline = { through_week: 0, totals: Object.fromEntries(OWNERS.map((o) => [o, 0])) };
  const model = await refresh(newState({ league, baseline, weekFiles: [weekFile] }), async (url) =>
    url === `${API}/scoreboard` ? { events: [] } : url.includes("/scoreboard") ? scoreboard : box,
  );
  assert.equal(model.weeks[0].result.team.started, false);
  assert.equal(model.weeks[0].result.thanksgiving.started, true);
  assert.equal(model.weeks[0].started, true);
});


test("the live commentary copes with a Thanksgiving week", () => {
  const { weekFile, playersById } = week({ pts: { Art: [20, 10, 10, 10, 10] }, kick: { Art: { fgMade: 1 } } });
  const r = scoreWeek(weekFile, playersById, league);
  const totals = Object.fromEntries(OWNERS.map((o, i) => [o, i * 100]));
  // before the week: the order reversed, so first and last both change hands
  const base = Object.fromEntries(OWNERS.map((o, i) => [o, -i * 100]));
  const lines = liveBanter({ result: r, standings: { totals, base }, league, weekFile, extra: { onFirst: { [OWNERS.at(-1)]: ["picks the restaurant"] } } });
  assert.ok(Array.isArray(lines) && lines.every((l) => typeof l === "string"));
  assert.ok(lines.includes("picks the restaurant"));
  // the nobody-else line looks at the main Team table only, not the Thanksgiving Day pool
  assert.ok(!lines.some((l) => /Nobody else took|off the board|exactly one Team table/.test(l) && /Art G0/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes(OWNERS.at(-1)) && l.includes(OWNERS[0]) && /first|top/.test(l)), lines.join("\n"));
});

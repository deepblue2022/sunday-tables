// Tests added after the Task 6 review.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDraft, formatWeek, gatherWeeks, assertWeekIdentity, parseArgs } from "../cli/lib.mjs";
import { scoreWeek, standings, validateWeekFile } from "../js/scoring.js";
import { OWNERS, TEAM_COLS, LIGHT_COLS, league, build, week9WeekFile } from "./helpers.js";
import { derivePlayers } from "../js/scoring.js";
import { parseScoreboard, parseGame } from "../js/espn.js";
import { fixture, week9RawGames } from "./helpers.js";

const roster = [
  { id: "1", name: "Kenneth Walker III", team: "KC", pos: "RB" },
  { id: "2", name: "C.J. Stroud", team: "HOU", pos: "QB" },
  { id: "3", name: "DeVonta Smith", team: "PHI", pos: "WR" },
  { id: "4", name: "Josh Allen", team: "BUF", pos: "QB" },
  { id: "5", name: "Myles Garrett", team: "CLE", pos: "DE" },
  { id: "6", name: "Ja'Marr Chase", team: "CIN", pos: "WR" },
  { id: "7", name: "Javonte Williams", team: "DAL", pos: "RB" },
  { id: "8", name: "Jameson Williams", team: "DET", pos: "WR" },
];
const draft = (overrides = {}) => {
  const table = (cols, key) => ({
    columns: cols,
    rosters: Object.fromEntries(OWNERS.map((o) => [o, cols.map((_, i) => (`${key}.${o}.${i}` in overrides ? overrides[`${key}.${o}.${i}`] : "DeVonta Smith"))])),
  });
  return { season: 2026, week: 10, team_table: table(TEAM_COLS, "team"), lightning_table: table(LIGHT_COLS, "light") };
};
const failure = (d, lg) => {
  try {
    resolveDraft(d, roster, lg);
  } catch (err) {
    return err.message;
  }
  assert.fail("resolveDraft should have thrown");
};

test("resolveDraft suggests the ESPN spelling for near misses, and still fails", () => {
  assert.match(failure(draft({ "team.Art.0": "Kenneth Walker" })), /did you mean.*Kenneth Walker III \(KC RB\)/);
  assert.match(failure(draft({ "team.Art.0": "CJ Stroud" })), /did you mean.*C\.J\. Stroud \(HOU QB\)/);
  assert.match(failure(draft({ "team.Art.0": "josh allen " })), /did you mean.*Josh Allen \(BUF QB\)/);
  assert.match(failure(draft({ "team.Art.0": "Ja’Marr Chase" })), /did you mean.*Ja'Marr Chase \(CIN WR\)/);
  // a bare surname lists everyone with that surname
  assert.match(failure(draft({ "team.Art.0": "Williams" })), /did you mean.*Javonte Williams \(DAL RB\).*Jameson Williams \(DET WR\)/);
});

test("resolveDraft explains exact names excluded by team or position", () => {
  assert.match(failure(draft({ "team.Art.0": { name: "Josh Allen", team: "KC" } })), /Josh Allen \(BUF QB\)/);
  assert.match(failure(draft({ "team.Art.0": "Myles Garrett" })), /Myles Garrett \(CLE DE\).*not an offensive player/);
});

test("resolveDraft reports malformed entries and tables instead of crashing", () => {
  assert.match(failure(draft({ "team.Art.0": null })), /team_table Art QB.*not a name/);
  assert.match(failure(draft({ "team.Art.0": { team: "BUF" } })), /team_table Art QB.*not a name/);
  const noTable = draft();
  delete noTable.lightning_table;
  assert.match(failure(noTable), /lightning_table/);
});

test("resolveDraft with a league rejects a draft with a missing owner, an unknown owner, or no week", () => {
  const missing = draft();
  delete missing.lightning_table.rosters.JohnO;
  assert.match(failure(missing, league), /JohnO/);
  const extra = draft();
  extra.team_table.rosters.Bob = extra.team_table.rosters.Art;
  assert.match(failure(extra, league), /Bob/);
  const noWeek = draft();
  delete noWeek.week;
  assert.match(failure(noWeek, league), /week/);
  assert.doesNotThrow(() => resolveDraft(draft(), roster, league));
});

test("validateWeekFile requires an integer season and week", () => {
  const { weekFile } = build();
  delete weekFile.week;
  assert.throws(() => validateWeekFile(weekFile, league), /season and week/);
});

test("assertWeekIdentity refuses a week file whose season or week differs from its index entry", () => {
  const { weekFile } = build(); // season 2026, week 9
  assert.doesNotThrow(() => assertWeekIdentity(weekFile, 2026, 9, "2026-09.json"));
  assert.throws(() => assertWeekIdentity(weekFile, 2026, 10, "2026-10.json"), /2026-10\.json.*week 9/);
  assert.throws(() => assertWeekIdentity(weekFile, 2025, 9, "2025-09.json"), /2025-09\.json/);
});

test("gatherWeeks: a broken other week becomes an unloaded open week with a warning", async () => {
  const { weekFile, playersById } = build();
  const good = { weekFile, players: playersById, result: scoreWeek(weekFile, playersById, league), errors: [] };
  const load = async (entry) => {
    if (entry.week === 10) throw new Error("ENOENT 2026-10.json");
    return good;
  };
  const g = await gatherWeeks([{ season: 2026, week: 9 }, { season: 2026, week: 10 }], 9, load);
  assert.equal(g.selected, good);
  assert.deepEqual(g.weeks[1], { week: 10, recorded: false, final: false, settlement: null });
  assert.equal(g.weeks[0].settlement, good.result.settlement);
  assert.equal(g.warnings.length, 1);
  assert.match(g.warnings[0], /week 10.*ENOENT/);
});

test("gatherWeeks: a failure loading the selected week is an error", async () => {
  const load = async () => {
    throw new Error("boom");
  };
  await assert.rejects(gatherWeeks([{ season: 2026, week: 9 }], 9, load), /boom/);
});

test("parseArgs accepts the three commands and rejects anything else", () => {
  assert.deepEqual(parseArgs(["2026", "9"]), { cmd: "week", season: 2026, week: 9, record: false });
  assert.deepEqual(parseArgs(["2026", "9", "--record"]), { cmd: "week", season: 2026, week: 9, record: true });
  assert.deepEqual(parseArgs(["resolve", "d.json"]), { cmd: "resolve", draft: "d.json", out: null });
  assert.deepEqual(parseArgs(["resolve", "d.json", "--out", "w.json"]), { cmd: "resolve", draft: "d.json", out: "w.json" });
  for (const bad of [[], ["2026"], ["2026", "9", "--recrod"], ["resolve"], ["resolve", "d.json", "--out"], ["resolve", "d.json", "--force"], ["2026", "9", "extra"]]) {
    assert.equal(parseArgs(bad), null, JSON.stringify(bad));
  }
});

// --- exact output for the recorded Week 9 data ---

const recorded = JSON.parse(readFileSync(new URL("../data/weeks/2026-09.json", import.meta.url), "utf8"));
const realLeague = JSON.parse(readFileSync(new URL("../data/league.json", import.meta.url), "utf8"));
const baseline = JSON.parse(readFileSync(new URL("./fixtures/baseline-wk8.json", import.meta.url), "utf8"));

test("the recorded Week 9 file holds exactly the rosters and player results the fixtures give", () => {
  const fromFixtures = week9WeekFile();
  assert.deepEqual(recorded.team_table, fromFixtures.team_table);
  assert.deepEqual(recorded.lightning_table, fromFixtures.lightning_table);
  const scoreboard = parseScoreboard(fixture("2026-09/scoreboard.json"));
  const gamesById = Object.fromEntries(Object.entries(week9RawGames()).map(([id, raw]) => [id, parseGame(raw)]));
  // Points, state and stat line must match exactly. Game details are left out: the trimmed
  // fixtures do not say which team was at home, the real recording does.
  const core = (players) =>
    Object.fromEntries(Object.entries(players).map(([id, { points, state, stats }]) => [id, { points, state, ...(stats ? { stats } : {}) }]));
  assert.deepEqual(core(recorded.recorded.players), core(derivePlayers(fromFixtures, scoreboard, gamesById)));
});

test("formatWeek puts every amount under the right owner (recorded Week 9)", () => {
  const result = scoreWeek(recorded, recorded.recorded.players, realLeague);
  const s = standings(baseline, [{ week: 9, recorded: true, final: true, settlement: result.settlement }], realLeague);
  const lines = formatWeek(result, s, realLeague).split("\n").map((l) => l.trimEnd().split(/\s{2,}/));
  const row = (label) => lines.find((l) => l[0] === label);
  const m = "−";
  assert.deepEqual(lines.find((l) => l[0] === "" && l[1] === "Art"), ["", "Art", "Mxue", "Vince", "Kevin", "Galli", "JD", "JohnO"]);
  assert.deepEqual(lines.findLast((l) => l[0] === "QB3"), ["QB3", `${m}$38`, `${m}$30`, `${m}$38`, "+$100", `${m}$60`, "+$100", `${m}$34`]);
  assert.deepEqual(row("Week"), ["Week", `${m}$60`, "+$448", `${m}$196`, `${m}$42`, "+$106", `${m}$72`, `${m}$184`]);
  assert.deepEqual(row("Thru Wk 9"), ["Thru Wk 9", "+$74", "+$230", `${m}$726`, `${m}$134`, `${m}$352`, "+$500", "+$408"]);
  assert.deepEqual(row("Total"), row("Thru Wk 9").with(0, "Total"));
  assert.deepEqual(row("Order"), ["Order", "4", "5", "1", "3", "2", "7", "6"]);
});

test("formatWeek shows a dash for players who have not started", () => {
  const states = {};
  for (const o of OWNERS) states[`L-${o}-0`] = "not_started";
  const { weekFile, playersById } = build({}, {}, states);
  const result = scoreWeek(weekFile, playersById, league);
  const flat = { through_week: 8, totals: Object.fromEntries(OWNERS.map((o) => [o, 0])) };
  const text = formatWeek(result, standings(flat, [], league), league);
  assert.match(text, /RB2 \(provisional\)\s+not started\s+Art:L0=-/);
});

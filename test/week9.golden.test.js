import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derivePlayers, scoreWeek, standings } from "../js/scoring.js";
import { parseScoreboard, parseGame } from "../js/espn.js";
import { OWNERS, LIGHT_COLS, league, fixture, week9RawGames, week9WeekFile } from "./helpers.js";

const baseline = { through_week: 8, totals: { JD: 572, Galli: -458, Art: 134, Mxue: -218, Vince: -530, JohnO: 592, Kevin: -92 } };

function week9() {
  const weekFile = week9WeekFile();
  const scoreboard = parseScoreboard(fixture("2026-09/scoreboard.json"));
  const gamesById = Object.fromEntries(Object.entries(week9RawGames()).map(([id, raw]) => [id, parseGame(raw)]));
  const players = derivePlayers(weekFile, scoreboard, gamesById);
  return { weekFile, players, result: scoreWeek(weekFile, players, league) };
}

// Lightning points per column and owner, read from the saved output of the old scorer.
function goldenLightning() {
  const lines = readFileSync(new URL("../docs/specs/week9-golden.txt", import.meta.url), "utf8").split("\n");
  const out = {};
  for (const col of LIGHT_COLS) {
    const line = lines.find((l) => l.startsWith(`${col} `));
    out[col] = Object.fromEntries([...line.matchAll(/(\w+):[^=\s]+=(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  }
  return out;
}

test("Week 9 is final and every rostered player has a final state", () => {
  const { players, result } = week9();
  assert.equal(result.final, true);
  assert.ok(Object.values(players).every((p) => p.state === "final"));
});

test("Week 9 team table matches the hand-checked totals", () => {
  const { result } = week9();
  const totals = Object.fromEntries(OWNERS.map((o) => [o, result.team.rows[o].total]));
  assert.deepEqual(totals, { Art: 73, Mxue: 104, Vince: 106, Kevin: 105, Galli: 115, JD: 87, JohnO: 106 });
  assert.deepEqual(result.team.winners, ["Galli"]);
});

test("Week 9 lightning: all 49 player scores match the old scorer's output", () => {
  const { result } = week9();
  const golden = goldenLightning();
  let cells = 0;
  for (const col of result.lightning.columns) {
    assert.equal(Object.keys(golden[col.name]).length, 7, col.name);
    for (const o of OWNERS) {
      assert.equal(col.cells[o].points, golden[col.name][o], `${col.name} ${o} ${col.cells[o].name}`);
      cells++;
    }
  }
  assert.equal(cells, 49);
});

test("Week 9 lightning winners and net", () => {
  const { result } = week9();
  const winners = Object.fromEntries(result.lightning.columns.map((c) => [c.name, c.winners]));
  assert.deepEqual(winners, { RB2: ["Mxue"], QB2: ["Mxue"], QB3: ["Kevin", "JD"], QB4: ["Galli"], WR2: ["Mxue"], WR3: ["Mxue"], RB3: ["Art"] });
  assert.deepEqual(result.lightning.net, { Art: -4000, Mxue: 46800, Vince: -17600, Kevin: -2200, Galli: -1400, JD: -5200, JohnO: -16400 });
});

test("Week 9 settlement and accumulated standings", () => {
  const { result } = week9();
  const totals = Object.fromEntries(OWNERS.map((o) => [o, result.settlement[o].total]));
  assert.deepEqual(totals, { Art: -6000, Mxue: 44800, Vince: -19600, Kevin: -4200, Galli: 10600, JD: -7200, JohnO: -18400 });
  const s = standings(baseline, [{ week: 9, recorded: true, final: true, settlement: result.settlement }], league);
  assert.deepEqual(s.totals, { JD: 50000, JohnO: 40800, Mxue: 23000, Art: 7400, Kevin: -13400, Galli: -35200, Vince: -72600 });
});

test("Week 9 team table: all 35 player scores match the old scorer's output", () => {
  const { result } = week9();
  const lines = readFileSync(new URL("../docs/specs/week9-golden.txt", import.meta.url), "utf8").split("\n");
  let cells = 0;
  for (const o of OWNERS) {
    const line = lines.find((l) => l.startsWith(`${o} `) && l.includes("TOTAL="));
    const golden = [...line.matchAll(/\s[^=\s]+=(\d+)/g)].map((m) => Number(m[1])).slice(0, 5);
    assert.equal(golden.length, 5, o);
    result.team.rows[o].players.forEach((p, i) => {
      assert.equal(p.points, golden[i], `${o} ${p.name}`);
      cells++;
    });
  }
  assert.equal(cells, 35);
});

test("the recorded Week 9 data file gives the same results as the fixtures", () => {
  const recorded = JSON.parse(readFileSync(new URL("../data/weeks/2026-09.json", import.meta.url), "utf8"));
  const realLeague = JSON.parse(readFileSync(new URL("../data/league.json", import.meta.url), "utf8"));
  const fromFile = scoreWeek(recorded, recorded.recorded.players, realLeague);
  const { result } = week9();
  assert.equal(fromFile.final, true);
  assert.deepEqual(fromFile.settlement, result.settlement);
  assert.deepEqual(fromFile.team.winners, ["Galli"]);
  assert.equal(Object.keys(recorded.recorded.players).length, 49 + 12); // 49 lightning players + 12 distinct team-table players
});

// League rules the scorekeeper's tools check (RULES.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onEveryTeamTable } from "../js/scoring.js";
import { build, league, OWNERS } from "./helpers.js";

test("rule 3: a player on all seven Team tables is flagged; six is fine; shared_ok allows it", () => {
  const { weekFile } = build();
  assert.deepEqual(onEveryTeamTable(weekFile, league), []);
  const star = { name: "Ja'Marr Chase", id: "chase", team: "CIN" };
  OWNERS.slice(0, 6).forEach((o) => (weekFile.team_table.rosters[o][3] = star));
  assert.deepEqual(onEveryTeamTable(weekFile, league), []); // six of seven: allowed
  weekFile.team_table.rosters.JohnO[3] = star;
  assert.deepEqual(onEveryTeamTable(weekFile, league), ["Ja'Marr Chase"]);
  weekFile.team_table.shared_ok = true; // an agreed one-off exception (not the Thanksgiving pool: it is never checked)
  assert.deepEqual(onEveryTeamTable(weekFile, league), []);
});

test("every week so far follows rule 3", () => {
  const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), "utf8"));
  const realLeague = read("league.json");
  for (const w of read("weeks/index.json")) {
    const f = read(`weeks/${w.season}-${String(w.week).padStart(2, "0")}.json`);
    assert.deepEqual(onEveryTeamTable(f, realLeague), [], `week ${w.week}`);
  }
});

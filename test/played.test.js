// A week resolved after its games were played must use the team each player was on that week,
// not the team whose roster he is on today (a traded player would otherwise score 0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { playedTeams } from "../js/espn.js";
import { applyPlayedTeams } from "../cli/lib.mjs";
import { week9RawGames, week9WeekFile } from "./helpers.js";

test("playedTeams maps every athlete in a box score to the team he played for", () => {
  const all = Object.assign({}, ...Object.values(week9RawGames()).map(playedTeams));
  assert.equal(all["3918298"], "BUF"); // Josh Allen
  assert.equal(all["4262921"], "MIN"); // Justin Jefferson
  assert.deepEqual(playedTeams({}), {});
});

test("applyPlayedTeams moves a player to the team he played for, in both tables", () => {
  const before = week9WeekFile();
  const snapshot = JSON.stringify(before);
  const { weekFile, changes } = applyPlayedTeams(before, { "3918298": "ARI", "4262921": "MIN", "999": "DAL" });
  assert.deepEqual(changes, [{ name: "Josh Allen", from: "BUF", to: "ARI" }]);
  const entries = ["team_table", "lightning_table"].flatMap((t) => Object.values(weekFile[t].rosters).flat());
  const allens = entries.filter((p) => p.id === "3918298");
  assert.ok(allens.length > 1);
  assert.ok(allens.every((p) => p.team === "ARI"));
  assert.ok(entries.filter((p) => p.id !== "3918298").every((p) => p.team !== "ARI" || p.name !== "Josh Allen"));
  assert.equal(JSON.stringify(before), snapshot, "input is not modified");
});

test("applyPlayedTeams changes nothing when everyone played for his listed team", () => {
  const before = week9WeekFile();
  const { weekFile, changes } = applyPlayedTeams(before, { "3918298": "BUF" });
  assert.deepEqual(changes, []);
  assert.deepEqual(weekFile, before);
});

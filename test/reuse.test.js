// A refresh reuses recorded week files already loaded instead of downloading them again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keptRecorded } from "../js/view.js";

const recorded = { season: 2026, week: 8, recorded: { players: {} } };
const open = { season: 2026, week: 9 };
const previous = { weekFiles: [recorded, open] };

test("a recorded week already loaded is reused", () => {
  assert.equal(keptRecorded({ season: 2026, week: 8 }, previous), recorded);
});

test("an unrecorded week is always downloaded again, so recording it shows up", () => {
  assert.equal(keptRecorded({ season: 2026, week: 9 }, previous), null);
});

test("a newly listed week, another season, or no previous load means download", () => {
  assert.equal(keptRecorded({ season: 2026, week: 10 }, previous), null);
  assert.equal(keptRecorded({ season: 2025, week: 8 }, previous), null);
  assert.equal(keptRecorded({ season: 2026, week: 8 }, null), null);
});

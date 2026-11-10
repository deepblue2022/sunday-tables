// Test utilities: build a league, a week file and playersById from plain point lists.
export const OWNERS = ["Art", "Mxue", "Vince", "Kevin", "Galli", "JD", "JohnO"];
export const league = {
  name: "Test League",
  owners: OWNERS.map((key) => ({ key, display: key })),
  teamBuyInCents: 2000,
  lightningCentsPerPoint: 200,
};
export const TEAM_COLS = ["QB", "RB", "RB", "WR", "WR"];
export const LIGHT_COLS = ["RB2", "QB2", "QB3", "QB4", "WR2", "WR3", "RB3"];

// teamPts / lightPts: {owner: [points...]}; missing owners get zeros.
// Every player gets a unique id "T-<owner>-<i>" / "L-<owner>-<i>" and state "final" unless overridden in `states`.
export function build(teamPts = {}, lightPts = {}, states = {}) {
  const playersById = {};
  const table = (prefix, cols, pts) => {
    const rosters = {};
    for (const o of OWNERS) {
      rosters[o] = cols.map((_, i) => {
        const id = `${prefix}-${o}-${i}`;
        const state = states[id] ?? "final";
        playersById[id] = { points: pts[o]?.[i] ?? 0, state };
        return { name: `${o} ${prefix}${i}`, id, team: "AAA" };
      });
    }
    return { columns: cols, rosters };
  };
  const weekFile = {
    season: 2026,
    week: 9,
    team_table: table("T", TEAM_COLS, teamPts),
    lightning_table: table("L", LIGHT_COLS, lightPts),
  };
  return { weekFile, playersById };
}

// {owner: pts} for one lightning column index -> lightPts argument for build().
export function column(index, byOwner) {
  const out = {};
  for (const o of OWNERS) {
    out[o] = LIGHT_COLS.map((_, i) => (i === index ? byOwner[o] : 0));
  }
  return out;
}

// --- Week 9 2026 fixtures ---
import { readFileSync, readdirSync } from "node:fs";

const FIX = new URL("./fixtures/", import.meta.url);
export const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIX)));

// Raw game fixtures for Week 9, keyed by event id.
export function week9RawGames() {
  const out = {};
  for (const f of readdirSync(new URL("2026-09/", FIX))) {
    const m = f.match(/^game-(\d+)\.json$/);
    if (m) out[m[1]] = fixture(`2026-09/${f}`);
  }
  return out;
}

// The Week 9 draft with each name given the id and team found in the fixture box scores,
// so tests stay off the network (the real resolver is cli/lib.mjs).
export function week9WeekFile() {
  const found = {};
  for (const raw of Object.values(week9RawGames())) {
    for (const t of raw.boxscore.players) {
      for (const s of t.statistics) {
        for (const a of s.athletes) {
          (found[a.athlete.displayName] ??= new Map()).set(a.athlete.id, t.team.abbreviation);
        }
      }
    }
  }
  const draft = fixture("2026-09/week-draft.json");
  const resolve = (name) => {
    const hits = [...(found[name] ?? [])];
    if (hits.length !== 1) throw new Error(`fixture lookup for ${name}: ${hits.length} matches`);
    return { name, id: hits[0][0], team: hits[0][1] };
  };
  for (const t of ["team_table", "lightning_table"]) {
    for (const o of Object.keys(draft[t].rosters)) draft[t].rosters[o] = draft[t].rosters[o].map(resolve);
  }
  return draft;
}

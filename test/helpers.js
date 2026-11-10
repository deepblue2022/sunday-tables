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

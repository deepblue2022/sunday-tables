// Pure helpers for the CLI: name resolution, recording, and plain-text output.
import { fmtMoney, STATE_TAG, showsDash } from "../js/render.js";

const TABLES = ["team_table", "lightning_table"];
const OFFENCE = ["QB", "RB", "WR", "TE", "FB"];
const SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV"];
const rostered = (weekFile) => TABLES.flatMap((t) => Object.values(weekFile[t].rosters).flat());
const unique = (players) => [...new Map(players.map((p) => [p.id, p])).values()];

// Turn a draft (full names, or {name, team}) into a week file with ESPN name, id and team.
// Never guesses: every entry that matches no player, or more than one, is reported in one error.
export function resolveDraft(draft, rosterPlayers) {
  const pool = rosterPlayers.filter((p) => OFFENCE.includes(p.pos));
  const problems = [];
  const out = { season: draft.season, week: draft.week };
  for (const t of TABLES) {
    const rosters = {};
    for (const [owner, entries] of Object.entries(draft[t].rosters)) {
      rosters[owner] = entries.map((entry, i) => {
        const want = typeof entry === "string" ? { name: entry } : entry;
        const hits = pool.filter((p) => p.name === want.name && (!want.team || p.team === want.team));
        if (hits.length === 1) return { name: hits[0].name, id: hits[0].id, team: hits[0].team };
        const where = `${t} ${owner} ${draft[t].columns[i]}`;
        const found = hits.length
          ? `matches ${hits.length} players: ${hits.map((p) => `${p.name} (${p.team} ${p.pos})`).join(", ")} - add "team" to the entry`
          : "matches no QB/RB/WR/TE/FB on any roster";
        problems.push(`${where}: "${want.name}"${want.team ? ` (${want.team})` : ""} ${found}`);
        return null;
      });
    }
    out[t] = { columns: draft[t].columns, rosters };
  }
  if (problems.length) throw new Error(`Could not resolve ${problems.length} player(s):\n  ${problems.join("\n  ")}`);
  return out;
}

// Rostered players whose current ESPN team (currentTeams[id]) differs from the week file's.
export function teamMismatches(weekFile, currentTeams) {
  return unique(rostered(weekFile))
    .filter((p) => currentTeams[p.id] !== undefined && currentTeams[p.id] !== p.team)
    .map((p) => ({ name: p.name, id: p.id, team: p.team, current: currentTeams[p.id] }));
}

// Rostered players scored as a zero for not playing (did not play, or bye).
export function zeros(weekFile, playersById) {
  return unique(rostered(weekFile))
    .filter((p) => ["dnp", "bye"].includes(playersById[p.id]?.state))
    .map((p) => ({ name: p.name, team: p.team, state: playersById[p.id].state }));
}

// Freeze a final week: returns a copy of the week file with recorded.players filled in.
export function recordWeek(weekFile, playersById, result, currentTeams) {
  if (weekFile.recorded) throw new Error(`Week ${weekFile.week} is already recorded`);
  if (!result.final) throw new Error(`Week ${weekFile.week} is not final yet`);
  // A player with a stat line demonstrably played for the team on file. Only a zero is suspect:
  // if that player is now on another team, the zero may come from looking at the wrong game.
  const suspect = teamMismatches(weekFile, currentTeams).filter((m) => playersById[m.id]?.state !== "final");
  if (suspect.length) {
    const list = suspect.map((m) => `${m.name}: week file says ${m.team}, ESPN now says ${m.current}`).join("\n  ");
    throw new Error(`Week ${weekFile.week}: check these players' teams before recording:\n  ${list}`);
  }
  const players = {};
  for (const p of rostered(weekFile)) {
    const r = playersById[p.id];
    players[p.id] = { points: r.points, state: r.state };
  }
  return { ...weekFile, recorded: { players } };
}

const pad = (s, n) => String(s).padEnd(n);
const short = (name) => name.split(" ").filter((w) => !SUFFIXES.includes(w)).pop();
const cellText = (c) => {
  const tag = STATE_TAG[c.state] ? ` ${STATE_TAG[c.state]}` : "";
  return `${short(c.name)}=${showsDash(c.state) ? "-" : c.points}${tag}`;
};
const flag = (provisional) => (provisional ? " (provisional)" : "");

// Plain-text report of a scored week plus the standings.
export function formatWeek(result, standings, league) {
  const owners = league.owners;
  const lines = [];
  const moneyRow = (label, byOwner) => `${pad(label, 20)}${owners.map((o) => pad(fmtMoney(byOwner[o.key]), 10)).join("")}`;
  const header = `${pad("", 20)}${owners.map((o) => pad(o.display, 10)).join("")}`;

  lines.push(`== Team table${flag(result.team.provisional)} ==`);
  for (const o of owners) {
    const row = result.team.rows[o.key];
    lines.push(`${pad(o.display, 8)}${row.players.map((c) => pad(cellText(c), 20)).join("")}TOTAL ${row.total}`);
  }
  lines.push(result.team.winners.length ? `Pot: ${result.team.winners.join(" & ")}` : "Pot: not started");

  lines.push("", "== Lightning table ==");
  for (const col of result.lightning.columns) {
    const winner = !col.winners.length
      ? "not started"
      : col.winners.length === owners.length
        ? "all tied"
        : `winner ${col.winners.join(" & ")}`;
    const cells = owners.map((o) => `${o.key}:${cellText(col.cells[o.key])}`).join("  ");
    lines.push(`${pad(col.name + flag(col.provisional), 20)}${pad(winner, 22)}${cells}`);
  }
  lines.push("", header);
  for (const col of result.lightning.columns) lines.push(moneyRow(col.name, col.money));

  lines.push("", `== Settlement${flag(!result.final)} ==`, header);
  const part = (k) => Object.fromEntries(owners.map((o) => [o.key, result.settlement[o.key][k]]));
  lines.push(moneyRow("Lightning", part("lightning")), moneyRow("Team pot", part("teamPot")), moneyRow("Week", part("total")));

  lines.push("", "== Standings ==", header, moneyRow(`Thru Wk ${standings.recordedThrough}`, standings.base));
  for (const w of standings.open) {
    lines.push(w.amounts ? moneyRow(`Wk ${w.week}${flag(w.provisional)}`, w.amounts) : `Wk ${w.week}: could not be loaded`);
  }
  lines.push(moneyRow("Total", standings.totals));
  lines.push(`${pad("Order", 20)}${owners.map((o) => pad(standings.order[o.key], 10)).join("")}`);
  return lines.join("\n");
}

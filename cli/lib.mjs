// Pure helpers for the CLI: name resolution, recording, and plain-text output.
import { fmtMoney, STATE_TAG, showsDash } from "../js/render.js";
import { validateWeekFile } from "../js/scoring.js";

const TABLES = ["team_table", "lightning_table"];
const OFFENCE = ["QB", "RB", "WR", "TE", "FB"];
const SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV"];
const rostered = (weekFile) => TABLES.flatMap((t) => Object.values(weekFile[t].rosters).flat());
const unique = (players) => [...new Map(players.map((p) => [p.id, p])).values()];

const describe = (p) => `${p.name} (${p.team} ${p.pos})`;
// Lowercase, no punctuation, no generational suffix: "C.J. Stroud" and "CJ Stroud" compare equal.
const norm = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .split(/\s+/)
    .filter((w) => w && !["jr", "sr", "ii", "iii", "iv"].includes(w))
    .join(" ");
const surname = (name) => norm(name).split(" ").pop();

// Why a name matched nobody, with the closest real players so the draft can be corrected.
function noMatch(want, pool, everyone) {
  const parts = ["matches no QB/RB/WR/TE/FB on any roster"];
  const exact = everyone.filter((p) => p.name === want.name);
  const offence = exact.filter((p) => OFFENCE.includes(p.pos));
  if (offence.length) parts.push(`found ${offence.map(describe).join(", ")} on another team`);
  const others = exact.filter((p) => !OFFENCE.includes(p.pos));
  if (others.length) parts.push(`${others.map(describe).join(", ")} is not an offensive player`);
  const near = pool.filter((p) => p.name !== want.name && (norm(p.name) === norm(want.name) || surname(p.name) === surname(want.name)));
  if (near.length) parts.push(`did you mean ${near.slice(0, 10).map(describe).join(", ")}?`);
  return parts.join("; ");
}

// Turn a draft (full names, or {name, team}) into a week file with ESPN name, id and team.
// Never guesses: every entry that matches no player, or more than one, is reported in one error.
// With a league, the resolved file is also validated (owners, roster sizes, season and week).
export function resolveDraft(draft, rosterPlayers, league) {
  const pool = rosterPlayers.filter((p) => OFFENCE.includes(p.pos));
  const problems = [];
  const out = { season: draft.season, week: draft.week };
  for (const t of TABLES) {
    if (!Array.isArray(draft[t]?.columns) || !draft[t].rosters) {
      problems.push(`${t} is missing`);
      continue;
    }
    const rosters = {};
    for (const [owner, entries] of Object.entries(draft[t].rosters)) {
      rosters[owner] = (Array.isArray(entries) ? entries : []).map((entry, i) => {
        const where = `${t} ${owner} ${draft[t].columns[i] ?? `slot ${i + 1}`}`;
        const want = typeof entry === "string" ? { name: entry } : entry;
        if (typeof want?.name !== "string" || !want.name) {
          problems.push(`${where}: entry is not a name`);
          return null;
        }
        const hits = pool.filter((p) => p.name === want.name && (!want.team || p.team === want.team));
        if (hits.length === 1) return { name: hits[0].name, id: hits[0].id, team: hits[0].team };
        const found = hits.length
          ? `matches ${hits.length} players: ${hits.map(describe).join(", ")} - add "team" to the entry`
          : noMatch(want, pool, rosterPlayers);
        problems.push(`${where}: "${want.name}"${want.team ? ` (${want.team})` : ""} ${found}`);
        return null;
      });
    }
    out[t] = { columns: draft[t].columns, rosters };
  }
  if (problems.length) throw new Error(`Could not resolve ${problems.length} player(s):\n  ${problems.join("\n  ")}`);
  if (league) validateWeekFile(out, league);
  return out;
}

// Rostered players whose current ESPN team (currentTeams[id]) differs from the week file's.
// `played` maps athlete id -> the team he played for in this week's games. A player whose listed
// team (from today's rosters) differs is moved to the team he actually played for, so a week
// resolved after a trade still finds his stats. Returns a new week file and the changes made.
export function applyPlayedTeams(weekFile, played) {
  const changes = [];
  const seen = new Set();
  const fix = (p) => {
    const team = played[p.id];
    if (!team || team === p.team) return p;
    if (!seen.has(p.id)) changes.push({ name: p.name, from: p.team, to: team });
    seen.add(p.id);
    return { ...p, team };
  };
  const table = (t) => ({ ...t, rosters: Object.fromEntries(Object.entries(t.rosters).map(([o, r]) => [o, r.map(fix)])) });
  return {
    weekFile: { ...weekFile, team_table: table(weekFile.team_table), lightning_table: table(weekFile.lightning_table) },
    changes,
  };
}

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
    if (r.stats) players[p.id].stats = r.stats;
    if (r.game) {
      // the final score is kept; the kickoff time and live status text are not
      players[p.id].game = { opp: r.game.opp, home: r.game.home };
      if (r.game.score) players[p.id].game.score = r.game.score;
    }
  }
  return { ...weekFile, recorded: { players } };
}

const pad = (s, n) => String(s).padEnd(n);
const short = (name) => name.split(" ").filter((w) => !SUFFIXES.includes(w)).pop();
const cellText = (c) => {
  const tag = STATE_TAG[c.state] ? ` ${STATE_TAG[c.state]}` : "";
  return `${short(c.name)}=${showsDash(c.state) ? "-" : c.points}${c.override ? "*" : ""}${tag}`;
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

// A week file must be the week its index entry and file name say it is.
export function assertWeekIdentity(weekFile, season, week, fileName) {
  if (weekFile.season !== season || weekFile.week !== week) {
    throw new Error(`${fileName} says season ${weekFile.season} week ${weekFile.week}, but it is listed as season ${season} week ${week}`);
  }
}

// Load and score every listed week for the standings. `load(entry)` resolves to
// {weekFile, players, result, errors}. A failure in the selected week is an error; a failure
// in any other week leaves that week open with no amounts, and adds a warning.
export async function gatherWeeks(entries, selectedWeek, load) {
  const weeks = [];
  const warnings = [];
  let selected = null;
  for (const entry of entries) {
    try {
      const scored = await load(entry);
      weeks.push({
        week: entry.week,
        recorded: Boolean(scored.weekFile.recorded),
        final: scored.result.final,
        settlement: scored.result.settlement,
      });
      if (entry.week === selectedWeek) selected = scored;
    } catch (err) {
      if (entry.week === selectedWeek) throw err;
      weeks.push({ week: entry.week, recorded: false, final: false, settlement: null });
      warnings.push(`week ${entry.week} could not be loaded and is left out of the standings: ${err.message}`);
    }
  }
  return { weeks, selected, warnings };
}

// Command line -> {cmd: "week", season, week, record} | {cmd: "resolve", draft, out} | null (usage).
export function parseArgs(args) {
  if (args[0] === "resolve") {
    const [, draft, flag, out, ...rest] = args;
    if (!draft || draft.startsWith("--") || rest.length) return null;
    if (flag === undefined) return { cmd: "resolve", draft, out: null };
    return flag === "--out" && out ? { cmd: "resolve", draft, out } : null;
  }
  const [season, week, flag, ...rest] = args;
  if (!/^\d{4}$/.test(season ?? "") || !/^\d{1,2}$/.test(week ?? "") || rest.length) return null;
  if (flag !== undefined && flag !== "--record") return null;
  return { cmd: "week", season: Number(season), week: Number(week), record: flag === "--record" };
}

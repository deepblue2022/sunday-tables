// Pure scoring engine: no I/O. Runs in the browser and in Node. All money is integer cents.

export const BLOCKING = ["live", "not_started", "unknown"];
// States that mean a player's game has kicked off (bye and unknown do not start a contest).
const STARTED = ["live", "final", "dnp"];
const STATES = ["final", "dnp", "bye", "live", "not_started", "unknown"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const yards = (v, per) => Math.floor(Math.max(num(v), 0) / per);

export function playerPoints(statLine, twoPt = 0) {
  const s = statLine || {};
  return (
    yards(s.passYds, 20) + yards(s.rushYds, 10) + yards(s.recYds, 10) +
    3 * num(s.passTD) + 6 * (num(s.rushTD) + num(s.recTD)) + num(twoPt)
  );
}

// Split totalCents among winners; leftover cents go one each in ownerOrder.
export function splitCents(totalCents, winners, ownerOrder) {
  const ordered = ownerOrder.filter((o) => winners.includes(o));
  if (!ordered.length || ordered.length !== new Set(winners).size) {
    throw new Error(`splitCents: winners [${winners}] must be non-empty and all in the owner order`);
  }
  const share = Math.floor(totalCents / ordered.length);
  let left = totalCents - share * ordered.length;
  const out = {};
  for (const o of ordered) out[o] = share + (left-- > 0 ? 1 : 0);
  return out;
}

const TABLES = ["team_table", "lightning_table"];
const isText = (v) => typeof v === "string" && v !== "";
const weekLabel = (weekFile) => `${weekFile?.season}-${weekFile?.week}`;

// Throws if any league owner is missing from a table or a roster doesn't fit its columns.
export function validateWeekFile(weekFile, league) {
  const problems = [];
  if (!Number.isInteger(weekFile?.season) || !Number.isInteger(weekFile?.week)) {
    problems.push("needs an integer season and week");
  }
  for (const t of TABLES) {
    const table = weekFile?.[t];
    if (!Array.isArray(table?.columns) || !table.rosters) {
      problems.push(`${t} is missing`);
      continue;
    }
    const keys = league.owners.map((o) => o.key);
    for (const extra of Object.keys(table.rosters).filter((k) => !keys.includes(k))) {
      problems.push(`${t}: ${extra} is not a league owner`);
    }
    for (const key of keys) {
      const roster = table.rosters[key];
      if (!Array.isArray(roster)) problems.push(`${t}: no roster for ${key}`);
      else if (roster.length !== table.columns.length) {
        problems.push(`${t}: ${key} has ${roster.length} players for ${table.columns.length} columns`);
      } else {
        roster.forEach((p, i) => {
          if (!isText(p?.id) || !isText(p?.name)) {
            problems.push(`${t}: ${key} ${table.columns[i]} is not a resolved player (needs name and id)`);
          }
        });
      }
    }
  }
  // One athlete id must mean one player on one team wherever it appears.
  const seen = new Map();
  for (const t of TABLES) {
    for (const p of Object.values(weekFile?.[t]?.rosters ?? {}).flat()) {
      if (!isText(p?.id)) continue;
      const first = seen.get(p.id) ?? seen.set(p.id, p).get(p.id);
      if (first.team !== p.team || first.name !== p.name) {
        problems.push(`player id ${p.id} is listed as both ${first.name} (${first.team}) and ${p.name} (${p.team})`);
      }
    }
  }
  if (problems.length) throw new Error(`Week file ${weekLabel(weekFile)}: ${problems.join("; ")}`);
}

const zeroMoney = (owners) => Object.fromEntries(owners.map((o) => [o, 0]));

// One contest (the team table or a lightning column): who has the top score, and its status.
function contest(pointsByOwner, cellsByOwner, owners) {
  const cells = owners.flatMap((o) => cellsByOwner[o]);
  const started = cells.some((c) => STARTED.includes(c.state));
  const provisional = cells.some((c) => BLOCKING.includes(c.state));
  const top = Math.max(...owners.map((o) => pointsByOwner[o]));
  const winners = started ? owners.filter((o) => pointsByOwner[o] === top) : [];
  return { started, provisional, winners, top };
}

export function scoreWeek(weekFile, playersById, league) {
  validateWeekFile(weekFile, league);
  const owners = league.owners.map((o) => o.key);
  const cell = (p) => {
    const r = playersById[p.id] ?? { points: 0, state: "unknown" };
    if (!Number.isInteger(r.points)) {
      throw new Error(`Week file ${weekLabel(weekFile)}: bad points for ${p.name} (${r.points})`);
    }
    if (!STATES.includes(r.state)) {
      throw new Error(`Week file ${weekLabel(weekFile)}: unknown state for ${p.name}`);
    }
    return { name: p.name, id: p.id, points: r.points, state: r.state };
  };

  // Team table: highest total takes the pot.
  const rows = {};
  for (const o of owners) {
    const players = weekFile.team_table.rosters[o].map(cell);
    rows[o] = { players, total: players.reduce((a, c) => a + c.points, 0) };
  }
  const teamPoints = Object.fromEntries(owners.map((o) => [o, rows[o].total]));
  const teamCells = Object.fromEntries(owners.map((o) => [o, rows[o].players]));
  const t = contest(teamPoints, teamCells, owners);
  const teamMoney = zeroMoney(owners);
  if (t.started) {
    for (const o of owners) teamMoney[o] = -league.teamBuyInCents;
    const shares = splitCents(league.teamBuyInCents * owners.length, t.winners, owners);
    for (const o of t.winners) teamMoney[o] += shares[o];
  }
  const team = { rows, winners: t.winners, started: t.started, provisional: t.provisional, money: teamMoney };

  // Lightning table: every column is its own contest.
  const net = zeroMoney(owners);
  const columns = weekFile.lightning_table.columns.map((name, i) => {
    const cells = Object.fromEntries(owners.map((o) => [o, cell(weekFile.lightning_table.rosters[o][i])]));
    const points = Object.fromEntries(owners.map((o) => [o, cells[o].points]));
    const c = contest(points, Object.fromEntries(owners.map((o) => [o, [cells[o]]])), owners);
    const money = zeroMoney(owners);
    if (c.started) {
      let pot = 0;
      for (const o of owners) {
        const owed = (c.top - points[o]) * league.lightningCentsPerPoint;
        money[o] = -owed;
        pot += owed;
      }
      const shares = splitCents(pot, c.winners, owners);
      for (const o of c.winners) money[o] += shares[o];
    }
    for (const o of owners) net[o] += money[o];
    return { name, cells, winners: c.winners, started: c.started, provisional: c.provisional, money };
  });

  const settlement = Object.fromEntries(
    owners.map((o) => [o, { lightning: net[o], teamPot: teamMoney[o], total: net[o] + teamMoney[o] }]),
  );
  const final = !team.provisional && columns.every((c) => !c.provisional);
  return { final, team, lightning: { columns, net }, settlement };
}

const byWeek = (a, b) => a.week - b.week;

// Accumulated standings: baseline (whole dollars) + recorded weeks, with unrecorded weeks as open columns.
export function standings(baseline, weeks, league) {
  const owners = league.owners.map((o) => o.key);
  const keys = Object.keys(baseline.totals ?? {});
  const wrong = [...owners.filter((o) => !keys.includes(o)), ...keys.filter((k) => !owners.includes(k))];
  if (wrong.length) throw new Error(`baseline.json: owners do not match the league (${wrong.join(", ")})`);

  const base = Object.fromEntries(owners.map((o) => [o, Math.round(baseline.totals[o] * 100)]));
  let recordedThrough = baseline.through_week;
  const open = [];
  // Running totals after the baseline and after each recorded week, in week order.
  const history = [{ week: baseline.through_week, totals: { ...base } }];
  for (const w of [...weeks].sort(byWeek)) {
    const amounts = w.settlement ? Object.fromEntries(owners.map((o) => [o, w.settlement[o].total])) : null;
    if (!w.recorded) {
      open.push({ week: w.week, provisional: !w.final, amounts });
      continue;
    }
    if (w.week <= baseline.through_week) {
      throw new Error(`week ${w.week} is recorded but the baseline already runs through week ${baseline.through_week}`);
    }
    if (!amounts) throw new Error(`week ${w.week} is recorded but has no settlement`);
    for (const o of owners) base[o] += amounts[o];
    recordedThrough = Math.max(recordedThrough, w.week);
    history.push({ week: w.week, totals: { ...base } });
  }
  const totals = { ...base };
  for (const w of open) if (w.amounts) for (const o of owners) totals[o] += w.amounts[o];
  const ranked = [...owners].sort((a, b) => totals[a] - totals[b] || owners.indexOf(a) - owners.indexOf(b));
  const order = Object.fromEntries(owners.map((o) => [o, ranked.indexOf(o) + 1]));
  return { recordedThrough, base, open, totals, order, history };
}

// The week the page opens on: the earliest unrecorded week with a game started, else the last week.
// Returns null when there are no weeks.
export function defaultWeek(weeks) {
  const sorted = [...weeks].sort(byWeek);
  const live = sorted.find((w) => !w.recorded && w.started);
  return (live ?? sorted[sorted.length - 1])?.week ?? null;
}

const rostered = (weekFile) => TABLES.flatMap((t) => Object.values(weekFile[t].rosters).flat());

// Games that contain at least one rostered player's team.
export function relevantGames(weekFile, scoreboard) {
  const teams = new Set(rostered(weekFile).map((p) => p.team));
  return scoreboard.games.filter((g) => g.teams.some((t) => teams.has(t)));
}

// Points and state for every rostered player, from the scoreboard and whichever game summaries
// are loaded (gamesById[id] is a parsed game, or absent/null when it could not be loaded).
export function derivePlayers(weekFile, scoreboard, gamesById) {
  const out = {};
  for (const p of rostered(weekFile)) {
    // Normally one game per team. With several (a rescheduling), cancelled ones are set aside;
    // if more than one still counts the player stays unknown for the scorekeeper to settle.
    let games = scoreboard.games.filter((g) => g.teams.includes(p.team));
    if (games.length > 1) games = games.filter((g) => g.phase !== "unresolved");
    const game = games.length === 1 ? games[0] : null;
    let state = "unknown";
    let points = 0;
    if (!game) {
      if (!games.length && scoreboard.byeTeams.includes(p.team)) state = "bye";
    } else if (game.phase === "pre") {
      state = "not_started";
    } else if (game.phase === "in" || game.phase === "done") {
      const summary = gamesById[game.id];
      if (summary) {
        const line = summary.stats[p.id];
        const twoPt = summary.twoPt.filter((t) => t.name === p.name && t.team === p.team);
        points = playerPoints(line, twoPt.reduce((a, t) => a + t.points, 0));
        if (game.phase === "in") state = "live";
        else state = line || twoPt.length ? "final" : "dnp";
      }
    }
    out[p.id] = { points, state };
  }
  return out;
}

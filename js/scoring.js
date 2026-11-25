// Pure scoring engine: no I/O. Runs in the browser and in Node. All money is integer cents.

export const BLOCKING = ["live", "not_started", "unknown"];
// States that mean a player's game has kicked off (bye and unknown do not start a contest).
const STARTED = ["live", "final", "dnp"];
const STATES = ["final", "dnp", "bye", "live", "not_started", "unknown"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// Each yardage category on its own, decimals dropped (rounded toward zero): negative yards can
// cost points (−11 rushing yards = −1), but only once they reach a whole point (−8 = 0).
const yards = (v, per) => Math.trunc(num(v) / per) || 0; // `|| 0`: never −0

// How a stat line turns into points, one entry per category: yards points, touchdown points.
// playerPoints is the sum, so the stats card and the scores can never disagree.
export function pointsBreakdown(statLine, twoPt = 0) {
  const s = statLine || {};
  return {
    pass: { yards: yards(s.passYds, 20), td: 3 * num(s.passTD) },
    rush: { yards: yards(s.rushYds, 10), td: 6 * num(s.rushTD) },
    rec: { yards: yards(s.recYds, 10), td: 6 * num(s.recTD) },
    twoPt: num(twoPt),
  };
}

export function playerPoints(statLine, twoPt = 0) {
  const b = pointsBreakdown(statLine, twoPt);
  return b.pass.yards + b.pass.td + b.rush.yards + b.rush.td + b.rec.yards + b.rec.td + b.twoPt;
}

// A kicker's tiebreak points (Thanksgiving Day pool, RULES.md rule 6): 1 per extra point made,
// 3 per field goal made, any distance; misses score nothing.
export function kickPoints(statLine) {
  const s = statLine || {};
  return num(s.xpMade) + 3 * num(s.fgMade);
}

// Points by the rules for a saved stat line ({...line, twoPt}).
export const statsPoints = (stats) => playerPoints(stats, stats?.twoPt ?? 0);

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
// The Thanksgiving Day pool (RULES.md rule 6) is a third table, present only that week.
export const THANKSGIVING = "thanksgiving_table";
const tablesOf = (weekFile) => (weekFile?.[THANKSGIVING] ? [...TABLES, THANKSGIVING] : TABLES);
const isText = (v) => typeof v === "string" && v !== "";
const weekLabel = (weekFile) => `${weekFile?.season}-${weekFile?.week}`;

// Throws if any league owner is missing from a table or a roster doesn't fit its columns.
export function validateWeekFile(weekFile, league) {
  const problems = [];
  if (!Number.isInteger(weekFile?.season) || !Number.isInteger(weekFile?.week)) {
    problems.push("needs an integer season and week");
  }
  for (const t of tablesOf(weekFile)) {
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
  // The Thanksgiving Day pool's kicker column is named exactly "K" (the tiebreak), once.
  const tgCols = weekFile?.[THANKSGIVING]?.columns;
  if (Array.isArray(tgCols) && tgCols.filter((c) => c === "K").length !== 1) {
    problems.push(`${THANKSGIVING} needs exactly one "K" column (the tiebreak kicker)`);
  }
  // One athlete id must mean one player on one team wherever it appears.
  const seen = new Map();
  for (const t of tablesOf(weekFile)) {
    for (const p of Object.values(weekFile?.[t]?.rosters ?? {}).flat()) {
      if (!isText(p?.id)) continue;
      const first = seen.get(p.id) ?? seen.set(p.id, p).get(p.id);
      if (first.team !== p.team || first.name !== p.name) {
        problems.push(`player id ${p.id} is listed as both ${first.name} (${first.team}) and ${p.name} (${p.team})`);
      }
    }
  }
  if (weekFile?.two_pt_fixes !== undefined) {
    const fixes = weekFile.two_pt_fixes;
    if (!Array.isArray(fixes)) problems.push("two_pt_fixes must be a list");
    else {
      fixes.forEach((f, i) => {
        const where = `two_pt_fixes[${i}]`;
        if (!isText(f?.play)) problems.push(`${where} needs the scoring play id ("play")`);
        if (!isText(f?.reason)) problems.push(`${where} needs a reason`);
        if (f?.id === null || f?.id === undefined) {
          if (f?.points) problems.push(`${where} gives points but names no player ("id")`);
        } else if (!seen.has(f.id)) problems.push(`${where}: player id ${f.id} is not on this week's rosters`);
        else if (![1, 2].includes(f.points)) problems.push(`${where}: points must be 1 (passer) or 2 (receiver or runner)`);
      });
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
    const out = { name: p.name, id: p.id, team: p.team, points: r.points, state: r.state };
    if (r.stats) out.stats = r.stats;
    if (r.game) out.game = r.game;
    if (r.override) out.override = r.override;
    return out;
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

  // Thanksgiving Day pool (only that week): highest total of the non-kicker spots takes the pot;
  // the kicker's points break a tie; still tied, the tied owners split it.
  let thanksgiving = null;
  const tg = weekFile[THANKSGIVING];
  if (tg) {
    const kick = tg.columns.indexOf("K");
    const tgRows = {};
    for (const o of owners) {
      const players = tg.rosters[o].map(cell);
      const total = players.reduce((a, c, i) => (i === kick ? a : a + c.points), 0);
      tgRows[o] = { players, total, tiebreak: kick >= 0 ? kickPoints(players[kick].stats) : 0 };
    }
    const g = contest(
      Object.fromEntries(owners.map((o) => [o, tgRows[o].total])),
      Object.fromEntries(owners.map((o) => [o, tgRows[o].players])),
      owners,
    );
    const bestTiebreak = Math.max(...g.winners.map((o) => tgRows[o].tiebreak));
    const winners = g.winners.filter((o) => tgRows[o].tiebreak === bestTiebreak);
    const money = zeroMoney(owners);
    if (g.started) {
      for (const o of owners) money[o] = -league.teamBuyInCents;
      const shares = splitCents(league.teamBuyInCents * owners.length, winners, owners);
      for (const o of winners) money[o] += shares[o];
    }
    thanksgiving = {
      rows: tgRows,
      winners,
      tiedOnTotal: g.winners.length > 1, // the kicker tiebreak was needed
      started: g.started,
      provisional: g.provisional,
      money,
    };
  }

  const settlement = Object.fromEntries(
    owners.map((o) => {
      const s = { lightning: net[o], teamPot: teamMoney[o], total: net[o] + teamMoney[o] };
      if (thanksgiving) {
        s.thanksgiving = thanksgiving.money[o];
        s.total += thanksgiving.money[o];
      }
      return [o, s];
    }),
  );
  const final = !team.provisional && columns.every((c) => !c.provisional) && !thanksgiving?.provisional;
  const out = { final, team, lightning: { columns, net }, settlement };
  if (thanksgiving) out.thanksgiving = thanksgiving;
  return out;
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

const rostered = (weekFile) => tablesOf(weekFile).flatMap((t) => Object.values(weekFile[t].rosters).flat());

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
    let stats = null;
    if (!game) {
      if (!games.length && scoreboard.byeTeams.includes(p.team)) state = "bye";
    } else if (game.phase === "pre") {
      state = "not_started";
    } else if (game.phase === "in" || game.phase === "done") {
      const summary = gamesById[game.id];
      if (summary) {
        const line = summary.stats[p.id];
        // A two_pt_fixes entry settles a role on its play (see RULES.md). A fix naming a player
        // replaces the play text's credit for that role only (1 = passer, 2 = receiver or
        // runner), so a teammate credited in the other role keeps it. A fix naming nobody
        // ("id": null) clears every credit on the play.
        const fixes = weekFile.two_pt_fixes ?? [];
        const replaced = (t) =>
          Boolean(t.play) && fixes.some((f) => f.play === t.play && (f.id === null || f.id === undefined || f.points === t.points));
        const twoPt = summary.twoPt.filter((t) => t.name === p.name && t.team === p.team && !replaced(t));
        twoPt.push(...fixes.filter((f) => f.id === p.id && f.points));
        const twoPtPoints = twoPt.reduce((a, t) => a + t.points, 0);
        points = playerPoints(line, twoPtPoints);
        if (line || twoPt.length) stats = { ...line, ...(twoPtPoints ? { twoPt: twoPtPoints } : {}) };
        if (game.phase === "in") state = "live";
        else state = line || twoPt.length ? "final" : "dnp";
      }
    }
    out[p.id] = { points, state };
    if (stats) out[p.id].stats = stats;
    if (game) {
      const opp = game.teams.find((t) => t !== p.team) ?? null;
      out[p.id].game = { opp, home: game.home ? game.home === p.team : null, kickoff: game.kickoff ?? null };
      if (game.score && opp) out[p.id].game.score = { team: game.score[p.team], opp: game.score[opp] };
      if (game.detail) out[p.id].game.detail = game.detail;
    }
  }
  return out;
}

// Lowercase, no punctuation, no generational suffix: "Aaron Jones Sr." and "Aaron Jones" compare equal.
const looseName = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .split(/\s+/)
    .filter((w) => w && !["jr", "sr", "ii", "iii", "iv", "v"].includes(w))
    .join(" ");

// Two-point conversions that may have been scored wrongly, in finished games only (during a game
// the 2 points can show up a moment after the touchdown). Each is a sentence for the scorekeeper.
// A flagged play is settled by a two_pt_fixes entry for that play.
export function twoPtWarnings(weekFile, scoreboard, gamesById) {
  const settled = new Set((weekFile.two_pt_fixes ?? []).map((f) => f.play));
  const players = rostered(weekFile);
  const exact = new Set(players.map((p) => `${p.name}|${p.team}`));
  const out = [];
  for (const g of relevantGames(weekFile, scoreboard).filter((g) => g.phase === "done")) {
    const summary = gamesById[g.id];
    if (!summary) continue;
    const label = `${g.teams.join(" v ")} (game ${g.id})`;
    for (const issue of summary.twoPtIssues ?? []) {
      if (issue.play && settled.has(issue.play)) continue;
      out.push(`${label}, play ${issue.play ?? "?"}: ${issue.problem}: "${issue.text}"`);
    }
    for (const t of summary.twoPt) {
      if (exact.has(`${t.name}|${t.team}`) || (t.play && settled.has(t.play))) continue;
      // same team, and the same name apart from punctuation and suffixes, or the same last name
      // and first initial ("Mitch Trubisky" / "Mitchell Trubisky")
      const a = looseName(t.name).split(" ");
      const near = players.find((p) => {
        if (p.team !== t.team) return false;
        const b = looseName(p.name).split(" ");
        return b.join(" ") === a.join(" ") || (b.at(-1) === a.at(-1) && b[0]?.[0] === a[0]?.[0]);
      });
      if (near) {
        out.push(`${label}, play ${t.play ?? "?"}: the play text credits "${t.name}" (${t.team}) with ${t.points}, which is not exactly our player "${near.name}"`);
      }
    }
  }
  return [...new Set(out)];
}

// The Lightning draft order (lightning_table.pick_order) is display-only, so a bad one never
// stops a week from scoring: it is simply not used. `isPickOrder` is the one check, shared by
// the site and the CLI; `pickOrder` returns the order or null; `pickOrderProblem` says what is
// wrong, for the CLI to warn about.
export function isPickOrder(order, league) {
  const keys = league.owners.map((o) => o.key);
  return Array.isArray(order) && order.length === keys.length && keys.every((k) => order.includes(k));
}
export function pickOrderProblem(weekFile, league) {
  const order = weekFile?.lightning_table?.pick_order;
  if (order === undefined) return null;
  if (isPickOrder(order, league)) return null;
  return `lightning_table.pick_order must list every owner once (${league.owners.map((o) => o.key).join(", ")}); showing league order instead`;
}
export function pickOrder(weekFile, league) {
  const order = weekFile?.lightning_table?.pick_order;
  return isPickOrder(order, league) ? order : null;
}

// Rule 3 (RULES.md): no player may be on every owner's Team table (if everyone picks the same
// player, everyone re-picks). Returns the names of any player on all of them, for the CLI to warn
// about. The Thanksgiving Day pool is never checked (unanimous picks are allowed there); the main
// Team table keeps the rule every week, Thanksgiving week included. "team_table": {"shared_ok": true}
// switches the check off for a week, only if the league ever agrees an exception.
export function onEveryTeamTable(weekFile, league) {
  const table = weekFile?.team_table;
  if (!table?.rosters || table.shared_ok) return [];
  const owners = league.owners.map((o) => o.key);
  const counts = new Map();
  const names = new Map();
  for (const o of owners) {
    for (const p of new Set((table.rosters[o] ?? []).filter((x) => x?.id).map((x) => x.id))) counts.set(p, (counts.get(p) ?? 0) + 1);
    for (const p of table.rosters[o] ?? []) if (p?.id) names.set(p.id, p.name);
  }
  return [...counts].filter(([, n]) => n === owners.length).map(([id]) => names.get(id));
}

// Thanksgiving Day (RULES.md rule 6): the fourth Thursday of November, as "YYYY-MM-DD".
export function thanksgivingDate(season) {
  const first = new Date(Date.UTC(season, 10, 1)).getUTCDay(); // 0 = Sunday
  const day = 1 + ((4 - first + 7) % 7) + 21;
  return `${season}-11-${String(day).padStart(2, "0")}`;
}
// A kickoff's date in US Eastern time, as "YYYY-MM-DD".
const easternDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

// Rule 6 checks on the Thanksgiving Day pool, as sentences for the CLI to warn about:
// the five players in a lineup from different NFL teams (the kicker may share one), and, given the week's
// scoreboard, every pick from a team playing on Thanksgiving Day.
export function thanksgivingProblems(weekFile, league, scoreboard = null) {
  const tg = weekFile?.[THANKSGIVING];
  if (!tg) return [];
  const out = [];
  const day = thanksgivingDate(weekFile.season);
  const playing = scoreboard ? new Set(scoreboard.games.filter((g) => g.kickoff && easternDate(g.kickoff) === day).flatMap((g) => g.teams)) : null;
  for (const o of league.owners) {
    const lineup = tg.rosters[o.key] ?? [];
    // the five players must be from different teams; the kicker can be from any Thanksgiving Day team
    const kick = tg.columns.indexOf("K");
    const five = lineup.filter((_, i) => i !== kick);
    const teams = five.map((p) => p?.team);
    const repeated = [...new Set(teams.filter((t, i) => t && teams.indexOf(t) !== i))];
    for (const t of repeated) {
      const who = five.filter((p) => p?.team === t).map((p) => p.name).join(", ");
      out.push(`Thanksgiving Day pool: ${o.display} has more than one pick from ${t} (${who})`);
    }
    if (playing) {
      for (const p of lineup) if (p?.team && !playing.has(p.team)) out.push(`Thanksgiving Day pool: ${o.display}'s ${p.name} (${p.team}) isn't playing on Thanksgiving Day`);
    }
  }
  return out;
}

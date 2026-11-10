// The page's model: scores every week (recorded ones from their file, the rest live from ESPN),
// keeps the last good live result when ESPN is unreachable, and says when to refresh next.
// No DOM here; js/app.js renders the model.
import { scoreWeek, standings, defaultWeek, derivePlayers, relevantGames, validateWeekFile } from "./scoring.js";
import { loadLive, nextPollMs } from "./espn.js";

const RETRY_MS = 60000;
const keyOf = (w) => `${w.season}-${w.week}`;

// index.json must be a list of {season, week}; anything else is reported by file name.
export function checkIndex(index) {
  const ok = Array.isArray(index) && index.every((w) => Number.isInteger(w?.season) && Number.isInteger(w?.week));
  if (!ok) throw new Error("data/weeks/index.json must be a list of {season, week} entries");
}

// `previous` is the state being replaced after the data files were re-read: finished-game
// summaries and the last good live results carry over.
export function newState({ league, baseline, weekFiles }, previous = null) {
  return {
    league,
    baseline,
    weekFiles: [...weekFiles].sort((a, b) => a.season - b.season || a.week - b.week),
    caches: previous?.caches ?? new Map(), // week key -> Map of finished game summaries
    last: previous?.last ?? new Map(), // week key -> {result, errors, at} from the last successful live load
    dataFrom: previous?.dataFrom ?? null, // when any live data last loaded successfully
  };
}

const startedAny = (result) => Boolean(result) && (result.team.started || result.lightning.columns.some((c) => c.started));

export async function refresh(state, fetchFn, now = new Date()) {
  const { league, baseline } = state;
  const weeks = [];
  const polls = [];
  for (const weekFile of state.weekFiles) {
    const key = keyOf(weekFile);
    const w = {
      season: weekFile.season,
      week: weekFile.week,
      recorded: Boolean(weekFile.recorded),
      result: null,
      errors: [],
      problem: null,
      started: false,
      unavailable: false, // live stats could not be reached on this refresh
      dataFrom: null, // when this week's live numbers were loaded
    };
    weeks.push(w);
    try {
      validateWeekFile(weekFile, league);
      if (w.recorded) {
        w.result = scoreWeek(weekFile, weekFile.recorded.players, league);
        continue;
      }
      if (!state.caches.has(key)) state.caches.set(key, new Map());
      let live = null;
      try {
        live = await loadLive(weekFile, fetchFn, state.caches.get(key));
      } catch {
        w.unavailable = true;
        polls.push(RETRY_MS);
      }
      if (live) {
        polls.push(RETRY_MS); // replaced below once the week has been scored
        const players = derivePlayers(weekFile, live.scoreboard, live.gamesById);
        state.last.set(key, { result: scoreWeek(weekFile, players, league), errors: live.errors, at: now });
        state.dataFrom = now;
        polls[polls.length - 1] = live.errors.length ? RETRY_MS : nextPollMs(relevantGames(weekFile, live.scoreboard));
      }
      const kept = state.last.get(key);
      if (kept) {
        w.result = kept.result;
        w.errors = kept.errors;
        w.dataFrom = kept.at;
      } else {
        // Nothing loaded yet: the rosters can still be shown, every player unknown, no money.
        w.placeholder = scoreWeek(weekFile, {}, league);
      }
    } catch (err) {
      w.problem = err.message;
    } finally {
      w.started = startedAny(w.result);
    }
  }

  let table = null;
  let standingsProblem = null;
  try {
    const rows = weeks.map((w) => ({
      week: w.week,
      recorded: w.recorded,
      final: w.result?.final ?? false,
      settlement: w.result?.settlement ?? null,
    }));
    table = standings(baseline, rows, league);
  } catch (err) {
    standingsProblem = err.message;
  }

  const due = polls.filter((p) => p !== null);
  return {
    weeks,
    standings: table,
    standingsProblem,
    pollMs: due.length ? Math.min(...due) : null,
    unavailable: weeks.some((w) => w.unavailable),
    dataFrom: state.dataFrom,
    gameErrors: weeks.some((w) => w.errors.length > 0),
    defaultWeek: defaultWeek(weeks.map((w) => ({ week: w.week, recorded: w.recorded, started: w.started }))),
  };
}

// One line describing the selected week.
export function statusLine(week) {
  const name = `Week ${week.week}`;
  if (week.problem) return `${name} cannot be shown: ${week.problem}`;
  if (week.recorded) return `${name} · final`;
  if (!week.result) return `${name} · scores not loaded yet`;
  if (week.result.final) return `${name} · final (not yet recorded by the scorekeeper)`;
  if (!week.started) return `${name} · not started`;
  if (week.errors.length) return `${name} · provisional — some games could not be loaded`;
  return `${name} · provisional — games still to finish`;
}

// Warnings to show above the tables for the selected week. `fmtTime` formats a Date.
export function bannerLines(model, week, fmtTime) {
  const lines = [];
  if (week?.unavailable) {
    lines.push(week.dataFrom ? `Live stats unavailable — showing data from ${fmtTime(week.dataFrom)}` : "Live stats unavailable — no scores yet");
  }
  for (const other of model.weeks) {
    if (other !== week && other.unavailable) lines.push(`Live stats unavailable for Week ${other.week}`);
  }
  if (week?.errors.length) lines.push("Some games could not be loaded; their players show “?”.");
  return lines;
}

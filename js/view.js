// The page's model: scores every week (recorded ones from their file, the rest live from ESPN),
// keeps the last good live result when ESPN is unreachable, and says when to refresh next.
// No DOM here; js/app.js renders the model.
import { scoreWeek, standings, defaultWeek, derivePlayers, relevantGames, validateWeekFile } from "./scoring.js";
import { loadLive, nextPollMs } from "./espn.js";

const RETRY_MS = 60000;

export function newState({ league, baseline, weekFiles }) {
  return {
    league,
    baseline,
    weekFiles: [...weekFiles].sort((a, b) => a.week - b.week),
    caches: new Map(), // week -> Map of finished game summaries
    last: new Map(), // week -> {result, errors} from the last successful live load
    dataFrom: null, // when live data last loaded successfully
  };
}

const startedAny = (result) => Boolean(result) && (result.team.started || result.lightning.columns.some((c) => c.started));

export async function refresh(state, fetchFn, now = new Date()) {
  const { league, baseline } = state;
  const weeks = [];
  const polls = [];
  let unavailable = false;
  for (const weekFile of state.weekFiles) {
    const w = {
      season: weekFile.season,
      week: weekFile.week,
      recorded: Boolean(weekFile.recorded),
      result: null,
      errors: [],
      problem: null,
      started: false,
    };
    weeks.push(w);
    try {
      validateWeekFile(weekFile, league);
      if (w.recorded) {
        w.result = scoreWeek(weekFile, weekFile.recorded.players, league);
      } else {
        if (!state.caches.has(w.week)) state.caches.set(w.week, new Map());
        let live = null;
        try {
          live = await loadLive(weekFile, fetchFn, state.caches.get(w.week));
        } catch {
          unavailable = true;
          polls.push(RETRY_MS);
        }
        if (live) {
          const players = derivePlayers(weekFile, live.scoreboard, live.gamesById);
          state.last.set(w.week, { result: scoreWeek(weekFile, players, league), errors: live.errors });
          state.dataFrom = now;
          polls.push(live.errors.length ? RETRY_MS : nextPollMs(relevantGames(weekFile, live.scoreboard)));
        }
        const kept = state.last.get(w.week);
        if (kept) {
          w.result = kept.result;
          w.errors = kept.errors;
        } else {
          // Nothing loaded yet: the rosters can still be shown, every player unknown, no money.
          w.placeholder = scoreWeek(weekFile, {}, league);
        }
      }
    } catch (err) {
      w.problem = err.message;
    }
    w.started = startedAny(w.result);
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
    unavailable,
    dataFrom: state.dataFrom,
    gameErrors: weeks.some((w) => w.errors.length > 0),
    defaultWeek: defaultWeek(weeks.map((w) => ({ week: w.week, recorded: w.recorded, started: w.started }))),
  };
}

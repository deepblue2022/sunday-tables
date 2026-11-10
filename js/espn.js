// The only code that knows ESPN's response shapes. Every fetch goes through an injected
// fetchFn(url) that resolves to parsed JSON and rejects on a failed request.

import { relevantGames } from "./scoring.js";

export const API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

function phaseOf(type) {
  if (type?.completed === true) return "done";
  if (type?.state === "pre") return "pre";
  if (type?.state === "in") return "in";
  return "unresolved"; // "post" but not completed (cancelled, postponed), or anything unrecognised
}

export function parseScoreboard(json) {
  const games = (json.events ?? []).map((e) => ({
    id: String(e.id),
    teams: e.competitions[0].competitors.map((c) => c.team.abbreviation),
    phase: phaseOf(e.status?.type),
    kickoff: e.date,
  }));
  const byeTeams = (json.week?.teamsOnBye ?? []).map((t) => t.abbreviation);
  return { games, byeTeams };
}

const STAT_KEYS = {
  passing: { passingYards: "passYds", passingTouchdowns: "passTD" },
  rushing: { rushingYards: "rushYds", rushingTouchdowns: "rushTD" },
  receiving: { receivingYards: "recYds", receivingTouchdowns: "recTD" },
};
const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Matched against the inside of one parenthetical at a time.
const TWO_PT_PASS = /^(.+?) Pass to (.+?) for Two-Point Conversion$/;
const TWO_PT_RUN = /^(.+?) (?:Run|Rush) for Two-Point Conversion$/;

export function parseGame(json) {
  const stats = {};
  for (const team of json.boxscore?.players ?? []) {
    for (const group of team.statistics ?? []) {
      const wanted = STAT_KEYS[group.name];
      if (!wanted) continue;
      for (const a of group.athletes ?? []) {
        const line = (stats[String(a.athlete.id)] ??= {});
        group.keys.forEach((key, i) => {
          if (wanted[key]) line[wanted[key]] = toNumber(a.stats[i]);
        });
      }
    }
  }
  const twoPt = [];
  for (const play of json.scoringPlays ?? []) {
    const team = play.team?.abbreviation;
    for (const [, inner] of (play.text ?? "").matchAll(/\(([^()]*)\)/g)) {
      const pass = inner.match(TWO_PT_PASS);
      const run = inner.match(TWO_PT_RUN);
      if (pass) {
        twoPt.push({ name: pass[1], team, points: 1 }, { name: pass[2], team, points: 2 });
      } else if (run) {
        twoPt.push({ name: run[1], team, points: 2 });
      }
    }
  }
  return { stats, twoPt };
}

export async function fetchScoreboard(season, week, fetchFn) {
  return parseScoreboard(await fetchFn(`${API}/scoreboard?seasontype=2&week=${week}&dates=${season}`));
}

export async function fetchGame(id, fetchFn) {
  return parseGame(await fetchFn(`${API}/summary?event=${id}`));
}

// Every player on every team's roster (including injured reserve and practice squad). CLI only.
export async function fetchRosters(fetchFn) {
  const list = await fetchFn(`${API}/teams`);
  const players = [];
  for (const { team } of list.sports[0].leagues[0].teams) {
    const roster = await fetchFn(`${API}/teams/${team.id}/roster`);
    const abbr = roster.team?.abbreviation ?? team.abbreviation;
    for (const group of roster.athletes ?? []) {
      for (const a of group.items ?? []) {
        players.push({ id: String(a.id), name: a.displayName, team: abbr, pos: a.position?.abbreviation });
      }
    }
  }
  return players;
}

// How long to wait before the next refresh: a minute while a game is on, five minutes while
// one is still to kick off, null when nothing more will change.
export function nextPollMs(games) {
  if (games.some((g) => g.phase === "in")) return 60000;
  if (games.some((g) => g.phase === "pre")) return 300000;
  return null;
}

// Load everything needed to score an unrecorded week. Fetches the scoreboard (a failure rejects),
// then the summary of every relevant game that is in progress or finished. A finished game's
// summary is kept in `cache` only when it was fetched after the game finished, so the last plays
// are never missed; a failed game is left out of gamesById and reported in errors.
export async function loadLive(weekFile, fetchFn, cache = new Map()) {
  const scoreboard = await fetchScoreboard(weekFile.season, weekFile.week, fetchFn);
  const gamesById = {};
  const errors = [];
  const wanted = relevantGames(weekFile, scoreboard).filter((g) => g.phase === "in" || g.phase === "done");
  await Promise.all(
    wanted.map(async (g) => {
      if (g.phase === "done" && cache.has(g.id)) {
        gamesById[g.id] = cache.get(g.id);
        return;
      }
      cache.delete(g.id);
      try {
        const summary = await fetchGame(g.id, fetchFn);
        if (g.phase === "done" && !Object.keys(summary.stats).length) {
          throw new Error("finished game came back with no box score");
        }
        gamesById[g.id] = summary;
        if (g.phase === "done") cache.set(g.id, summary);
      } catch (err) {
        errors.push(`${g.teams.join(" v ")} (game ${g.id}): ${err?.message ?? err}`);
      }
    }),
  );
  return { scoreboard, gamesById, errors };
}

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
  const games = (json.events ?? []).map((e) => {
    const comps = e.competitions[0].competitors;
    const phase = phaseOf(e.status?.type);
    const game = {
      id: String(e.id),
      teams: comps.map((c) => c.team.abbreviation),
      home: comps.find((c) => c.homeAway === "home")?.team.abbreviation ?? null,
      phase,
      kickoff: e.date,
    };
    // Score and status text ("8:42 - 3rd", "Halftime", "Final/OT") once the game is under way.
    if (phase === "in" || phase === "done") {
      const score = Object.fromEntries(comps.map((c) => [c.team.abbreviation, Number(c.score)]));
      if (Object.values(score).every(Number.isFinite)) game.score = score;
      if (e.status?.type?.shortDetail) game.detail = String(e.status.type.shortDetail);
    }
    return game;
  });
  const byeTeams = (json.week?.teamsOnBye ?? []).map((t) => t.abbreviation);
  return { games, byeTeams };
}

const STAT_KEYS = {
  passing: { "completions/passingAttempts": ["passCmp", "passAtt"], passingYards: "passYds", passingTouchdowns: "passTD" },
  rushing: { rushingAttempts: "rushAtt", rushingYards: "rushYds", rushingTouchdowns: "rushTD" },
  receiving: { receptions: "rec", receivingYards: "recYds", receivingTouchdowns: "recTD" },
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
          const field = wanted[key];
          if (Array.isArray(field)) {
            // a combined stat such as "16/26" (completions/attempts)
            const parts = String(a.stats[i] ?? "").split("/");
            field.forEach((f, j) => (line[f] = toNumber(parts[j])));
          } else if (field) {
            line[field] = toNumber(a.stats[i]);
          }
        });
      }
    }
  }
  const twoPt = [];
  // Cross-check against the score: a successful 2-pt try is the only way a team's score goes
  // up by exactly 8 on one scoring play. Only possible when every play carries the running
  // score (real ESPN data does).
  const plays = json.scoringPlays ?? [];
  const scored = plays.length > 0 && plays.every((p) => Number.isFinite(Number(p.awayScore)) && Number.isFinite(Number(p.homeScore)));
  const twoPtIssues = [];
  let prev = { away: 0, home: 0 };
  for (const play of plays) {
    const team = play.team?.abbreviation;
    const ref = play.id != null ? { play: String(play.id) } : {};
    const found = [];
    for (const [, inner] of (play.text ?? "").matchAll(/\(([^()]*)\)/g)) {
      const pass = inner.match(TWO_PT_PASS);
      const run = inner.match(TWO_PT_RUN);
      if (pass) {
        found.push({ name: pass[1], team, points: 1, ...ref }, { name: pass[2], team, points: 2, ...ref });
      } else if (run) {
        found.push({ name: run[1], team, points: 2, ...ref });
      }
    }
    twoPt.push(...found);
    if (scored) {
      const now = { away: Number(play.awayScore), home: Number(play.homeScore) };
      const eight = now.away - prev.away === 8 || now.home - prev.home === 8;
      if (eight && !found.length) twoPtIssues.push({ ...ref, team, text: play.text ?? "", problem: "the score went up by 8 but no 2-pt conversion was credited" });
      if (!eight && found.length) twoPtIssues.push({ ...ref, team, text: play.text ?? "", problem: "a 2-pt conversion was credited but the score did not go up by 8" });
      prev = now;
    }
  }
  return twoPtIssues.length ? { stats, twoPt, twoPtIssues } : { stats, twoPt };
}

// From a raw game summary: athlete id -> abbreviation of the team he played for in that game.
export function playedTeams(json) {
  const out = {};
  for (const team of json.boxscore?.players ?? []) {
    const abbr = team.team?.abbreviation;
    if (!abbr) continue;
    for (const group of team.statistics ?? []) {
      for (const a of group.athletes ?? []) out[String(a.athlete.id)] = abbr;
    }
  }
  return out;
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

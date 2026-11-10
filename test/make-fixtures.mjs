// One-off: download the ESPN responses the tests use and trim them to the fields js/espn.js reads.
// Run with network access:  node --use-system-ca test/make-fixtures.mjs
import { mkdir, writeFile } from "node:fs/promises";

const API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const OUT = new URL("./fixtures/", import.meta.url);
const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
};
const save = (name, data) => writeFile(new URL(name, OUT), JSON.stringify(data));

const trimScoreboard = (d) => ({
  week: { teamsOnBye: (d.week?.teamsOnBye ?? []).map((t) => ({ abbreviation: t.abbreviation })) },
  events: d.events.map((e) => ({
    id: e.id,
    date: e.date,
    status: { type: e.status.type },
    competitions: [
      { competitors: e.competitions[0].competitors.map((c) => ({ team: { abbreviation: c.team.abbreviation } })) },
    ],
  })),
});

const STAT_GROUPS = ["passing", "rushing", "receiving"];
const trimGame = (d) => ({
  boxscore: {
    players: (d.boxscore?.players ?? []).map((t) => ({
      team: { abbreviation: t.team.abbreviation },
      statistics: t.statistics
        .filter((s) => STAT_GROUPS.includes(s.name))
        .map((s) => ({
          name: s.name,
          keys: s.keys,
          athletes: s.athletes.map((a) => ({
            athlete: { id: a.athlete.id, displayName: a.athlete.displayName },
            stats: a.stats,
          })),
        })),
    })),
  },
  scoringPlays: (d.scoringPlays ?? []).map((p) => ({ text: p.text, team: { abbreviation: p.team.abbreviation } })),
});

await mkdir(new URL("2026-09/", OUT), { recursive: true });
const sb = await get(`${API}/scoreboard?seasontype=2&week=9&dates=2026`);
await save("2026-09/scoreboard.json", trimScoreboard(sb));
for (const e of sb.events) {
  await save(`2026-09/game-${e.id}.json`, trimGame(await get(`${API}/summary?event=${e.id}`)));
}
await save("2022-17-scoreboard.json", trimScoreboard(await get(`${API}/scoreboard?seasontype=2&week=17&dates=2022`)));
console.log(`saved ${sb.events.length + 2} files`);

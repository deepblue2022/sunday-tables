// Presentation helpers: pure string builders, no DOM. Shared by the page and the CLI.
import { pointsBreakdown, statsPoints } from "./scoring.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Integer cents -> "+$448", "−$60", "$0"; cents are shown only when the amount is not whole dollars.
export function fmtMoney(cents) {
  const abs = Math.abs(cents);
  const amount = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}$${amount}`;
}

export const STATE_TAG = { live: "LIVE", dnp: "DNP", bye: "BYE", unknown: "?" };
// Players whose game has not produced a score yet show a dash instead of points.
export const showsDash = (state) => state === "not_started" || state === "unknown";

// ---------- HTML builders for the page ----------

const DASH = "—";
const moneyCell = (cents, extra = "") => {
  const sign = cents > 0 ? " pos" : cents < 0 ? " neg" : "";
  return `<td class="${extra}money${sign}">${esc(fmtMoney(cents))}</td>`;
};
const note = (text) => `<span class="note">${esc(text)}</span>`;
// A player's box. `key` lets the page find the player again when the box is tapped for the stats card.
// A player yet to play shows his kickoff time (via `fmtKickoff`) in place of the dash, when known.
const playerCell = (c, highlight, key, fmtKickoff = null) => {
  const tag = STATE_TAG[c.state] ? `<span class="tag ${c.state}">${STATE_TAG[c.state]}</span>` : "";
  const kick = c.state === "not_started" && c.game?.kickoff && fmtKickoff ? fmtKickoff(c.game.kickoff) : null;
  const points = kick ? `<span class="kick">${esc(kick)}</span>` : esc(showsDash(c.state) ? DASH : c.points);
  const star = c.override ? `<sup class="star" aria-hidden="true">*</sup>` : "";
  const label = `${c.name}, ${showsDash(c.state) ? "no score yet" : `${c.points} points`}${c.override ? " (settled score)" : ""}. Show stats`;
  return (
    `<td class="cell${highlight ? " win" : ""} ${esc(c.state)}">` +
    `<button type="button" class="pcell" data-card="${esc(key)}" aria-label="${esc(label)}">` +
    `<span class="pname">${esc(c.name)}</span><span class="pts">${points}</span>${star}${tag}</button></td>`
  );
};
const wrap = (table, provisional) => `<div class="table-wrap${provisional ? " prov" : ""}">${table}</div>`;
const rowHead = (owner) => `<th scope="row">${esc(owner.display)}</th>`;
const names = (keys, league) => keys.map((k) => league.owners.find((o) => o.key === k)?.display ?? k).join(" & ");
// A contest where everybody is level (typically all on 0) has no winner worth highlighting.
const highlighted = (winners, league) => (winners.length < league.owners.length ? winners : []);

// `fmtKickoff` (optional) formats an ISO kickoff time for players yet to play.
export function renderTeamTable(result, league, columns, fmtKickoff = null) {
  const { team } = result;
  const win = highlighted(team.winners, league);
  const head = `<tr><th>Team</th>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}<th>Total</th></tr>`;
  const rows = league.owners
    .map((o) => {
      const row = team.rows[o.key];
      const cells = row.players.map((c, i) => playerCell(c, false, `t|${o.key}|${i}`, fmtKickoff)).join("");
      return `<tr${win.includes(o.key) ? ' class="win"' : ""}>\n${rowHead(o)}${cells}<td class="total">${esc(row.total)}</td></tr>`;
    })
    .join("\n");
  const pot = `$${(league.teamBuyInCents * league.owners.length) / 100}`;
  let line;
  if (!team.started) line = `Not started. Pot: ${pot}`;
  else if (!win.length) line = team.provisional ? "provisional: all level" : `All level: ${pot} pot returned`;
  else if (team.provisional) line = `provisional: ${names(win, league)} ${win.length > 1 ? "tied" : "leads"}`;
  else line = `${names(win, league)} ${win.length > 1 ? "split" : "wins"} ${pot}`;
  const table = `<table class="team"><thead>${head}</thead><tbody>\n${rows}\n</tbody></table>`;
  return `${wrap(table, team.provisional)}<p class="pot">${esc(line)}</p>`;
}

export function renderLightning(result, league, fmtKickoff = null) {
  const cols = result.lightning.columns;
  const head = (extra) => {
    const cells = cols.map((c) => `<th>${esc(c.name)}${c.provisional && c.started ? note("provisional") : ""}</th>`).join("");
    return `<tr><th>Team</th>${cells}${extra}</tr>`;
  };
  const players = league.owners
    .map((o) => {
      const cells = cols.map((c, i) => playerCell(c.cells[o.key], highlighted(c.winners, league).includes(o.key), `l|${i}|${o.key}`, fmtKickoff)).join("");
      return `<tr>${rowHead(o)}${cells}</tr>`;
    })
    .join("\n");
  const money = league.owners
    .map((o) => {
      const cells = cols.map((c) => moneyCell(c.money[o.key])).join("");
      return `<tr>${rowHead(o)}${cells}${moneyCell(result.lightning.net[o.key], "net ")}</tr>`;
    })
    .join("\n");
  const anyProv = cols.some((c) => c.provisional);
  return (
    wrap(`<table class="lightning"><thead>${head("")}</thead><tbody>\n${players}\n</tbody></table>`, anyProv) +
    `<h3>$ by column</h3>` +
    wrap(`<table class="grid"><thead>${head("<th>Net</th>")}</thead><tbody>\n${money}\n</tbody></table>`, anyProv)
  );
}

// ---------- Stats card (shown when a player's box is tapped) ----------

const yds = (n) => `${n < 0 ? "−" : ""}${Math.abs(n)} yds`;
const td = (n) => (n ? `, ${n} TD` : "");
const pts = (yardPts, tdPts) => (tdPts ? `${yardPts} + ${tdPts}` : `${yardPts}`);
const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// The stat lines of a saved stat line, one per category the player touched.
export function statRows(stats) {
  const s = Object.fromEntries(Object.entries(stats ?? {}).map(([k, v]) => [k, n0(v)]));
  const b = pointsBreakdown(s, s.twoPt);
  const rows = [];
  if (s.passAtt || s.passCmp || s.passYds || s.passTD) {
    rows.push({ label: "Pass", line: `${s.passCmp ?? 0}/${s.passAtt ?? 0}, ${yds(s.passYds ?? 0)}${td(s.passTD)}`, points: pts(b.pass.yards, b.pass.td) });
  }
  if (s.rushAtt || s.rushYds || s.rushTD) {
    rows.push({ label: "Rush", line: `${s.rushAtt ?? 0} car, ${yds(s.rushYds ?? 0)}${td(s.rushTD)}`, points: pts(b.rush.yards, b.rush.td) });
  }
  if (s.rec || s.recYds || s.recTD) {
    rows.push({ label: "Rec", line: `${s.rec ?? 0} rec, ${yds(s.recYds ?? 0)}${td(s.recTD)}`, points: pts(b.rec.yards, b.rec.td) });
  }
  if (b.twoPt) rows.push({ label: "2-pt", line: "conversion", points: String(b.twoPt) });
  return rows;
}

const STATE_LABEL = { live: "LIVE", final: "Final", dnp: "Did not play", bye: "Bye week", not_started: "Not started", unknown: "Not settled" };

// The card's HTML for one player box. `context` is e.g. "Kevin · QB3"; `fmtKickoff` formats an
// ISO kickoff time for a game not started yet; `loaded` is false while no live scores have
// loaded yet (every player then shows as unknown, which says nothing about their game).
export function renderCard(cell, context = "", fmtKickoff = null, loaded = true) {
  const g = cell.game;
  const matchup = g?.opp ? `${cell.team} ${g.home === true ? "vs" : g.home === false ? "@" : "v"} ${g.opp}` : cell.team ?? "";
  if (!loaded) {
    const sub = [context, matchup].filter(Boolean).map(esc).join(" · ");
    return (
      `<div class="card-head"><div><div class="card-name">${esc(cell.name)}</div><div class="card-sub">${sub}</div></div>` +
      `<button type="button" class="card-close" data-close aria-label="Close">×</button></div>` +
      `<p class="card-msg">Scores not loaded yet.</p>`
    );
  }
  let state = STATE_LABEL[cell.state] ?? "";
  if (cell.state === "not_started" && g?.kickoff && fmtKickoff) state = `Kickoff ${fmtKickoff(g.kickoff)}`;
  const sub = [context, matchup, state].filter(Boolean).map(esc).join(" · ");
  // Second line once the game is under way: "WSH 17 – NYG 10 · 8:42 - 3rd" (a saved week: "· Final").
  let scoreLine = "";
  if (g?.score && g.opp && ["live", "final", "dnp"].includes(cell.state)) {
    const status = cell.state === "live" ? g.detail : g.detail ?? "Final";
    scoreLine = [`${cell.team} ${g.score.team} – ${g.opp} ${g.score.opp}`, status].filter(Boolean).map(esc).join(" · ");
  }
  const head =
    `<div class="card-head"><div><div class="card-name">${esc(cell.name)}</div><div class="card-sub${cell.state === "live" ? " live" : ""}">${sub}</div>` +
    (scoreLine ? `<div class="card-score">${scoreLine}</div>` : "") +
    `</div>` +
    `<button type="button" class="card-close" data-close aria-label="Close">×</button></div>`;

  const rows = statRows(cell.stats);
  let body;
  if (rows.length) {
    body = `<table class="card-stats"><tbody>${rows
      .map((r) => `<tr><th scope="row">${esc(r.label)}</th><td class="line">${esc(r.line)}</td><td class="cpts">${esc(r.points)}</td></tr>`)
      .join("")}</tbody></table>`;
  } else if (cell.state === "final" && !cell.stats) {
    body = `<p class="card-msg">Stat line not saved for this week.</p>`;
  } else {
    const msg = {
      live: "No scoring stats yet.",
      final: "No scoring stats.",
      dnp: "No stats in the box score.",
      bye: "Team on bye: scores 0.",
      not_started: "Game not started yet.",
      unknown: "Game not finished or not found: the scorekeeper will settle it.",
    }[cell.state];
    body = `<p class="card-msg">${esc(msg ?? "")}</p>`;
  }

  let foot = "";
  if (cell.override) {
    const rules = cell.stats ? statsPoints(cell.stats) : cell.override.rules;
    foot =
      `<div class="card-total"><span>By the rules</span><strong>${esc(rules)}</strong></div>` +
      `<p class="card-note"><strong>* Settled at ${esc(cell.points)}</strong>, the official score.` +
      (cell.override.reason ? ` ${esc(cell.override.reason)}` : "") +
      `</p>`;
  } else if (!showsDash(cell.state) && cell.state !== "bye") {
    foot = `<div class="card-total"><span>${cell.state === "live" ? "So far" : "Total"}</span><strong>${esc(cell.points)}</strong></div>`;
  }
  return head + body + foot;
}

// ---------- Sorting (settlement and standings tables) ----------

// A sort is {key, dir: "asc" | "desc"}; null means league order.
// Clicking a column: first click sorts (names A to Z, numbers high to low), second reverses,
// third returns to league order.
export function nextSort(current, key) {
  const first = key === "team" ? "asc" : "desc";
  if (current?.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

// Owners in sorted order. `valueOf(owner)` gives the value for the sorted column; when the
// column is unknown or has no values, league order is kept. Equal values keep league order.
function sortedOwners(league, sort, valueOf) {
  const owners = [...league.owners];
  if (!sort) return owners;
  const values = new Map(owners.map((o) => [o.key, valueOf(o)]));
  if (owners.some((o) => values.get(o.key) === undefined || values.get(o.key) === null)) return owners;
  const sign = sort.dir === "asc" ? 1 : -1;
  return owners.sort((a, b) => {
    const x = values.get(a.key);
    const y = values.get(b.key);
    return sign * (typeof x === "string" ? x.localeCompare(y) : x - y);
  });
}

// A column header that sorts when clicked. `label` is already-escaped HTML.
function sortHead(key, label, sort) {
  const on = sort?.key === key;
  const aria = on ? ` aria-sort="${sort.dir === "asc" ? "ascending" : "descending"}"` : "";
  const arrow = on ? `<span class="arrow" aria-hidden="true"> ${sort.dir === "asc" ? "▲" : "▼"}</span>` : "";
  return `<th${aria}><button type="button" class="sort" data-sort="${esc(key)}">${label}${arrow}</button></th>`;
}

export function renderSettlement(result, league, sort = null) {
  const value = (o) => (sort.key === "team" ? o.display : result.settlement[o.key][sort.key]);
  const rows = sortedOwners(league, sort, value)
    .map((o) => {
      const s = result.settlement[o.key];
      return `<tr>${rowHead(o)}${moneyCell(s.lightning)}${moneyCell(s.teamPot)}${moneyCell(s.total, "net ")}</tr>`;
    })
    .join("\n");
  const cols = [["team", "Team"], ["lightning", "Lightning"], ["teamPot", "Team pot"], ["total", "Week"]];
  const head = `<tr>${cols.map(([key, label]) => sortHead(key, label, sort)).join("")}</tr>`;
  const label = result.final ? "" : `<p class="pot">${note("provisional")} games still to finish</p>`;
  return `${wrap(`<table class="grid"><thead>${head}</thead><tbody>\n${rows}\n</tbody></table>`, !result.final)}${label}`;
}

// `thruWeek` picks which recorded week the "Thru Wk" column runs through (default: the latest).
export function renderStandings(standings, league, sort = null, thruWeek = null) {
  const open = standings.open;
  const history = standings.history ?? [];
  const picked = history.find((h) => h.week === thruWeek) ?? null;
  const thru = picked ?? { week: standings.recordedThrough, totals: standings.base };
  // With more than one recorded point to choose from, the header is a week picker plus a sort button.
  const thruHead = () => {
    if (history.length < 2) return sortHead("base", `Thru Wk ${esc(thru.week)}`, sort);
    const on = sort?.key === "base";
    const aria = on ? ` aria-sort="${sort.dir === "asc" ? "ascending" : "descending"}"` : "";
    const options = history
      .map((h) => `<option value="${esc(h.week)}"${h.week === thru.week ? " selected" : ""}>Thru Wk ${esc(h.week)}</option>`)
      .join("");
    const arrow = on ? (sort.dir === "asc" ? "▲" : "▼") : "⇅";
    return (
      `<th${aria}><select class="thru" data-thru aria-label="Standings through week">${options}</select>` +
      `<button type="button" class="sort inline" data-sort="base" aria-label="Sort by this column">${arrow}</button></th>`
    );
  };
  const weekKey = (w) => `wk-${w.week}`;
  const weekHead = (w) =>
    sortHead(weekKey(w), `Wk ${esc(w.week)}${w.amounts ? (w.provisional ? note("provisional") : "") : note("not loaded")}`, sort);
  const head =
    `<tr>${sortHead("team", "Team", sort)}${thruHead()}` +
    `${open.map(weekHead).join("")}${sortHead("total", "Total", sort)}${sortHead("order", "Order", sort)}</tr>`;
  const value = (o) => {
    if (sort.key === "team") return o.display;
    if (sort.key === "base") return thru.totals[o.key];
    if (sort.key === "total") return standings.totals[o.key];
    if (sort.key === "order") return standings.order[o.key];
    return open.find((w) => weekKey(w) === sort.key)?.amounts?.[o.key];
  };
  const rows = sortedOwners(league, sort, value)
    .map((o) => {
      const weeks = open.map((w) => (w.amounts ? moneyCell(w.amounts[o.key]) : `<td class="money">${DASH}</td>`)).join("");
      const total = moneyCell(standings.totals[o.key], "net ");
      return `<tr>${rowHead(o)}${moneyCell(thru.totals[o.key])}${weeks}${total}<td class="order">${esc(standings.order[o.key])}</td></tr>`;
    })
    .join("\n");
  const table = `<table class="grid standings"><thead>${head}</thead><tbody>\n${rows}\n</tbody></table>`;
  return wrap(table, open.some((w) => w.provisional));
}

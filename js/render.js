// Presentation helpers: pure string builders, no DOM. Shared by the page and the CLI.

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
  return `<td class="${extra}money${sign}">${fmtMoney(cents)}</td>`;
};
const note = (text) => `<span class="note">${esc(text)}</span>`;
const playerCell = (c, highlight) => {
  const tag = STATE_TAG[c.state] ? `<span class="tag ${c.state}">${STATE_TAG[c.state]}</span>` : "";
  const points = showsDash(c.state) ? DASH : c.points;
  return `<td class="cell${highlight ? " win" : ""} ${c.state}"><span class="pname">${esc(c.name)}</span><span class="pts">${points}</span>${tag}</td>`;
};
const wrap = (table, provisional) => `<div class="table-wrap${provisional ? " prov" : ""}">${table}</div>`;
const rowHead = (owner) => `<th scope="row">${esc(owner.display)}</th>`;
const names = (keys, league) => keys.map((k) => league.owners.find((o) => o.key === k)?.display ?? k).join(" & ");
// A contest where everybody is level (typically all on 0) has no winner worth highlighting.
const highlighted = (winners, league) => (winners.length < league.owners.length ? winners : []);

export function renderTeamTable(result, league, columns) {
  const { team } = result;
  const win = highlighted(team.winners, league);
  const head = `<tr><th>Team</th>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}<th>Total</th></tr>`;
  const rows = league.owners
    .map((o) => {
      const row = team.rows[o.key];
      const cells = row.players.map((c) => playerCell(c, false)).join("");
      return `<tr${win.includes(o.key) ? ' class="win"' : ""}>\n${rowHead(o)}${cells}<td class="total">${row.total}</td></tr>`;
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

export function renderLightning(result, league) {
  const cols = result.lightning.columns;
  const head = (extra) => {
    const cells = cols.map((c) => `<th>${esc(c.name)}${c.provisional && c.started ? note("provisional") : ""}</th>`).join("");
    return `<tr><th>Team</th>${cells}${extra}</tr>`;
  };
  const players = league.owners
    .map((o) => {
      const cells = cols.map((c) => playerCell(c.cells[o.key], highlighted(c.winners, league).includes(o.key))).join("");
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
      return `<tr>${rowHead(o)}${moneyCell(thru.totals[o.key])}${weeks}${total}<td class="order">${standings.order[o.key]}</td></tr>`;
    })
    .join("\n");
  const table = `<table class="grid standings"><thead>${head}</thead><tbody>\n${rows}\n</tbody></table>`;
  return wrap(table, open.some((w) => w.provisional));
}

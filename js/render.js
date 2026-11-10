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

export function renderSettlement(result, league) {
  const rows = league.owners
    .map((o) => {
      const s = result.settlement[o.key];
      return `<tr>${rowHead(o)}${moneyCell(s.lightning)}${moneyCell(s.teamPot)}${moneyCell(s.total, "net ")}</tr>`;
    })
    .join("\n");
  const head = "<tr><th>Team</th><th>Lightning</th><th>Team pot</th><th>Week</th></tr>";
  const label = result.final ? "" : `<p class="pot">${note("provisional")} games still to finish</p>`;
  return `${wrap(`<table class="grid"><thead>${head}</thead><tbody>\n${rows}\n</tbody></table>`, !result.final)}${label}`;
}

export function renderStandings(standings, league) {
  const open = standings.open;
  const weekHead = (w) => `<th>Wk ${w.week}${w.amounts ? (w.provisional ? note("provisional") : "") : note("not loaded")}</th>`;
  const head = `<tr><th>Team</th><th>Thru Wk ${standings.recordedThrough}</th>${open.map(weekHead).join("")}<th>Total</th><th>Order</th></tr>`;
  const rows = league.owners
    .map((o) => {
      const weeks = open.map((w) => (w.amounts ? moneyCell(w.amounts[o.key]) : `<td class="money">${DASH}</td>`)).join("");
      const total = moneyCell(standings.totals[o.key], "net ");
      return `<tr>${rowHead(o)}${moneyCell(standings.base[o.key])}${weeks}${total}<td class="order">${standings.order[o.key]}</td></tr>`;
    })
    .join("\n");
  const table = `<table class="grid standings"><thead>${head}</thead><tbody>\n${rows}\n</tbody></table>`;
  return wrap(table, open.some((w) => w.provisional));
}

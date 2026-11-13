// Browser glue: load the data files, build the model (js/view.js), render it, and keep it fresh.
import { newState, refresh, statusLine, bannerLines, checkIndex, keptRecorded } from "./view.js";
import { renderTeamTable, renderLightning, renderSettlement, renderStandings, renderCard, nextSort, esc } from "./render.js";

const TIMEOUT_MS = 15000;
const RETRY_MS = 60000;
const $ = (id) => document.getElementById(id);
const hhmm = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
// "Sun 1:00 PM" in the viewer's own time zone
const kickoff = (iso) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
const weekPath = (w) => `data/weeks/${w.season}-${String(w.week).padStart(2, "0")}.json`;

// Our own data files: always revalidate, so a new publish shows up without a hard refresh.
async function getData(path) {
  let r;
  try {
    r = await fetch(path, { cache: "no-cache", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error(`Could not load ${path}`);
  }
  if (!r.ok) throw new Error(`Could not load ${path} (HTTP ${r.status})`);
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  if (data === null || typeof data !== "object") throw new Error(`${path} does not hold the expected data`);
  return data;
}

async function loadData() {
  const [league, baseline, index] = await Promise.all([
    getData("data/league.json"),
    getData("data/baseline.json"),
    getData("data/weeks/index.json"),
  ]);
  checkIndex(index);
  if (!Array.isArray(league.owners)) throw new Error("data/league.json does not list the owners");
  const weekFiles = await Promise.all(index.map((w) => keptRecorded(w, state) ?? getData(weekPath(w))));
  return { league, baseline, weekFiles };
}

async function espnFetch(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let state = null;
let model = null;
let picked = null; // week chosen by the viewer; null = follow the default
let timer = null;
let loading = false;
let lastLoadAt = 0;
let failed = false; // the last load could not finish; try again soon
const shownHtml = {};
const sorts = { settlement: null, standings: null }; // column each table is sorted by; null = league order
let shownProblem = null;
let thruWeek = null; // week the standings' "Thru Wk" column runs through; null = the latest recorded
let shown = null; // {result, weekFile} for the week on screen, so a tapped player box can be found
let cardKey = null; // the player box whose stats card is open

// Replace an element's HTML only when it changed, keeping each table's sideways scroll position.
function setHtml(id, html) {
  if (shownHtml[id] === html) return;
  const el = $(id);
  const scrolls = [...el.querySelectorAll(".table-wrap")].map((w) => w.scrollLeft);
  el.innerHTML = html;
  shownHtml[id] = html;
  el.querySelectorAll(".table-wrap").forEach((w, i) => {
    if (scrolls[i]) w.scrollLeft = scrolls[i];
  });
}

function banner(messages, isError = false) {
  const el = $("banner");
  el.hidden = messages.length === 0;
  el.className = isError ? "error" : "";
  setHtml("banner", messages.map((m) => `<p>${esc(m)}</p>`).join(""));
}

function render(dataProblem) {
  shownProblem = dataProblem;
  const { league } = state;
  if (picked !== null && !model.weeks.some((w) => w.week === picked)) picked = null;
  const selected = picked ?? model.defaultWeek;
  const week = model.weeks.find((w) => w.week === selected) ?? null;

  $("league").textContent = league.name ?? "Sunday Tables";
  setHtml("week", model.weeks.map((w) => `<option value="${esc(w.week)}">Week ${esc(w.week)}</option>`).join(""));
  if (week) $("week").value = String(week.week);
  $("week").hidden = model.weeks.length === 0;
  $("updated").textContent = `checked ${hhmm(new Date(lastLoadAt))}`;

  const messages = bannerLines(model, week, hhmm);
  if (dataProblem) messages.unshift(`${dataProblem} — showing what was loaded earlier`);
  banner(messages);

  $("status").textContent = week ? statusLine(week) : "No weeks published yet.";
  const result = week?.result ?? week?.placeholder ?? null;
  const weekFile = week && state.weekFiles.find((f) => f.season === week.season && f.week === week.week);
  shown = result ? { result, weekFile, loaded: Boolean(week.result) } : null;
  setHtml("team", result ? renderTeamTable(result, league, weekFile.team_table.columns, kickoff) : "");
  setHtml("lightning", result ? renderLightning(result, league, kickoff) : "");
  // No settlement to show until some real scores have loaded.
  setHtml("settlement", week?.result ? renderSettlement(week.result, league, sorts.settlement) : "");
  setHtml(
    "standings",
    model.standings ? renderStandings(model.standings, league, sorts.standings, thruWeek) : `<p class="pot">Standings cannot be shown: ${esc(model.standingsProblem)}</p>`,
  );
  document.body.classList.remove("empty");
  document.body.classList.toggle("noweek", !result);
  document.body.classList.toggle("nosettlement", !week?.result);
  if (cardKey) showCard(cardKey); // keep an open card up to date with live scores
}

// ---------- Stats card ----------


// The player cell and its label ("Kevin · QB3") for a box key from js/render.js, or null.
function cardCell(key) {
  if (!shown) return null;
  const [table, a, b] = key.split("|");
  const owner = (k) => state.league.owners.find((o) => o.key === k)?.display ?? k;
  if (table === "t") {
    const cell = shown.result.team.rows[a]?.players[Number(b)];
    return cell ? { cell, context: `${owner(a)} · ${shown.weekFile.team_table.columns[Number(b)]}` } : null;
  }
  const col = shown.result.lightning.columns[Number(a)];
  const cell = col?.cells[b];
  return cell ? { cell, context: `${owner(b)} · ${col.name}` } : null;
}

function showCard(key) {
  const dialog = $("card");
  const found = cardCell(key);
  if (!found) {
    if (dialog.open) dialog.close();
    return;
  }
  cardKey = key;
  setHtml("card-body", renderCard(found.cell, found.context, kickoff, shown.loaded));
  if (!dialog.open) dialog.showModal();
}

for (const id of ["team", "lightning"]) {
  $(id).addEventListener("click", (e) => {
    const key = e.target.closest?.("button[data-card]")?.dataset.card;
    if (key) showCard(key);
  });
}
// Close on the × button or a tap outside the card (the backdrop is the dialog element itself).
$("card").addEventListener("click", (e) => {
  if (e.target === $("card") || e.target.closest?.("[data-close]")) $("card").close();
});
$("card").addEventListener("close", () => {
  // put keyboard focus back on the box the card came from
  const key = cardKey;
  cardKey = null;
  [...document.querySelectorAll("button[data-card]")].find((b) => b.dataset.card === key)?.focus();
});

// Nothing can be shown at all (first load failed): say why and keep trying.
function fatal(message) {
  banner([message], true);
  $("status").textContent = "";
  document.body.classList.add("empty");
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  const delay = failed ? RETRY_MS : model?.pollMs;
  if (delay && !document.hidden) timer = setTimeout(load, delay);
}

async function load() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  failed = false;
  try {
    // Re-read the data files every time (recorded weeks excepted: see keptRecorded), so a newly
    // published week appears in an open tab. If that fails but an earlier load worked, keep
    // showing the earlier data.
    let dataProblem = null;
    try {
      state = newState(await loadData(), state);
    } catch (err) {
      if (!state) throw err;
      dataProblem = err.message;
      failed = true;
    }
    model = await refresh(state, espnFetch);
    lastLoadAt = Date.now();
    render(dataProblem);
  } catch (err) {
    failed = true;
    if (model) banner([`Could not refresh: ${err.message}`], true);
    else fatal(err.message);
  } finally {
    loading = false;
    $("refresh").disabled = false;
    schedule();
  }
}

$("week").addEventListener("change", (e) => {
  picked = Number(e.target.value);
  if (model) render(null);
});
$("refresh").addEventListener("click", load);
// The week picker in the standings header.
$("standings").addEventListener("change", (e) => {
  if (!e.target.matches?.("select[data-thru]") || !model) return;
  const week = Number(e.target.value);
  // picking the latest week means "follow the latest", so a newly recorded week takes over
  thruWeek = week === model.standings?.recordedThrough ? null : week;
  render(shownProblem);
  $("standings").querySelector("select[data-thru]")?.focus();
});
// Clicking a column header in the settlement or standings table sorts by that column.
for (const id of Object.keys(sorts)) {
  $(id).addEventListener("click", (e) => {
    const key = e.target.closest?.("button[data-sort]")?.dataset.sort;
    if (!key || !model) return;
    sorts[id] = nextSort(sorts[id], key);
    render(shownProblem);
    // the header was rebuilt; keep keyboard focus on the column just used
    [...$(id).querySelectorAll("button[data-sort]")].find((b) => b.dataset.sort === key)?.focus();
  });
}
// A hidden tab stops polling; when it comes back, catch up straight away if it has been a while.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(timer);
  else if (Date.now() - lastLoadAt > RETRY_MS) load();
  else schedule();
});
load();

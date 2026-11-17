// Browser glue: load the data files, build the model (js/view.js), render it, and keep it fresh.
import { newState, refresh, statusLine, bannerLines, checkIndex, keptRecorded } from "./view.js";
import { renderTeamTable, renderLightning, renderSettlement, renderStandings, renderCard, nextSort, esc } from "./render.js";
import { scoreItems, seasonFacts, tickerItems, hasLiveGame } from "./ticker.js";

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
let quipTurn = 0; // which ticker item is showing; moves on every few seconds and on a tap

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
  showQuip(); // the ticker keeps its place; new scores just update the items
}

// ---------- Live score ticker ----------
// (js/banter.js, the league commentary, is kept for later but not used yet.)

// The ticker shows ESPN's current NFL week, whichever week the viewer is looking at below (and
// even before that week is on the site): every game's score, with a league fun fact after every
// few games. It is only up while a game is being played.
const TICK_MS = 4500;
let tickerList = [];

function buildTicker() {
  // ESPN's current NFL week (see js/view.js); the ticker is only up while a game is being played
  const scoreboard = model.tickerScoreboard;
  if (!hasLiveGame(scoreboard)) return [];
  const games = scoreItems(scoreboard, kickoff, isToday);
  const every = 3;
  // each pass through the games shows the next facts along
  return tickerItems({ games, comments: seasonFacts(model.weeks, state.league), every, turn: tickerPass * Math.floor(games.length / every) });
}
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();

// The rule that keeps the ticker moving: whenever the bar is up, a tick is pending. The pending
// tick is cleared when the bar hides, and set again whenever it shows (also after a gap between
// games, e.g. from the late afternoon games into the night game).
function showQuip() {
  const el = $("quip");
  tickerList = buildTicker();
  if (!tickerList.length) {
    el.hidden = true;
    stopTick();
    quipTurn = 0; // when it comes back (the next game), start with the live games
    shownTurn = null;
    return;
  }
  el.hidden = false;
  const item = tickerList[quipTurn % tickerList.length];
  const moved = shownTurn !== null && shownTurn !== quipTurn;
  shownTurn = quipTurn;
  const put = () => {
    $("quip-dot").hidden = !item.live;
    $("quip-text").classList.toggle("fact", Boolean(item.comment));
    const run = $("quip-run");
    if (run.textContent !== item.text) {
      run.getAnimations().forEach((a) => a.cancel());
      run.textContent = item.text;
      scrollRun();
      scheduleTick(); // a new item gets its own full time on screen
    } else if (tickTimer === null) {
      scheduleTick(); // same words, but nothing pending (the bar just came back): start again
    }
  };
  if (flipping && !moved) return; // a refresh in the middle of a flip: the flip shows the item
  // Moving to the next item flips it in: the old one slides up and out, the new one up into
  // place. A refresh that only updates the score of the item on show just changes the text.
  if (!moved || reduceMotion.matches || !$("quip-text").animate) return put();
  const box = $("quip-body");
  const flip = ++flipCount;
  flipping = true;
  box.getAnimations().forEach((a) => a.cancel());
  const done = () => {
    if (flip !== flipCount) return; // a newer flip (a quick second tap) took over
    flipping = false;
    put();
    box.animate([{ transform: "translateY(70%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 220, easing: "ease-out" });
  };
  box
    .animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-70%)", opacity: 0 }], { duration: 160, easing: "ease-in" })
    .finished.then(done, done);
}
let shownTurn = null; // the ticker item on screen, so a flip only plays when it changes
let flipping = false;
let flipCount = 0;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// The bar is one line. An item too long for it (a fun fact) waits a moment so its start
// can be read, scrolls left at reading speed until its end is in view, and holds there; the
// next item comes after that. With reduced motion it wraps onto two lines instead.
const SCROLL_PX_PER_S = 55;
const SCROLL_WAIT_MS = 1000;
const SCROLL_HOLD_MS = 1300;
let dwell = TICK_MS; // how long the item on show stays up
function scrollRun() {
  const run = $("quip-run");
  const over = run.offsetWidth - $("quip-text").clientWidth;
  dwell = TICK_MS;
  if (over <= 2 || reduceMotion.matches || !run.animate) return;
  const ms = (over / SCROLL_PX_PER_S) * 1000;
  run.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-over}px)` }], {
    duration: ms,
    delay: SCROLL_WAIT_MS,
    easing: "linear",
    fill: "forwards",
  });
  dwell = Math.max(TICK_MS, SCROLL_WAIT_MS + ms + SCROLL_HOLD_MS);
}

let tickerPass = 0; // full passes through the games so far; moves the comments along each pass
function nextQuip() {
  if (!model || $("quip").hidden) return;
  quipTurn++;
  if (quipTurn >= tickerList.length) {
    // the end of a pass (also when the list got shorter): start over, with the next facts
    quipTurn = 0;
    tickerPass++;
  }
  showQuip();
}
// Each new item sets its own time on screen; a hidden tab just waits. `tickTimer` is null
// exactly when no tick is pending.
let tickTimer = null;
function scheduleTick() {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(() => {
    tickTimer = null;
    if (document.hidden) scheduleTick();
    else nextQuip();
  }, dwell);
}
function stopTick() {
  clearTimeout(tickTimer);
  tickTimer = null;
}
$("quip-text").addEventListener("click", () => {
  stopTick(); // a tap moves on now; the next item gets its full time
  nextQuip();
});

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
      const data = await loadData();
      state = newState(data, state);
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

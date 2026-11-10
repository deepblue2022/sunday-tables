// Browser glue: load the data files, build the model (js/view.js), render it, and keep it fresh.
import { newState, refresh } from "./view.js";
import { renderTeamTable, renderLightning, renderSettlement, renderStandings, esc } from "./render.js";

const $ = (id) => document.getElementById(id);
const hhmm = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const weekPath = (w) => `data/weeks/${w.season}-${String(w.week).padStart(2, "0")}.json`;

// Our own data files: always revalidate, so a new publish shows up without a hard refresh.
async function getData(path) {
  let r;
  try {
    r = await fetch(path, { cache: "no-cache" });
  } catch {
    throw new Error(`Could not load ${path}`);
  }
  if (!r.ok) throw new Error(`Could not load ${path} (HTTP ${r.status})`);
  try {
    return await r.json();
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

async function espnFetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let state = null;
let model = null;
let picked = null; // week chosen by the viewer; null = follow the default
let timer = null;
let loading = false;
let lastLoadAt = 0;

function banner(messages, isError = false) {
  const el = $("banner");
  el.hidden = messages.length === 0;
  el.className = isError ? "error" : "";
  el.innerHTML = messages.map((m) => `<p>${esc(m)}</p>`).join("");
}

function render() {
  const { league } = state;
  const selected = picked ?? model.defaultWeek;
  const week = model.weeks.find((w) => w.week === selected) ?? model.weeks[model.weeks.length - 1];

  $("league").textContent = league.name;
  $("week").innerHTML = model.weeks
    .map((w) => `<option value="${w.week}"${w === week ? " selected" : ""}>Week ${w.week}</option>`)
    .join("");
  $("updated").textContent = `updated ${hhmm(new Date(lastLoadAt))}`;

  const messages = [];
  if (model.unavailable) {
    messages.push(model.dataFrom ? `Live stats unavailable — showing data from ${hhmm(model.dataFrom)}` : "Live stats unavailable — no scores yet");
  }
  if (model.gameErrors) messages.push("Some games could not be loaded; their players show “?”.");
  banner(messages);

  const shown = week?.result ?? week?.placeholder ?? null;
  const weekFile = week && state.weekFiles.find((f) => f.week === week.week);
  if (!week) {
    $("status").textContent = "No weeks published yet.";
  } else if (week.problem) {
    $("status").textContent = `Week ${week.week} cannot be shown: ${week.problem}`;
  } else if (week.recorded) {
    $("status").textContent = `Week ${week.week} · final`;
  } else if (week.result?.final) {
    $("status").textContent = `Week ${week.week} · final (not yet added to the standings)`;
  } else {
    $("status").textContent = `Week ${week.week} · provisional — games still to finish`;
  }
  $("team").innerHTML = shown ? renderTeamTable(shown, league, weekFile.team_table.columns) : "";
  $("lightning").innerHTML = shown ? renderLightning(shown, league) : "";
  $("settlement").innerHTML = shown ? renderSettlement(shown, league) : "";
  $("standings").innerHTML = model.standings
    ? renderStandings(model.standings, league)
    : `<p class="pot">Standings cannot be shown: ${esc(model.standingsProblem)}</p>`;
  document.body.classList.toggle("empty", !shown);
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  if (model?.pollMs && !document.hidden) timer = setTimeout(load, model.pollMs);
}

async function load() {
  if (loading || !state) return;
  loading = true;
  $("refresh").disabled = true;
  try {
    model = await refresh(state, espnFetch);
    lastLoadAt = Date.now();
    render();
  } catch (err) {
    banner([`Something went wrong: ${err.message}`], true);
  } finally {
    loading = false;
    $("refresh").disabled = false;
    schedule();
  }
}

async function start() {
  try {
    const [league, baseline, index] = await Promise.all([
      getData("data/league.json"),
      getData("data/baseline.json"),
      getData("data/weeks/index.json"),
    ]);
    const weekFiles = await Promise.all(index.map((w) => getData(weekPath(w))));
    state = newState({ league, baseline, weekFiles });
  } catch (err) {
    banner([err.message], true);
    return;
  }
  $("week").addEventListener("change", (e) => {
    picked = Number(e.target.value);
    render();
  });
  $("refresh").addEventListener("click", load);
  // A tab that was hidden stops polling; when it comes back, catch up straight away if stale.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else if (model?.pollMs && Date.now() - lastLoadAt > 60000) load();
    else schedule();
  });
  await load();
}

start();

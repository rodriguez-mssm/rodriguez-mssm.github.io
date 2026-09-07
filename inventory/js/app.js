import { api } from "./api.js";
import { configured, supabase } from "./supabase.js";
import { SAMPLE_TYPES, availableQuantity, formatQuantity, typeConfig } from "./sample-types.js";
import { aliquotSourceAllocation, plannedVialCount, sourceAllocation, validateAllocation, totalMassNg, suggestVialVolumes, additionalVialsRequired, validateDistribution } from "./calculations.js";
import { generateLabelPdf } from "./labels.js";
import { emptyInventoryHtml, scannerUnavailableHtml } from "./ui-state.js";
import { buildProcessingPlanPayload } from "./processing-payload.js";

const app = document.querySelector("#app");
const header = document.querySelector(".app-header");
const nav = document.querySelector("#navigation");
let profile = null;
let scanner = null;
let outputs = [];

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
const number = (value) => value === "" ? null : Number(value);
const typeOptions = (selected = "") => Object.entries(SAMPLE_TYPES).map(([key, item]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${item.label}</option>`).join("");
const statusBadge = (status) => `<span class="badge ${status}">${escapeHtml(status)}</span>`;
const errorMessage = (error) => escapeHtml(error?.message || String(error));

function toast(message) {
  const node = document.querySelector("#toast"); node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 2600);
}
function page(title, intro = "") { return `<p class="eyebrow">Laboratory inventory</p><h1>${title}</h1>${intro ? `<p class="muted">${intro}</p>` : ""}`; }
function stopScanner() { scanner?.stop(); scanner = null; }

async function startScanner(element, onScan) {
  const { SampleScanner } = await import("./scanner.js");
  const nextScanner = new SampleScanner(element, onScan);
  scanner = nextScanner;
  try {
    await nextScanner.start();
    return nextScanner;
  } catch (error) {
    nextScanner.stop();
    scanner = null;
    throw error;
  }
}

async function boot() {
  if (!configured) return renderSetup();
  const session = await api.session();
  if (!session) return renderLogin();
  try {
    profile = await api.profile();
    if (!profile.approved || profile.disabled_at) return renderNotApproved();
    header.hidden = false;
    route();
  } catch (error) { renderNotApproved(error); }
  supabase.auth.onAuthStateChange((_event, next) => { if (!next) renderLogin(); });
}

function renderSetup() {
  header.hidden = true;
  app.innerHTML = `<section class="login-shell card"><div class="logo">RL</div><h1>Setup required</h1><p>Set the Supabase project URL and public anon key in <code>inventory/config.js</code>, then apply the SQL migrations.</p><p><a href="./README.md">Open setup guide</a></p></section>`;
}

function renderLogin(message = "") {
  stopScanner(); header.hidden = true;
  app.innerHTML = `<section class="login-shell card"><div class="logo">RL</div><h1>Lab inventory</h1><p class="muted">Sign in with your approved laboratory account.</p>${message ? `<p class="error">${escapeHtml(message)}</p>` : ""}<form id="login-form"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button></form><p class="hint">Inventory data is not available without authentication.</p></section>`;
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.target.querySelector("button"); button.disabled = true;
    try { await api.signIn(event.target.email.value, event.target.password.value); location.reload(); }
    catch (error) { renderLogin(error.message); }
  });
}

function renderNotApproved(error) {
  header.hidden = true;
  app.innerHTML = `<section class="login-shell card"><h1>Access pending</h1><p>Your account is authenticated but is not approved for inventory access.</p>${error ? `<p class="error">${errorMessage(error)}</p>` : ""}<button id="pending-signout">Sign out</button></section>`;
  document.querySelector("#pending-signout").onclick = () => api.signOut().then(() => renderLogin());
}

async function route() {
  stopScanner(); nav.classList.remove("open");
  const path = location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
  const routes = { home: renderHome, process: renderProcess, pending: renderPending, confirm: renderConfirm, search: renderSearch, register: renderRegister };
  try { await (routes[path] || renderHome)(); }
  catch (error) { app.innerHTML = `${page("Something went wrong")}<p class="error">${errorMessage(error)}</p><button onclick="location.reload()">Try again</button>`; }
}

function renderHome() {
  app.innerHTML = `${page(`Welcome${profile?.display_name ? `, ${escapeHtml(profile.display_name)}` : ""}`, "Choose a bench workflow.")}<section class="card-grid"><a class="card" href="#/process"><h2>Process sample</h2><p>Plan aliquots or extractions and reserve labels.</p></a><a class="card" href="#/pending"><h2>Pending processing</h2><p>Record DNA or RNA extraction results.</p></a><a class="card" href="#/confirm"><h2>Confirm samples</h2><p>Scan labels and activate physical tubes.</p></a><a class="card" href="#/search"><h2>Search inventory</h2><p>Find samples, measurements, history, and lineage.</p></a><a class="card" href="#/register"><h2>Register source</h2><p>Add a pre-existing source tube to begin processing.</p></a></section>`;
}

function renderRegister() {
  app.innerHTML = `${page("Register source sample", "Use laboratory identifiers only. Do not enter PHI.")}<form id="register-form" class="panel"><div class="row"><label>Sample type<select name="sampleType">${typeOptions()}</select></label><label>External/lab reference (optional)<input name="externalId" maxlength="80"></label></div><div id="register-quantity"></div><label>Notes<textarea name="notes" rows="2"></textarea></label><button>Register active source</button></form><div id="register-result"></div>`;
  const form = document.querySelector("#register-form");
  const showFields = () => {
    const dim = typeConfig(form.sampleType.value).dimension;
    document.querySelector("#register-quantity").innerHTML = dim === "CELLS" ? `<label>Cell count (million)<input name="cellCount" type="number" min="0" step="any" required></label>` : `<div class="row"><label>Volume (µL)<input name="volume" type="number" min="0" step="any" required></label>${dim === "NUCLEIC_ACID" ? `<label>Concentration (ng/µL)<input name="concentration" type="number" min="0" step="any"></label>` : ""}</div>`;
  };
  form.sampleType.onchange = showFields; showFields();
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const result = await api.registerSource({ sample_type: form.sampleType.value, external_id: form.externalId.value || null, cell_count_million: number(form.cellCount?.value), volume_ul: number(form.volume?.value), concentration_ng_ul: number(form.concentration?.value), notes: form.notes.value || null });
      document.querySelector("#register-result").innerHTML = `<p class="success">Registered <strong>${escapeHtml(result.sample_id)}</strong>.</p>`; form.reset(); showFields();
    } catch (error) { document.querySelector("#register-result").innerHTML = `<p class="error">${errorMessage(error)}</p>`; }
  };
}

function renderProcess() {
  outputs = [];
  app.innerHTML = `${page("Process sample", "Select one active source, then add all outputs from this processing session.")}<section class="panel"><form id="source-search" class="row"><label>Source Sample ID<input name="term" placeholder="PBMC-000001" autocomplete="off" required></label><button>Find source</button><button id="scan-source" type="button" class="secondary">Scan source</button></form><div id="source-scanner"></div><div id="source-results"></div></section><div id="plan-area"></div>`;
  const findSource = async (term) => {
    const area = document.querySelector("#source-results"); area.innerHTML = `<p>Searching…</p>`;
    try {
      const rows = await api.findSamples(term.trim(), true);
      area.innerHTML = rows.length ? rows.map((sample) => `<button class="secondary choose-source" data-id="${sample.sample_id}">${escapeHtml(sample.sample_id)} · ${escapeHtml(sample.sample_type)} · ${formatQuantity(sample)}</button>`).join(" ") : `<p class="warning">No active sample found.</p>`;
      area.querySelectorAll(".choose-source").forEach((button) => button.onclick = () => { stopScanner(); document.querySelector("#source-scanner").replaceChildren(); buildPlan(rows.find((row) => row.sample_id === button.dataset.id)); });
    } catch (error) { area.innerHTML = `<p class="error">${errorMessage(error)}</p>`; }
  };
  document.querySelector("#source-search").onsubmit = async (event) => {
    event.preventDefault(); await findSource(event.target.term.value);
  };
  document.querySelector("#scan-source").onclick = async () => {
    try { await startScanner(document.querySelector("#source-scanner"), findSource); }
    catch (error) { document.querySelector("#source-results").innerHTML = scannerUnavailableHtml(errorMessage(error)); }
  };
}

function buildPlan(source) {
  const available = availableQuantity(source); const unit = typeConfig(source.sample_type).unit;
  document.querySelector("#plan-area").innerHTML = `<section class="panel"><h2>${escapeHtml(source.sample_id)}</h2><p>${escapeHtml(source.sample_type)} · Available: <strong>${available.toLocaleString()} ${unit}</strong></p><div id="outputs"></div><div class="row"><button id="add-output" class="secondary">+ Add output</button></div><div id="allocation"></div><label>Processing notes<textarea id="plan-notes" rows="2"></textarea></label><button id="create-plan" disabled>Create plan and reserve labels</button><div id="plan-result"></div></section>`;
  document.querySelector("#add-output").onclick = () => { outputs.push({ type: source.sample_type, mode: "ALIQUOT" }); drawOutputs(source); };
  document.querySelector("#create-plan").onclick = () => submitPlan(source);
  outputs.push({ type: source.sample_type, mode: "ALIQUOT" }); drawOutputs(source);
}

function drawOutputs(source) {
  const holder = document.querySelector("#outputs");
  holder.innerHTML = outputs.map((output, index) => outputEditor(output, index)).join("");
  holder.querySelectorAll("input,select").forEach((input) => input.oninput = () => updateOutputFromForm(input.closest(".output-card"), source));
  holder.querySelectorAll(".remove-output").forEach((button) => button.onclick = () => { outputs.splice(Number(button.dataset.index), 1); drawOutputs(source); });
  updateAllocation(source);
}

function outputEditor(output, index) {
  const config = typeConfig(output.type); const extraction = config.dimension === "NUCLEIC_ACID" && output.mode === "EXTRACTION";
  return `<article class="card output-card" data-index="${index}"><div class="row"><label>Output type<select name="type">${typeOptions(output.type)}</select></label><label>Operation<select name="mode"><option value="ALIQUOT" ${output.mode === "ALIQUOT" ? "selected" : ""}>Aliquot / divide</option><option value="EXTRACTION" ${output.mode === "EXTRACTION" ? "selected" : ""}>Extraction</option></select></label><button class="danger remove-output" data-index="${index}">Remove</button></div>${extraction ? `<div class="row"><label>Source input allocation<input name="sourceAllocation" type="number" min="0" step="any" value="${output.sourceAllocation ?? ""}" required></label><label>Expected output volume (µL)<input name="expectedVolume" type="number" min="0" step="any" value="${output.expectedVolume ?? ""}" required></label><label>Max volume per vial (µL)<input name="maxVialVolume" type="number" min="0" step="any" value="${output.maxVialVolume ?? 50}" required></label></div><p class="hint planned-count"></p>` : `<div class="row"><label>Amount per physical sample (${config.unit})<input name="amountEach" type="number" min="0" step="any" value="${output.amountEach ?? ""}" required></label><label>Number of samples<input name="count" type="number" min="1" step="1" value="${output.count ?? 1}" required></label></div>`}</article>`;
}

function updateOutputFromForm(card, source) {
  const index = Number(card.dataset.index); const type = card.querySelector('[name="type"]').value; const mode = card.querySelector('[name="mode"]').value;
  const previous = outputs[index];
  outputs[index] = { ...previous, type, mode };
  if (mode !== previous.mode) {
    if (mode === "EXTRACTION") {
      delete outputs[index].amountEach;
      delete outputs[index].count;
      outputs[index].maxVialVolume ??= 50;
    } else {
      delete outputs[index].expectedVolume;
      delete outputs[index].maxVialVolume;
      outputs[index].sourceAllocation = 0;
    }
  }
  if (type !== previous.type || mode !== previous.mode) return drawOutputs(source);
  for (const key of ["sourceAllocation", "expectedVolume", "maxVialVolume", "amountEach", "count"]) if (card.querySelector(`[name="${key}"]`)) outputs[index][key] = number(card.querySelector(`[name="${key}"]`).value);
  if (outputs[index].mode === "ALIQUOT") outputs[index].sourceAllocation = outputs[index].amountEach && outputs[index].count ? aliquotSourceAllocation(outputs[index].amountEach, outputs[index].count) : 0;
  const planned = card.querySelector(".planned-count");
  if (planned && outputs[index].expectedVolume > 0 && outputs[index].maxVialVolume > 0) planned.textContent = `${plannedVialCount(outputs[index].expectedVolume, outputs[index].maxVialVolume)} labels will be reserved.`;
  updateAllocation(source);
}

function updateAllocation(source) {
  const available = availableQuantity(source); const summary = validateAllocation(available, outputs); const unit = typeConfig(source.sample_type).unit;
  document.querySelector("#allocation").innerHTML = `<div class="summary"><div class="metric">Available<b>${available} ${unit}</b></div><div class="metric">Allocated<b>${summary.allocated} ${unit}</b></div><div class="metric">Expected remaining<b>${summary.remaining} ${unit}</b></div></div>${summary.valid ? "" : `<p class="error">Allocation exceeds available source material. The plan cannot be created.</p>`}`;
  document.querySelector("#create-plan").disabled = !summary.valid || !outputs.length || outputs.some((o) => !(o.sourceAllocation > 0) || (o.mode === "EXTRACTION" && (!(o.expectedVolume > 0) || !(o.maxVialVolume > 0))) || (o.mode === "ALIQUOT" && (!(o.amountEach > 0) || !(o.count > 0))));
}

async function submitPlan(source) {
  const resultArea = document.querySelector("#plan-result");
  try {
    const payload = buildProcessingPlanPayload(source.id, document.querySelector("#plan-notes").value, outputs);
    const result = await api.createPlan(payload); const samples = result.samples || [];
    resultArea.innerHTML = `<p class="success">Created ${escapeHtml(result.event_id)} with ${samples.length} planned samples.</p><button id="print-plan">Generate ${samples.length} labels PDF</button>`;
    document.querySelector("#print-plan").onclick = async () => { await generateLabelPdf(samples); await api.markLabelsPrinted(samples.map((s) => s.id)); toast("Label PDF generated"); };
  } catch (error) { resultArea.innerHTML = `<p class="error">${errorMessage(error)}</p>`; }
}

async function renderPending() {
  app.innerHTML = `${page("Pending processing", "Extraction plans awaiting actual yield measurements.")}<div id="pending-list"><p>Loading…</p></div>`;
  const rows = await api.pending(); const holder = document.querySelector("#pending-list");
  holder.innerHTML = rows.length ? `<div class="list">${rows.map((row) => { const source = row.processing_event.samples; return `<article class="list-item"><div><h3>${escapeHtml(row.processing_event.event_id)} · ${escapeHtml(row.output_type)}</h3><p>From ${escapeHtml(source.sample_id)} · Input ${row.planned_source_allocation} ${typeConfig(source.sample_type).unit}</p><p class="muted">Expected ${row.expected_volume_ul} µL · ${row.output_samples.length} planned vials</p></div><button class="enter-results" data-id="${row.id}">Enter results</button></article>`; }).join("")}</div>` : `<p class="success">No extraction results are pending.</p>`;
  holder.querySelectorAll(".enter-results").forEach((button) => button.onclick = () => renderResults(rows.find((row) => row.id === button.dataset.id)));
}

function renderResults(output) {
  const planned = output.output_samples.length; const max = Number(output.max_vial_volume_ul);
  app.innerHTML = `${page(`Enter ${escapeHtml(output.output_type)} results`, `${escapeHtml(output.processing_event.event_id)} · ${planned} planned vial(s) · ${max} µL maximum each`)}<form id="results-form" class="panel"><div class="row"><label>Actual volume (µL)<input name="volume" type="number" min="0" step="any" required></label><label>Concentration (ng/µL)<input name="concentration" type="number" min="0" step="any" required></label></div><div id="yield-summary"></div><label>Vial distribution (µL, separated by + or commas)<input name="distribution" placeholder="50 + 42" required></label><div id="capacity-warning"></div><label><input name="override" type="checkbox" style="width:auto"> Permit a vial above configured capacity (recorded in audit)</label><button>Record results</button></form><div id="results-result"></div>`;
  const form = document.querySelector("#results-form");
  const recalc = () => {
    const volume = number(form.volume.value); const concentration = number(form.concentration.value);
    if (volume == null || volume < 0) return;
    const suggested = suggestVialVolumes(volume, max); if (document.activeElement !== form.distribution) form.distribution.value = suggested.join(" + ");
    const mass = concentration == null ? null : totalMassNg(volume, concentration); const extra = additionalVialsRequired(volume, planned, max);
    document.querySelector("#yield-summary").innerHTML = mass == null ? "" : `<div class="metric">Total mass<b>${mass.toLocaleString()} ng (${(mass / 1000).toLocaleString()} µg)</b></div>`;
    document.querySelector("#capacity-warning").innerHTML = extra ? `<p class="warning">Actual output exceeds planned capacity. ${extra} additional vial${extra === 1 ? " is" : "s are"} required. Additional IDs and labels will be generated when results are saved.</p>` : "";
  };
  form.volume.oninput = recalc; form.concentration.oninput = recalc;
  form.onsubmit = async (event) => {
    event.preventDefault(); const volume = Number(form.volume.value); const concentration = Number(form.concentration.value); const volumes = form.distribution.value.split(/[+,]/).map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
    const validation = validateDistribution(volumes, volume, max, form.override.checked);
    if (!validation.valid) return document.querySelector("#results-result").innerHTML = `<p class="error">${escapeHtml(validation.error)}</p>`;
    try {
      const result = await api.recordResults(output.id, volume, concentration, volumes, form.override.checked);
      const added = result.additional_samples || [];
      document.querySelector("#results-result").innerHTML = `<p class="success">Results recorded. ${result.activated_ready_count} vial(s) are ready for physical confirmation.</p>${added.length ? `<button id="print-extra">Generate ${added.length} additional label(s)</button>` : ""}`;
      if (added.length) document.querySelector("#print-extra").onclick = async () => { await generateLabelPdf(added); await api.markLabelsPrinted(added.map((s) => s.id)); toast("Additional label PDF generated"); };
    } catch (error) { document.querySelector("#results-result").innerHTML = `<p class="error">${errorMessage(error)}</p>`; }
  };
}

function renderConfirm() {
  app.innerHTML = `${page("Confirm physical samples", "Scan a reserved label. Review it before activation.")}<div id="scanner"></div><p><button id="start-camera">Start camera</button></p><form id="manual-scan" class="row"><label>Or enter Sample ID<input name="sampleId" autocomplete="off"></label><button>Look up</button></form><div id="scan-result"></div>`;
  const handle = (value) => lookupForConfirmation(value);
  document.querySelector("#start-camera").onclick = async () => {
    try { await startScanner(document.querySelector("#scanner"), handle); document.querySelector("#start-camera").hidden = true; }
    catch (error) { document.querySelector("#scan-result").innerHTML = scannerUnavailableHtml(errorMessage(error)); }
  };
  document.querySelector("#manual-scan").onsubmit = (event) => { event.preventDefault(); handle(event.target.sampleId.value.trim().toUpperCase()); event.target.reset(); };
}

async function lookupForConfirmation(sampleId) {
  const holder = document.querySelector("#scan-result");
  try {
    const sample = await api.getSample(sampleId);
    holder.innerHTML = `<article class="card"><h2>${escapeHtml(sample.sample_id)} ${statusBadge(sample.status)}</h2><p>${escapeHtml(sample.sample_type)} · ${sample.parent?.sample_id ? `Parent ${escapeHtml(sample.parent.sample_id)}` : "Registered source"}</p><p>${sample.planned_volume_ul != null ? `${sample.planned_volume_ul} µL planned` : sample.planned_cell_count_million != null ? `${sample.planned_cell_count_million}M cells planned` : "Quantity recorded at result entry"}</p>${sample.status === "PLANNED" ? `<button id="activate-sample">Confirm physical tube and activate</button> <button id="not-created" class="secondary">Mark not created</button>` : `<p class="warning">This sample cannot be activated from status ${escapeHtml(sample.status)}.</p>`}</article>`;
    document.querySelector("#activate-sample")?.addEventListener("click", async () => { try { await api.activate(sample.sample_id); toast(`${sample.sample_id} activated`); holder.innerHTML = `<p class="success">${escapeHtml(sample.sample_id)} is ACTIVE. Ready for next scan.</p>`; } catch (error) { holder.innerHTML += `<p class="error">${errorMessage(error)}</p>`; } });
    document.querySelector("#not-created")?.addEventListener("click", async () => { try { await api.markNotCreated(sample.sample_id); toast(`${sample.sample_id} marked not created`); holder.innerHTML = `<p class="success">${escapeHtml(sample.sample_id)} is NOT_CREATED. Ready for next scan.</p>`; } catch (error) { holder.innerHTML += `<p class="error">${errorMessage(error)}</p>`; } });
  } catch (error) { holder.innerHTML = `<p class="error">${errorMessage(error)}</p>`; }
}

function renderSearch() {
  app.innerHTML = `${page("Search inventory", "Results include active and non-active sample records.")}<form id="inventory-search" class="row panel"><label>Sample ID<input name="term" autocomplete="off" required></label><button>Search</button></form><div id="search-results"></div>`;
  document.querySelector("#inventory-search").onsubmit = async (event) => {
    event.preventDefault(); const holder = document.querySelector("#search-results"); holder.innerHTML = `<p>Searching…</p>`;
    try {
      const rows = await api.findSamples(event.target.term.value.trim());
      holder.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Sample</th><th>Type</th><th>Status</th><th>Parent</th><th>Current quantity</th></tr></thead><tbody>${rows.map((row) => `<tr class="sample-row" data-id="${row.sample_id}"><td><button class="secondary">${escapeHtml(row.sample_id)}</button></td><td>${escapeHtml(row.sample_type)}</td><td>${statusBadge(row.status)}</td><td>${escapeHtml(row.parent?.sample_id || "—")}</td><td>${escapeHtml(formatQuantity(row))}</td></tr>`).join("")}</tbody></table></div><div id="sample-detail"></div>` : emptyInventoryHtml();
      holder.querySelectorAll(".sample-row").forEach((row) => row.querySelector("button").onclick = () => showSampleDetail(rows.find((item) => item.sample_id === row.dataset.id)));
    } catch (error) { holder.innerHTML = `<p class="error">${errorMessage(error)}</p>`; }
  };
}

async function showSampleDetail(sample) {
  const [children, audit] = await Promise.all([api.children(sample.id), api.audit(sample.id)]); const detail = document.querySelector("#sample-detail");
  detail.innerHTML = `<section class="panel"><h2>${escapeHtml(sample.sample_id)} ${statusBadge(sample.status)}</h2><p><strong>${escapeHtml(sample.sample_type)}</strong> · ${escapeHtml(formatQuantity(sample))}</p><p>Parent: ${escapeHtml(sample.parent?.sample_id || "None (registered source)")} · Processing event: ${escapeHtml(sample.processing_event?.event_id || "—")}</p>${sample.concentration_ng_ul != null ? `<p>Concentration: ${sample.concentration_ng_ul} ng/µL · Total mass: ${sample.total_mass_ng} ng</p>` : ""}<h3>Children</h3>${children.length ? `<ul class="tree">${children.map((child) => `<li>${escapeHtml(child.sample_id)} ${statusBadge(child.status)} · ${escapeHtml(child.sample_type)}</li>`).join("")}</ul>` : `<p class="muted">No direct children.</p>`}<h3>Recent history</h3>${audit.length ? `<ul>${audit.map((item) => `<li>${new Date(item.created_at).toLocaleString()} — ${escapeHtml(item.event_type)}</li>`).join("")}</ul>` : `<p class="muted">No events.</p>`}</section>`;
}

document.querySelector("#menu-button").onclick = () => nav.classList.toggle("open");
document.querySelector("#sign-out").onclick = async () => { stopScanner(); await api.signOut(); renderLogin(); };
window.addEventListener("hashchange", () => profile && route());
boot().catch((error) => renderLogin(error.message));

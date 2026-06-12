// =====================================================================
//  Sezione STORICO: tabella, dettaglio, selezione, eliminazione, export CSV.
// =====================================================================

import { db } from "./db.js";
import { storage } from "./storage.js";
import { calcolaIQ, fasciaDi, FASCE, labelFascia } from "./iq.js";
import { t } from "./i18n.js";

const UNITA = { m: "m", m2: "m²", conteggio: "n°" };
const STRATO = (k) => (k ? t("strato_" + k) : "");

let RILIEVI = [];
let FILTRATI = [];
let filtri = { strada: "", direzione: "", strato: "", origine: "", iq: "", da: "", a: "" };
let selezione = new Set();
let rootEl = null;

const DIR = { A4: [["est", "Est"], ["ovest", "Ovest"]], A31: [["nord", "Nord"], ["sud", "Sud"]] };

function iqCell(iq) {
  if (iq == null) return "—";
  const f = fasciaDi(iq);
  return `<span class="iq-badge iq-${f ? f.key : "critico"}">${iq}</span>`;
}
function iqDiRilievo(r) {
  const items = (r.rilievo_distress || []).map((x) => ({
    severita: x.severita,
    estensione_valore: x.estensione_valore,
    estensione_unita: x.estensione_unita || (x.distress && x.distress.unita_misura),
    deduct_params: x.distress && x.distress.deduct_params,
    ha_severita: x.distress && x.distress.ha_severita,
  }));
  return calcolaIQ(items);
}

const fmtProg = (m) => (m == null ? "—" : `km ${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, "0")}`);

function nomeDistress(rd) {
  const d = rd.distress;
  return `${d ? d.codice : "?"}·${d && d.nome ? (d.nome.it || "") : ""}`;
}
function ubicazione(r) {
  const p = [];
  if (r.strada) p.push(r.strada);
  if (r.direzione) p.push(r.direzione);
  if (r.corsia != null) p.push("cor " + r.corsia);
  if (r.progressiva_m != null) p.push(fmtProg(r.progressiva_m));
  return p.length ? p.join(" · ") : "—";
}
function coord(r) {
  if (r.gps_lat == null || r.gps_lon == null) return "—";
  return `${Number(r.gps_lat).toFixed(5)}, ${Number(r.gps_lon).toFixed(5)}`;
}
function dataOra(r) {
  try {
    return new Date(r.created_at).toLocaleString("it-IT",
      { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return r.created_at; }
}
function distressTxt(rd, origine) {
  const items = (rd || []).filter((x) => x.origine === origine);
  if (!items.length) return "—";
  return items.map((x) => nomeDistress(x) + (x.severita ? ` (${x.severita[0].toUpperCase()})` : "")).join(", ");
}
function distressPlain(rd, origine) {
  return (rd || []).filter((x) => x.origine === origine).map((x) => {
    const u = UNITA[x.estensione_unita] || x.estensione_unita || "";
    const est = x.estensione_valore != null ? ` ${x.estensione_valore}${u}` : "";
    return nomeDistress(x) + (x.severita ? ` (${x.severita})` : "") + est;
  }).join("; ");
}

export async function renderStorico(root) {
  rootEl = root;
  selezione = new Set();
  // NB: i filtri NON si azzerano qui: restano memorizzati tra una navigazione e l'altra.
  root.innerHTML = `<div class="panel"><div class="mono" style="color:var(--muted)">caricamento…</div></div>`;
  try {
    RILIEVI = await db.rilievi.listConDistress();
  } catch (e) {
    root.innerHTML = `<div class="panel mono" style="color:#ff8a8a">Errore: ${(e && e.message) || e}</div>`;
    return;
  }
  if (!RILIEVI.length) {
    root.innerHTML = `<div class="panel"><div class="placeholder">
      <div class="big">${t("sto_nessun")}</div>
      <div class="small">${t("sto_nessun_sub")}</div></div></div>`;
    return;
  }
  FILTRATI = RILIEVI.slice();
  root.innerHTML = markup();
  wire(root);
  applicaFiltri(root);   // riapplica gli eventuali filtri memorizzati
}

function trendDelta(prevIq, iq) {
  if (prevIq == null || iq == null) return { key: "na", txt: "→", titolo: "" };
  const d = iq - prevIq;
  if (d <= -3) return { key: "peggio", txt: `▼ ${d}`, titolo: `${t("trend_peggio")} (${d} IQ)` };
  if (d >= 3) return { key: "meglio", txt: `▲ +${d}`, titolo: `${t("trend_meglio")} (+${d} IQ)` };
  return { key: "stabile", txt: `= ${d >= 0 ? "+" : ""}${d}`, titolo: t("trend_stabile") };
}
const ETICHETTA_TREND = (k) => ({ peggio: t("trend_peggio"), meglio: t("trend_meglio"), stabile: t("trend_stabile"), na: "—" })[k] || "—";

// ordina la lista mettendo i figli (rilievi collegati) indentati sotto il capostipite
function ordinaNidificato(list) {
  const byId = new Map(list.map((r) => [r.id, r]));
  const figli = new Map(), radici = [];
  list.forEach((r) => {
    const p = r.evoluzione_di;
    if (p && byId.has(p)) { (figli.get(p) || figli.set(p, []).get(p)).push(r); }
    else radici.push(r);
  });
  const asc = (a, b) => new Date(a.created_at) - new Date(b.created_at);
  const out = [];
  const visita = (r, depth) => {
    out.push({ r, depth });
    (figli.get(r.id) || []).sort(asc).forEach((f) => visita(f, depth + 1));
  };
  radici.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  radici.forEach((r) => visita(r, 0));
  return out;
}
function evolCell(r) {
  if (r.evoluzione_di) {
    const p = RILIEVI.find((x) => x.id === r.evoluzione_di);
    const t = trendDelta(p ? p.iq : null, r.iq);
    return `<span class="trend trend-${t.key}" title="${t.titolo}">${t.txt}</span>`;
  }
  const haFigli = RILIEVI.some((x) => x.evoluzione_di === r.id);
  return haFigli ? `<span class="trend trend-root" title="Capostipite della catena">⌥</span>` : "—";
}

function rowsHtml(list) {
  if (!list.length) {
    return `<tr><td colspan="10" class="mono" style="text-align:center;color:var(--muted);padding:22px">${t("sto_no_match")}</td></tr>`;
  }
  return ordinaNidificato(list).map(({ r, depth }) => {
    const rd = r.rilievo_distress || [];
    const ind = depth > 0
      ? `<span class="evo-ind" style="padding-left:${depth * 28}px">↳ </span>`
      : "";
    return `<tr data-id="${r.id}"${depth > 0 ? ' class="evo-figlio"' : ""}>
      <td class="sel-cell"><input type="checkbox" class="rowsel" data-id="${r.id}"></td>
      <td class="mono">${ind}${String(r.id).slice(0, 8)}</td>
      <td class="mono">${dataOra(r)}</td>
      <td class="mono" style="text-align:center">${r.thumb_path ? `<img class="thumb" src="${storage.url(r.thumb_path)}" alt="">` : "—"}</td>
      <td class="mono">${ubicazione(r)}</td>
      <td class="mono">${coord(r)}</td>
      <td>${distressTxt(rd, "operatore")}</td>
      <td>${distressTxt(rd, "ai")}</td>
      <td class="mono">${iqCell(r.iq)}</td>
      <td class="mono" style="text-align:center">${evolCell(r)}</td>
    </tr>`;
  }).join("");
}

function opzioniDirezione() {
  const voci = filtri.strada ? (DIR[filtri.strada] || []) : [...DIR.A4, ...DIR.A31];
  return `<option value="">${t("sto_tutte")}</option>` +
    voci.map(([v, l]) => `<option value="${v}"${filtri.direzione === v ? " selected" : ""}>${t("dir_" + v)}</option>`).join("");
}

function filtriMarkup() {
  const sel = (val, cur) => (val === cur ? " selected" : "");
  return `
    <div class="panel filtri-panel">
      <div class="filtri-grid">
        <div class="field">
          <label>${t("ril_strada")}</label>
          <select id="f-strada">
            <option value="">${t("sto_tutte")}</option>
            <option value="A4"${sel("A4", filtri.strada)}>A4</option>
            <option value="A31"${sel("A31", filtri.strada)}>A31</option>
          </select>
        </div>
        <div class="field">
          <label>${t("ril_direzione")}</label>
          <select id="f-direzione">${opzioniDirezione()}</select>
        </div>
        <div class="field">
          <label>${t("sto_strato_lbl")}</label>
          <select id="f-strato">
            <option value="">${t("sto_tutti")}</option>
            <option value="drenante_nuovo"${sel("drenante_nuovo", filtri.strato)}>${t("strato_drenante_nuovo")}</option>
            <option value="drenante_maturo"${sel("drenante_maturo", filtri.strato)}>${t("strato_drenante_maturo")}</option>
            <option value="non_drenante"${sel("non_drenante", filtri.strato)}>${t("strato_non_drenante")}</option>
            <option value="non_determinabile"${sel("non_determinabile", filtri.strato)}>${t("strato_non_determinabile")}</option>
          </select>
        </div>
        <div class="field">
          <label>${t("sto_distress_lbl")}</label>
          <select id="f-origine">
            <option value="">${t("sto_qualsiasi")}</option>
            <option value="ai"${sel("ai", filtri.origine)}>${t("sto_con_ai")}</option>
            <option value="operatore"${sel("operatore", filtri.origine)}>${t("sto_con_op")}</option>
            <option value="nessuno"${sel("nessuno", filtri.origine)}>${t("sto_senza")}</option>
          </select>
        </div>
        <div class="field">
          <label>IQ</label>
          <select id="f-iq">
            <option value="">${t("sto_tutte_fasce")}</option>
            <option value="ottimo"${sel("ottimo", filtri.iq)}>${labelFascia("ottimo")} (≥90)</option>
            <option value="buono"${sel("buono", filtri.iq)}>${labelFascia("buono")} (78–89)</option>
            <option value="discreto"${sel("discreto", filtri.iq)}>${labelFascia("discreto")} (64–77)</option>
            <option value="scarso"${sel("scarso", filtri.iq)}>${labelFascia("scarso")} (50–63)</option>
            <option value="critico"${sel("critico", filtri.iq)}>${labelFascia("critico")} (&lt;50)</option>
          </select>
        </div>
        <div class="field">
          <label>${t("sto_dal")}</label>
          <input type="date" id="f-da" value="${filtri.da}">
        </div>
        <div class="field">
          <label>${t("sto_al")}</label>
          <input type="date" id="f-a" value="${filtri.a}">
        </div>
      </div>
      <button type="button" class="btn btn-ghost" id="f-reset">${t("sto_azzera")}</button>
    </div>`;
}

function markup() {
  return `
    ${filtriMarkup()}
    <div class="storico-bar">
      <span class="sel-count mono" id="sel-count">0 selezionati</span>
      <div class="bar-actions">
        <button type="button" class="btn btn-ghost" id="btn-iq">${t("sto_ricalcola")}</button>
        <button type="button" class="btn btn-ghost" id="btn-kmz">${t("sto_exp_kmz")}</button>
        <button type="button" class="btn btn-ghost" id="btn-pdf">${t("sto_exp_pdf")}</button>
        <button type="button" class="btn btn-ghost" id="btn-export">${t("sto_exp_csv")}</button>
        <button type="button" class="btn btn-danger" id="btn-del" disabled>${t("sto_elimina")}</button>
      </div>
    </div>
    <div class="panel" style="padding:0;overflow:hidden">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th class="sel-cell"><input type="checkbox" id="sel-all"></th>
            <th>ID</th><th>${t("sto_th_data")}</th><th>${t("ril_foto")}</th><th>${t("sto_th_ubic")}</th><th>${t("sto_th_coord")}</th>
            <th>${t("sto_th_dop")}</th><th>${t("sto_th_dai")}</th><th>IQ</th><th>${t("sto_th_evol")}</th>
          </tr></thead>
          <tbody id="storico-body">${rowsHtml(FILTRATI)}</tbody>
        </table>
      </div>
    </div>
    <div class="hint mono" id="storico-conta" style="margin-top:10px;color:var(--muted)">
      ${contaTxt()}
    </div>`;
}

function contaTxt() {
  const n = FILTRATI.length, tot = RILIEVI.length;
  const base = n === tot ? `${tot} rilievi` : `${n} di ${tot} rilievi`;
  return `${base} · tocca una riga per i dettagli · seleziona per esportare o eliminare.`;
}

function aggiornaBarra(root) {
  const n = selezione.size;
  root.querySelector("#sel-count").textContent = `${n} selezionat${n === 1 ? "o" : "i"}`;
  root.querySelector("#btn-del").disabled = n === 0;
  const all = root.querySelector("#sel-all");
  all.checked = n > 0 && n === FILTRATI.length;
  all.indeterminate = n > 0 && n < FILTRATI.length;
}

function wireRighe(root) {
  root.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".sel-cell")) return;
      apriDettaglio(tr.dataset.id);
    });
  });
  root.querySelectorAll(".rowsel").forEach((cb) => {
    cb.checked = selezione.has(cb.dataset.id);
    cb.addEventListener("change", () => {
      if (cb.checked) selezione.add(cb.dataset.id); else selezione.delete(cb.dataset.id);
      aggiornaBarra(root);
    });
  });
}

function applicaFiltri(root) {
  FILTRATI = RILIEVI.filter((r) => {
    if (filtri.strada && r.strada !== filtri.strada) return false;
    if (filtri.direzione && r.direzione !== filtri.direzione) return false;
    if (filtri.strato && r.strato !== filtri.strato) return false;
    if (filtri.origine) {
      const rd = r.rilievo_distress || [];
      if (filtri.origine === "ai" && !rd.some((x) => x.origine === "ai")) return false;
      if (filtri.origine === "operatore" && !rd.some((x) => x.origine === "operatore")) return false;
      if (filtri.origine === "nessuno" && rd.length) return false;
    }
    if (filtri.iq) {
      const f = fasciaDi(r.iq);
      if (!f || f.key !== filtri.iq) return false;
    }
    if (filtri.da || filtri.a) {
      const t = new Date(r.created_at);
      if (filtri.da && t < new Date(filtri.da + "T00:00:00")) return false;
      if (filtri.a && t > new Date(filtri.a + "T23:59:59")) return false;
    }
    return true;
  });
  // mantieni selezionati solo i visibili
  const visibili = new Set(FILTRATI.map((r) => r.id));
  selezione.forEach((id) => { if (!visibili.has(id)) selezione.delete(id); });
  renderTabella(root);
}

function renderTabella(root) {
  root.querySelector("#storico-body").innerHTML = rowsHtml(FILTRATI);
  root.querySelector("#storico-conta").textContent = contaTxt();
  wireRighe(root);
  const all = root.querySelector("#sel-all");
  if (all) { all.checked = false; all.indeterminate = false; }
  aggiornaBarra(root);
}

function wire(root) {
  wireRighe(root);

  // --- filtri (live) ---
  const fStrada = root.querySelector("#f-strada");
  const fDir = root.querySelector("#f-direzione");
  fStrada.addEventListener("change", () => {
    filtri.strada = fStrada.value;
    filtri.direzione = "";                 // reimposta direzione coerente con la strada
    fDir.innerHTML = opzioniDirezione();
    applicaFiltri(root);
  });
  fDir.addEventListener("change", () => { filtri.direzione = fDir.value; applicaFiltri(root); });
  root.querySelector("#f-strato").addEventListener("change", (e) => { filtri.strato = e.target.value; applicaFiltri(root); });
  root.querySelector("#f-origine").addEventListener("change", (e) => { filtri.origine = e.target.value; applicaFiltri(root); });
  root.querySelector("#f-iq").addEventListener("change", (e) => { filtri.iq = e.target.value; applicaFiltri(root); });
  root.querySelector("#f-da").addEventListener("change", (e) => { filtri.da = e.target.value; applicaFiltri(root); });
  root.querySelector("#f-a").addEventListener("change", (e) => { filtri.a = e.target.value; applicaFiltri(root); });
  root.querySelector("#f-reset").addEventListener("click", () => {
    filtri = { strada: "", direzione: "", strato: "", origine: "", iq: "", da: "", a: "" };
    root.querySelector("#f-strada").value = "";
    fDir.innerHTML = opzioniDirezione();
    root.querySelector("#f-strato").value = "";
    root.querySelector("#f-origine").value = "";
    root.querySelector("#f-iq").value = "";
    root.querySelector("#f-da").value = "";
    root.querySelector("#f-a").value = "";
    applicaFiltri(root);
  });

  // --- selezione/azioni ---
  root.querySelector("#sel-all").addEventListener("change", (e) => {
    selezione = new Set();
    root.querySelectorAll(".rowsel").forEach((cb) => {
      cb.checked = e.target.checked;
      if (e.target.checked) selezione.add(cb.dataset.id);
    });
    aggiornaBarra(root);
  });
  root.querySelector("#btn-export").addEventListener("click", esportaCSV);
  root.querySelector("#btn-kmz").addEventListener("click", (ev) => esportaKMZ(ev.currentTarget));
  root.querySelector("#btn-pdf").addEventListener("click", esportaPDF);
  root.querySelector("#btn-iq").addEventListener("click", () => ricalcolaIQ(root));
  root.querySelector("#btn-del").addEventListener("click", eliminaSelezionati);
}

async function ricalcolaIQ(root) {
  const btn = root.querySelector("#btn-iq");
  btn.disabled = true; const testo = btn.textContent; btn.textContent = t("sto_ricalcolo");
  try {
    for (const r of RILIEVI) {
      const ris = iqDiRilievo(r);
      if (r.iq !== ris.iq || r.iq_fascia !== ris.fascia) {
        await db.rilievi.update(r.id, { iq: ris.iq, iq_fascia: ris.fascia });
        r.iq = ris.iq; r.iq_fascia = ris.fascia;
      }
    }
    applicaFiltri(root);
  } catch (e) {
    alert((t("sto_err_ricalc") + ": ") + ((e && e.message) || e));
  } finally {
    btn.disabled = false; btn.textContent = testo;
  }
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function esportaCSV() {
  const righe = selezione.size ? RILIEVI.filter((r) => selezione.has(r.id)) : FILTRATI;
  const header = ["id","data","strada","direzione","corsia","progressiva_m","progressiva",
    "lat","lon","scostamento_m","strato","iq","iq_fascia","distress_operatore","distress_ai","foto_id"];
  const lines = [header.join(";")];
  righe.forEach((r) => {
    const rd = r.rilievo_distress || [];
    const row = [
      r.id,
      (() => { try { return new Date(r.created_at).toISOString(); } catch { return r.created_at; } })(),
      r.strada || "", r.direzione || "", r.corsia ?? "",
      r.progressiva_m ?? "", r.progressiva_m != null ? fmtProg(r.progressiva_m) : "",
      r.gps_lat ?? "", r.gps_lon ?? "", r.scostamento_m ?? "",
      r.strato || "", r.iq ?? "", r.iq_fascia || "",
      distressPlain(rd, "operatore"), distressPlain(rd, "ai"),
      r.foto_id || "",
    ].map(csvCell);
    lines.push(row.join(";"));
  });
  const csv = "\ufeff" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `distressiq_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function eliminaSelezionati() {
  const ids = [...selezione];
  if (!ids.length) return;
  if (!confirm(`${t("sto_conf_elim_a")} ${ids.length} ${t("sto_conf_elim_b")}`)) return;
  const paths = [];
  RILIEVI.filter((r) => selezione.has(r.id)).forEach((r) => {
    if (r.foto_id) paths.push(r.foto_id);
    if (r.thumb_path) paths.push(r.thumb_path);
  });
  try {
    await db.rilievi.remove(ids);
    for (const p of paths) { try { await storage.remove(p); } catch { /* best-effort */ } }
    await renderStorico(rootEl);
  } catch (e) {
    alert((t("sto_err_elim") + ": ") + ((e && e.message) || e));
  }
}

function dataBreve(r) {
  const d = new Date(r.created_at);
  return isNaN(d) ? "—" : d.toLocaleDateString("it-IT");
}
function distM(a, b) {
  if (a.gps_lat == null || a.gps_lon == null || b.gps_lat == null || b.gps_lon == null) return Infinity;
  const R = 6371000, toR = (d) => d * Math.PI / 180;
  const dLat = toR(b.gps_lat - a.gps_lat), dLon = toR(b.gps_lon - a.gps_lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.gps_lat)) * Math.cos(toR(b.gps_lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function stessoPunto(a, b) {
  if (a.strada !== b.strada || a.direzione !== b.direzione || a.corsia !== b.corsia) return false;
  if (a.progressiva_m != null && b.progressiva_m != null) return Math.abs(a.progressiva_m - b.progressiva_m) <= 30;
  return distM(a, b) <= 30; // fallback GPS quando manca la progressiva
}
function discendentiIds(r) {
  const set = new Set(), stack = [r.id];
  while (stack.length) {
    const id = stack.pop();
    RILIEVI.forEach((x) => { if (x.evoluzione_di === id && !set.has(x.id)) { set.add(x.id); stack.push(x.id); } });
  }
  return set;
}
function lineage(r) {
  const out = [], seen = new Set();
  let cur = r;
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.push(cur); cur = cur.evoluzione_di ? RILIEVI.find((x) => x.id === cur.evoluzione_di) : null; }
  const desc = discendentiIds(r);
  RILIEVI.forEach((x) => { if (desc.has(x.id) && !seen.has(x.id)) { seen.add(x.id); out.push(x); } });
  return out.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
function candidati(r) {
  const desc = discendentiIds(r);
  return RILIEVI.filter((c) =>
    c.id !== r.id && !desc.has(c.id) &&
    new Date(c.created_at) < new Date(r.created_at) && stessoPunto(r, c)
  ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
function evoluzioneHtml(r) {
  const cat = lineage(r);
  let timeline, somma = "";
  if (cat.length > 1) {
    let inner = "";
    cat.forEach((x, i) => {
      if (i > 0) {
        const t = trendDelta(cat[i - 1].iq, x.iq);
        inner += `<span class="evo-arrow trend-${t.key}" title="${t.titolo}">${t.txt}</span>`;
      }
      inner += `<div class="evo-step${x.id === r.id ? " evo-cur" : ""}"><span class="evo-data mono">${dataBreve(x)}</span>${iqCell(x.iq)}</div>`;
    });
    timeline = `<div class="evo-timeline">${inner}</div>`;
    const c = trendDelta(cat[0].iq, cat[cat.length - 1].iq);
    somma = `<div class="evo-somma trend-${c.key}">${t("sto_tend_compl")}: <b>${ETICHETTA_TREND(c.key)}</b> (IQ ${cat[0].iq != null ? cat[0].iq : "—"} → ${cat[cat.length - 1].iq != null ? cat[cat.length - 1].iq : "—"})</div>`;
  } else {
    timeline = `<div class="v" style="color:var(--muted)">${t("sto_no_catena")}</div>`;
  }
  const parent = r.evoluzione_di ? RILIEVI.find((x) => x.id === r.evoluzione_di) : null;
  const cand = candidati(r);
  let azione;
  if (parent) {
    azione = `<div class="evo-link mono">${t("sto_evol_di")}: ${dataBreve(parent)} · ${String(parent.id).slice(0, 8)}
      <button class="btn evo-unlink">${t("sto_scollega")}</button></div>`;
  } else if (cand.length) {
    azione = `<div class="evo-link">
      <select class="evo-sel">${cand.map((c) => `<option value="${c.id}">${dataBreve(c)} · ${ubicazione(c)} · IQ ${c.iq != null ? c.iq : "—"}</option>`).join("")}</select>
      <button class="btn evo-do">${t("sto_collega")}</button></div>`;
  } else {
    azione = `<div class="v" style="color:var(--muted)">${t("sto_no_cand")}</div>`;
  }
  return `<div class="m-field"><div class="k">${t("sto_evoluzione")}</div>${timeline}${somma}${azione}</div>`;
}

function apriDettaglio(id) {
  const r = RILIEVI.find((x) => x.id === id);
  if (!r) return;
  const rd = r.rilievo_distress || [];
  const campo = (k, v) => `<div class="m-field"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const blocco = (origine, label) => {
    const items = rd.filter((x) => x.origine === origine);
    if (!items.length) return `<div class="m-field"><div class="k">${label}</div><div class="v" style="color:var(--muted)">${t("sto_nessuno")}</div></div>`;
    const lis = items.map((x) => {
      const u = UNITA[x.estensione_unita] || x.estensione_unita || "";
      const est = x.estensione_valore != null ? ` — ${x.estensione_valore} ${u}` : "";
      return `<li>${nomeDistress(x)}${x.severita ? ` · ${x.severita}` : ""}${est}</li>`;
    }).join("");
    return `<div class="m-field"><div class="k">${label}</div><ul class="m-list">${lis}</ul></div>`;
  };

  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="m-head"><h3>${t("sto_rilievo_w")} ${String(r.id).slice(0, 8)}</h3>
        <button class="m-close" aria-label="${t("chiudi")}">×</button></div>
      <div class="m-body">
        <div class="m-meta"><span>${dataOra(r)}</span><span>IQ: ${iqCell(r.iq)}</span></div>
        ${campo(t("sto_th_ubic"), ubicazione(r))}
        ${campo(t("sto_th_coord"), coord(r))}
        ${campo(t("sto_strato_lbl"), STRATO(r.strato) || r.strato || "—")}
        ${r.foto_id ? `<div class="m-field"><div class="k">${t("ril_foto")}</div><img class="foto-img" src="${storage.url(r.foto_id)}" alt=""></div>` : ""}
        ${blocco("operatore", t("sto_th_dop"))}
        ${blocco("ai", t("sto_th_dai"))}
        ${evoluzioneHtml(r)}
      </div>
    </div>`;
  const chiudi = () => { document.removeEventListener("keydown", onEsc); ov.remove(); };
  const onEsc = (e) => { if (e.key === "Escape") chiudi(); };
  ov.addEventListener("click", (e) => { if (e.target === ov) chiudi(); });
  ov.querySelector(".m-close").addEventListener("click", chiudi);

  const doBtn = ov.querySelector(".evo-do");
  if (doBtn) doBtn.addEventListener("click", async () => {
    const parentId = ov.querySelector(".evo-sel").value;
    doBtn.disabled = true;
    try {
      await db.rilievi.update(r.id, { evoluzione_di: parentId });
      r.evoluzione_di = parentId;
      chiudi(); applicaFiltri(rootEl); apriDettaglio(r.id);
    } catch (e) { doBtn.disabled = false; alert((t("ril_errore") + ": ") + ((e && e.message) || e)); }
  });
  const unBtn = ov.querySelector(".evo-unlink");
  if (unBtn) unBtn.addEventListener("click", async () => {
    unBtn.disabled = true;
    try {
      await db.rilievi.update(r.id, { evoluzione_di: null });
      r.evoluzione_di = null;
      chiudi(); applicaFiltri(rootEl); apriDettaglio(r.id);
    } catch (e) { unBtn.disabled = false; alert((t("ril_errore") + ": ") + ((e && e.message) || e)); }
  });

  document.addEventListener("keydown", onEsc);
  document.body.appendChild(ov);
}

// =====================================================================
//  Export KMZ (Google Earth) e PDF (report stampabile) — vanilla, no libs
// =====================================================================

function righeEsporta() {
  return selezione.size ? RILIEVI.filter((r) => selezione.has(r.id)) : FILTRATI;
}
function scaricaBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// --- mini ZIP (metodo "store", nessuna compressione) per il KMZ ---
const _CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = _CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder();
  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
  const parts = [], central = [];
  let offset = 0;
  files.forEach((f) => {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const local = new Uint8Array([].concat(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)));
    parts.push(local, name, data);
    const cen = new Uint8Array([].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)));
    central.push(cen, name);
    offset += local.length + name.length + data.length;
  });
  let cenSize = 0; central.forEach((c) => cenSize += c.length);
  const eocd = new Uint8Array([].concat(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cenSize), u32(offset), u16(0)));
  const all = [...parts, ...central, eocd];
  let total = 0; all.forEach((a) => total += a.length);
  const out = new Uint8Array(total); let p = 0;
  all.forEach((a) => { out.set(a, p); p += a.length; });
  return out;
}

const KML_COLORE = { ottimo: "ff72c138", buono: "ff3bcc9c", discreto: "ff00c4ff", scarso: "ff1a8cff", critico: "ff4d48e5" };

async function esportaKMZ(btn) {
  const conGps = righeEsporta().filter((r) => r.gps_lat != null && r.gps_lon != null);
  if (!conGps.length) { alert(t("sto_no_gps")); return; }
  const testo = btn.textContent; btn.disabled = true; btn.textContent = "KMZ…";
  try {
    const enc = new TextEncoder();
    const files = [];
    const kmlToWeb = (c) => `#${c.slice(6, 8)}${c.slice(4, 6)}${c.slice(2, 4)}`; // aabbggrr -> #rrggbb
    const stili = Object.entries(KML_COLORE).map(([k, c]) =>
      `<Style id="iq-${k}"><IconStyle><color>${c}</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle>` +
      `<LabelStyle><scale>0.8</scale></LabelStyle>` +
      `<BalloonStyle><bgColor>ff141414</bgColor><textColor>ffeaeaea</textColor><text>$[description]</text></BalloonStyle></Style>`).join("");
    // legenda IQ a livello documento
    const legenda = `<![CDATA[<div style="font-family:Arial,sans-serif;background:#141414;color:#eaeaea;padding:10px 12px;width:220px">
      <div style="font-weight:bold;margin-bottom:8px">${t("sto_legenda")}</div>
      ${FASCE.map((f) => `<div style="margin:3px 0"><span style="display:inline-block;width:13px;height:13px;border-radius:3px;background:${kmlToWeb(KML_COLORE[f.key])};margin-right:8px;vertical-align:middle"></span>${labelFascia(f.key)}${f.min > 0 ? ` &#8805; ${f.min}` : ""}</div>`).join("")}
    </div>]]>`;
    const placemarks = [];
    for (const r of conGps) {
      const ris = iqDiRilievo(r);
      const web = kmlToWeb(KML_COLORE[ris.fasciaKey] || "ff888888");
      let imgTag = "";
      if (r.thumb_path) {
        try {
          const resp = await fetch(storage.url(r.thumb_path));
          if (resp.ok) {
            const buf = new Uint8Array(await resp.arrayBuffer());
            const fn = `files/${r.id}.jpg`;
            files.push({ name: fn, data: buf });
            imgTag = `<img src="${fn}" width="250" style="border-radius:6px;display:block;margin-bottom:8px"/>`;
          }
        } catch { /* salta immagine */ }
      }
      const desc = `<![CDATA[<div style="font-family:Arial,sans-serif;color:#eaeaea;width:250px;background:#141414;padding:12px;border-radius:8px">${imgTag}` +
        `<div style="font-size:15px;font-weight:bold;margin:2px 0 6px">${ubicazione(r)}</div>` +
        `<span style="display:inline-block;background:${web};color:#000;font-weight:bold;padding:2px 9px;border-radius:5px">IQ ${ris.iq} · ${ris.fascia}</span>` +
        `<table style="margin-top:9px;font-size:12px;color:#cfcfcf;border-collapse:collapse">` +
        `<tr><td style="padding:2px 0;color:#8a8a8a">${t("sto_strato_lbl")}</td><td style="padding:2px 0 2px 12px">${STRATO(r.strato) || r.strato || "—"}</td></tr>` +
        `<tr><td style="padding:2px 0;color:#8a8a8a">${t("sto_operatore")}</td><td style="padding:2px 0 2px 12px">${distressPlain(r.rilievo_distress, "operatore") || "—"}</td></tr>` +
        `<tr><td style="padding:2px 0;color:#8a8a8a">AI</td><td style="padding:2px 0 2px 12px">${distressPlain(r.rilievo_distress, "ai") || "—"}</td></tr>` +
        `</table></div>]]>`;
      placemarks.push(`<Placemark><name>IQ ${ris.iq}</name><styleUrl>#iq-${ris.fasciaKey}</styleUrl><description>${desc}</description><Point><coordinates>${Number(r.gps_lon)},${Number(r.gps_lat)},0</coordinates></Point></Placemark>`);
    }
    // legenda IQ come immagine sovrimpressa (sempre visibile sulla mappa)
    let screenOverlay = "";
    try {
      const W = 200, rowH = 26, top = 36, bot = 12, H = top + FASCE.length * rowH + bot;
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#141414"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 15px Arial"; ctx.fillText("Legenda IQ", 12, 24);
      ctx.font = "13px Arial";
      FASCE.forEach((f, i) => {
        const y = top + i * rowH;
        ctx.fillStyle = kmlToWeb(KML_COLORE[f.key]); ctx.fillRect(12, y, 15, 15);
        ctx.fillStyle = "#dcdcdc";
        ctx.fillText(`${labelFascia(f.key)}${f.min > 0 ? ` \u2265 ${f.min}` : ""}`, 36, y + 12);
      });
      const blobL = await new Promise((res) => cv.toBlob(res, "image/png"));
      if (blobL) {
        files.push({ name: "files/legenda.png", data: new Uint8Array(await blobL.arrayBuffer()) });
        screenOverlay = `<ScreenOverlay><name>${t("sto_legenda")}</name><Icon><href>files/legenda.png</href></Icon>` +
          `<overlayXY x="0" y="1" xunits="fraction" yunits="fraction"/>` +
          `<screenXY x="12" y="12" xunits="pixels" yunits="insetPixels"/>` +
          `<size x="${W}" y="${H}" xunits="pixels" yunits="pixels"/></ScreenOverlay>`;
      }
    } catch { /* legenda non generata */ }
    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>DistressIQ export ${new Date().toISOString().slice(0, 10)}</name><description>${legenda}</description>${stili}${screenOverlay}${placemarks.join("")}</Document></kml>`;
    files.unshift({ name: "doc.kml", data: enc.encode(kml) });
    scaricaBlob(new Blob([zipStore(files)], { type: "application/vnd.google-earth.kmz" }),
      `distressiq_${new Date().toISOString().slice(0, 10)}.kmz`);
  } catch (e) {
    alert((t("sto_err_kmz") + ": ") + ((e && e.message) || e));
  } finally {
    btn.disabled = false; btn.textContent = testo;
  }
}

function esportaPDF() {
  const righe = righeEsporta();
  if (!righe.length) { alert(t("sto_no_exp")); return; }
  const iqMedio = Math.round(righe.reduce((a, r) => a + iqDiRilievo(r).iq, 0) / righe.length);
  const rows = righe.map((r) => {
    const ris = iqDiRilievo(r);
    const thumb = r.thumb_path ? `<img src="${storage.url(r.thumb_path)}" />` : "";
    return `<tr>
      <td>${thumb}</td><td>${dataOra(r)}</td><td>${ubicazione(r)}</td>
      <td>${STRATO(r.strato) || r.strato || "—"}</td>
      <td><span class="iqb iq-${ris.fasciaKey}">${ris.iq}</span> ${ris.fascia}</td>
      <td>${distressPlain(r.rilievo_distress, "operatore") || "—"}</td>
      <td>${distressPlain(r.rilievo_distress, "ai") || "—"}</td>
    </tr>`;
  }).join("");
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>DistressIQ — Report</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px}
    .head{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:3px solid #ffc400;padding-bottom:10px;margin-bottom:14px}
    .brand{font-size:22px;font-weight:800} .brand small{display:block;font-size:11px;color:#666;font-weight:400}
    .meta{font-size:12px;color:#444;text-align:right}
    .kpis{display:flex;gap:14px;margin:12px 0}
    .kpi{border:1px solid #ddd;border-radius:8px;padding:8px 14px} .kpi b{font-size:20px;display:block}
    table{width:100%;border-collapse:collapse;font-size:11px} th,td{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}
    th{background:#f3f3f3} td img{width:90px;height:64px;object-fit:cover;border-radius:4px}
    .iqb{display:inline-block;min-width:26px;text-align:center;padding:1px 6px;border-radius:5px;font-weight:800;color:#111}
    .iq-ottimo{background:#38c172}.iq-buono{background:#9ccc3b}.iq-discreto{background:#ffc400}.iq-scarso{background:#ff8c1a}.iq-critico{background:#e5484d;color:#fff}
    @media print{ .noprint{display:none} }
  </style></head><body>
  <div class="head"><div class="brand">DistressIQ <small>${t("sto_report_sub")}</small></div>
    <div class="meta">${new Date().toLocaleString("it-IT")}<br/>${righe.length} ${t("stat_rilievi")}</div></div>
  <div class="kpis"><div class="kpi">${t("stat_iq_medio")}<b>${iqMedio}</b></div><div class="kpi">${t("stat_rilievi")}<b>${righe.length}</b></div></div>
  <table><thead><tr><th>${t("ril_foto")}</th><th>${t("sto_th_data")}</th><th>${t("sto_th_ubic")}</th><th>${t("sto_strato_lbl")}</th><th>IQ</th><th>${t("sto_th_dop")}</th><th>${t("sto_th_dai")}</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="noprint" style="margin-top:16px;color:#666;font-size:12px">${t("sto_pdf_stampa")}</p>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert(t("sto_popup")); return; }
  w.document.open(); w.document.write(html); w.document.close(); w.focus();
  w.onload = () => { setTimeout(() => { try { w.print(); } catch {} }, 400); };
}

// =====================================================================
//  Sezione RILIEVO (sottopasso 1: inserimento manuale + salvataggio).
//  Foto, GPS→progressiva, riconoscimento AI ed evoluzione: sottopassi successivi.
// =====================================================================

import { db, riconosciDistress } from "./db.js";
import { storage } from "./storage.js";
import { calcolaIQ, fasciaDi } from "./iq.js";
import { optgroupsDistress } from "./gruppi.js";
import { t, tx } from "./i18n.js";

// ---- Conversione GPS <-> progressiva (proiezione sull'asse ettometrico) ----
const _etto = {}; // cache: strada -> punti [{progressiva_m, lat, lon}]
async function ettoPunti(strada) {
  if (!_etto[strada]) _etto[strada] = await db.ettometriche.list(strada);
  return _etto[strada];
}
function _toXY(lat, lon, lat0) {
  const R = 6371000, rad = Math.PI / 180;
  return { x: lon * rad * Math.cos(lat0 * rad) * R, y: lat * rad * R };
}
// proietta una coordinata GPS sull'asse della strada -> progressiva + scostamento (m)
async function gpsToProgressiva(strada, lat, lon) {
  const pts = await ettoPunti(strada);
  if (!pts || pts.length < 2) return null;
  const Q = _toXY(lat, lon, lat);
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const A = _toXY(pts[i].lat, pts[i].lon, lat), B = _toXY(pts[i + 1].lat, pts[i + 1].lon, lat);
    const ABx = B.x - A.x, ABy = B.y - A.y, len2 = ABx * ABx + ABy * ABy;
    if (!len2) continue;
    let t = ((Q.x - A.x) * ABx + (Q.y - A.y) * ABy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = A.x + t * ABx, py = A.y + t * ABy;
    const d = Math.hypot(Q.x - px, Q.y - py);
    if (!best || d < best.d) {
      const prog = pts[i].progressiva_m + t * (pts[i + 1].progressiva_m - pts[i].progressiva_m);
      best = { d, progressiva_m: prog };
    }
  }
  return best ? { progressiva_m: Math.round(best.progressiva_m), scostamento_m: Math.round(best.d) } : null;
}
// interpola le coordinate a una data progressiva lungo l'asse della strada
async function progressivaToGps(strada, prog) {
  const pts = await ettoPunti(strada);
  if (!pts || !pts.length) return null;
  if (prog <= pts[0].progressiva_m) return { lat: pts[0].lat, lon: pts[0].lon };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (prog >= a.progressiva_m && prog <= b.progressiva_m) {
      const span = b.progressiva_m - a.progressiva_m, t = span ? (prog - a.progressiva_m) / span : 0;
      return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
    }
  }
  const L = pts[pts.length - 1];
  return { lat: L.lat, lon: L.lon };
}

const STRADA_DIR = (s) => ({
  A4:  [["est",t("dir_est")],["ovest",t("dir_ovest")]],
  A31: [["nord",t("dir_nord")],["sud",t("dir_sud")]],
}[s] || []);
const STRADA_CORSIE = { A4: [0,1,2,3], A31: [0,1,2] };
const SEV = () => [["bassa",t("sev_bassa")],["media",t("sev_media")],["alta",t("sev_alta")]];
const UNITA = { m: "m", m2: "m²", conteggio: "n°" };
const STRATI = () => [
  ["drenante_nuovo",t("strato_drenante_nuovo")],
  ["drenante_maturo",t("strato_drenante_maturo")],
  ["non_drenante",t("strato_non_drenante")],
  ["non_determinabile",t("strato_non_determinabile")],
];

let catalogo = [];   // distress attivi per il menù
let lista = [];      // distress aggiunti a questo rilievo (in memoria)
let fotoFile = null; // foto selezionata (File), elaborata al salvataggio

const opt = (v, l, sel = "") => `<option value="${v}" ${sel}>${l}</option>`;

function fmtProg(m) {
  m = parseInt(m, 10);
  if (isNaN(m) || m < 0) return "—";
  return `km ${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, "0")}`;
}

// ordina per codice: numerici in ordine numerico (1..19), poi i personalizzati (C1, ...)
function ordina(arr) {
  const key = (c) => {
    const n = parseInt(c, 10);
    return isNaN(n) ? { g: 1, n: 0, s: String(c) } : { g: 0, n, s: "" };
  };
  return arr.slice().sort((a, b) => {
    const ka = key(a.codice), kb = key(b.codice);
    if (ka.g !== kb.g) return ka.g - kb.g;
    return ka.g === 0 ? ka.n - kb.n : ka.s.localeCompare(kb.s);
  });
}

// ridimensiona e comprime un'immagine lato client; ritorna un Blob JPEG
function ridimensiona(file, max, q) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
      else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob((b) => b ? resolve(b) : reject(new Error("conversione fallita")), "image/jpeg", q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("immagine non leggibile")); };
    img.src = url;
  });
}

// Blob/File -> base64 puro (senza prefisso data:)
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("lettura immagine fallita"));
    r.readAsDataURL(blob);
  });
}

function thumbDi(fotoId) {
  return fotoId ? fotoId.replace(/\.jpg$/i, "_thumb.jpg") : null;
}

// Raccoglie pochi esempi attivi dalla Calibrazione per il few-shot.
// Usa le MINIATURE (leggere) e preferisce lo stesso strato della foto in esame.
async function raccogliEsempi(strato, max = 3) {
  const out = [];
  try {
    const tutti = await db.ml.listAttivi();
    const ordinati = [...tutti].sort((a, b) => {
      const sa = strato && a.strato === strato ? 0 : 1;
      const sb = strato && b.strato === strato ? 0 : 1;
      return sa - sb;
    });
    for (const e of ordinati.slice(0, max)) {
      try {
        const resp = await fetch(storage.url(e.foto_id));   // foto piena
        if (!resp.ok) continue;
        const ridotta = await ridimensiona(await resp.blob(), 768, 0.8);  // più leggibile della thumb
        const image = await blobToBase64(ridotta);
        out.push({
          codice: e.distress ? e.distress.codice : null,
          nome: e.distress ? (tx(e.distress.nome) || "") : "",
          severita: e.severita || null,
          strato: e.strato || null,
          image, mimeType: "image/jpeg",
        });
      } catch { /* salta esempio non scaricabile */ }
    }
  } catch { /* nessun esempio o tabella vuota */ }
  return out;
}

export async function renderRilievo(root) {
  lista = []; fotoFile = null;
  root.innerHTML = markup();
  try { catalogo = ordina(await db.distress.list()); } catch { catalogo = []; }
  wire(root);
}

function markup() {
  return `
  <div class="panel form-panel">
    <h2 class="sec-h">${t("ril_loc")}</h2>
    <div class="form-grid">
      <div class="field">
        <label>${t("ril_strada")}</label>
        <select id="r-strada"><option value="">—</option>${opt("A4","A4")}${opt("A31","A31")}</select>
      </div>
      <div class="field">
        <label>${t("ril_direzione")}</label>
        <select id="r-direzione" disabled><option value="">—</option></select>
      </div>
      <div class="field">
        <label>${t("ril_corsia")}</label>
        <div id="r-corsia" class="corsie-chk"><span class="hint">${t("ril_corsia_hint")}</span></div>
      </div>
      <div class="field">
        <label>${t("ril_prog")} <span class="prog-km mono" id="r-prog-fmt"></span></label>
        <input id="r-prog" type="number" min="0" inputmode="numeric" placeholder="${t("ril_prog_ph")}" />
      </div>
      <div class="field">
        <label>${t("ril_data")}</label>
        <input id="r-data" type="datetime-local" />
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label>${t("ril_lat")}</label>
        <input id="r-lat" type="number" step="0.000001" placeholder="—" />
      </div>
      <div class="field">
        <label>${t("ril_lon")}</label>
        <input id="r-lon" type="number" step="0.000001" placeholder="—" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button type="button" class="btn btn-ghost" id="r-gps">${t("ril_gps")}</button>
        <div class="hint" id="r-gps-msg"></div>
      </div>
    </div>
  </div>

  <div class="panel form-panel">
    <h2 class="sec-h">${t("ril_foto")}</h2>
    <div class="foto-row">
      <button type="button" class="btn btn-ghost" id="r-foto-cam">${t("ril_foto_scatta")}</button>
      <button type="button" class="btn btn-ghost" id="r-foto-gal">${t("ril_foto_galleria")}</button>
      <input id="r-foto" type="file" accept="image/*" hidden />
      <span id="r-foto-name" class="hint" style="margin-left:12px"></span>
    </div>
    <div id="r-foto-prev" class="foto-prev"></div>
    <div style="margin-top:14px">
      <button type="button" class="btn btn-primary" id="r-ai" disabled>${t("ril_ai_avvia")}</button>
      <div id="r-ai-msg" class="hint" style="margin-top:8px"></div>
      <div id="r-ai-diag" class="ai-diag" hidden></div>
    </div>
  </div>

  <div class="panel form-panel">
    <h2 class="sec-h">${t("ril_pav")}</h2>
    <div class="form-grid">
      <div class="field">
        <label>${t("ril_strato")}</label>
        <select id="r-strato"><option value="">—</option>${STRATI().map(([v,l])=>opt(v,l)).join("")}</select>
      </div>
    </div>
  </div>

  <div class="panel form-panel">
    <h2 class="sec-h">${t("ril_distress_h")}</h2>
    <div class="form-grid">
      <div class="field">
        <label>${t("ril_tipo")}</label>
        <select id="r-dtipo"><option value="">${t("cat_caricamento")}</option></select>
      </div>
      <div class="field">
        <label>${t("ril_sev")}</label>
        <select id="r-dsev"><option value="">—</option>${SEV().map(([v,l])=>opt(v,l)).join("")}</select>
      </div>
      <div class="field">
        <label>${t("ril_est")} (<span id="r-dunit">—</span>)</label>
        <input id="r-dest" type="number" step="0.01" min="0" placeholder="0" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button type="button" class="btn btn-ghost" id="r-dadd">${t("ril_add")}</button>
      </div>
    </div>
    <div id="r-dlist" class="chips"></div>
  </div>

  <div class="panel form-panel">
    <button type="button" class="btn btn-primary" id="r-save">${t("ril_salva")}</button>
    <button type="button" class="btn btn-ghost" id="r-nuovo" style="margin-left:8px">${t("ril_nuovo")}</button>
    <div id="r-msg" class="mono" style="margin-top:12px;min-height:18px"></div>
    <div id="r-saved" hidden></div>
  </div>`;
}

function wire(root) {
  const $ = (s) => root.querySelector(s);
  const strada=$("#r-strada"), dir=$("#r-direzione"), corsia=$("#r-corsia");
  const prog=$("#r-prog"), progFmt=$("#r-prog-fmt");
  const lat=$("#r-lat"), lon=$("#r-lon"), gpsBtn=$("#r-gps"), gpsMsg=$("#r-gps-msg");
  const strato=$("#r-strato");
  const dtipo=$("#r-dtipo"), dsev=$("#r-dsev"), dest=$("#r-dest"), dunit=$("#r-dunit");
  const dadd=$("#r-dadd"), dlist=$("#r-dlist");
  const saveBtn=$("#r-save"), msg=$("#r-msg"), savedBox=$("#r-saved");
  const dataInput=$("#r-data"), nuovoBtn=$("#r-nuovo");
  const oraLocaleISO = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
  const corsieSelezionate = () => { const v=[...corsia.querySelectorAll("input:checked")].map((i)=>i.value); return v.length ? v.join(",") : null; };
  if (dataInput) dataInput.value = oraLocaleISO();

  dtipo.innerHTML = `<option value="">—</option>` + optgroupsDistress(catalogo);

  function syncUnit() {
    const d = catalogo.find((x) => x.id === dtipo.value);
    dunit.textContent = d ? (UNITA[d.unita_misura] || d.unita_misura || "—") : "—";
    const noSev = d ? !d.ha_severita : false;
    dsev.disabled = noSev;
    if (noSev) dsev.value = "";
  }
  dtipo.addEventListener("change", syncUnit);

  strada.addEventListener("change", () => {
    const s = strada.value;
    dir.innerHTML = `<option value="">—</option>` + STRADA_DIR(s).map(([v,l])=>opt(v,l)).join("");
    corsia.innerHTML = s
      ? (STRADA_CORSIE[s]||[]).map((c)=>`<label class="chk"><input type="checkbox" value="${c}"> ${c}</label>`).join("")
      : `<span class="hint">${t("ril_corsia_hint")}</span>`;
    dir.disabled = !s;
  });

  prog.addEventListener("input", () => progFmt.textContent = fmtProg(prog.value));

  let ultimoScostamento = null;
  async function calcolaProgressiva() {
    ultimoScostamento = null;
    const s = strada.value;
    if (!s) { gpsMsg.textContent = t("ril_m_strada_prima"); return; }
    if (lat.value === "" || lon.value === "") { gpsMsg.textContent = t("ril_m_coord"); return; }
    gpsMsg.textContent = t("ril_m_calc_prog");
    try {
      const r = await gpsToProgressiva(s, Number(lat.value), Number(lon.value));
      if (!r) { gpsMsg.textContent = `${t("ril_etto_a")} ${s}${t("ril_etto_b")}`; return; }
      prog.value = r.progressiva_m; progFmt.textContent = fmtProg(r.progressiva_m);
      ultimoScostamento = r.scostamento_m;
      gpsMsg.textContent = `${t("ril_prog_ok")} ${r.scostamento_m} m`;
    } catch (e) { gpsMsg.textContent = (t("ril_errore") + ": ") + ((e && e.message) || e); }
  }
  async function calcolaCoordinate() {
    const s = strada.value;
    if (!s) { gpsMsg.textContent = t("ril_m_strada_prima"); return; }
    if (prog.value === "") { gpsMsg.textContent = t("ril_m_ins_prog"); return; }
    gpsMsg.textContent = t("ril_m_calc_coord");
    try {
      const r = await progressivaToGps(s, Number(prog.value));
      if (!r) { gpsMsg.textContent = `${t("ril_etto_a")} ${s}${t("ril_etto_b")}`; return; }
      lat.value = r.lat.toFixed(6); lon.value = r.lon.toFixed(6);
      gpsMsg.textContent = t("ril_m_coord_ok");
    } catch (e) { gpsMsg.textContent = (t("ril_errore") + ": ") + ((e && e.message) || e); }
  }
  // conversione automatica: progressiva -> coordinate e coordinate -> progressiva
  prog.addEventListener("change", () => { if (strada.value && prog.value !== "") calcolaCoordinate(); });
  lat.addEventListener("change", () => { if (strada.value && lat.value !== "" && lon.value !== "") calcolaProgressiva(); });
  lon.addEventListener("change", () => { if (strada.value && lat.value !== "" && lon.value !== "") calcolaProgressiva(); });

  gpsBtn.addEventListener("click", () => {
    if (!navigator.geolocation) { gpsMsg.textContent = t("ril_m_gps_nd"); return; }
    gpsMsg.textContent = t("ril_m_lettura");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        lat.value = p.coords.latitude.toFixed(6); lon.value = p.coords.longitude.toFixed(6);
        gpsMsg.textContent = t("ril_m_pos_ok");
        if (strada.value) calcolaProgressiva();   // GPS -> progressiva automatica
      },
      () => { gpsMsg.textContent = t("ril_m_gps_negato"); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  const foto = $("#r-foto"), aiBtn = $("#r-ai"), aiMsg = $("#r-ai-msg"), aiDiag = $("#r-ai-diag");
  $("#r-foto-cam").addEventListener("click", () => { foto.setAttribute("capture","environment"); foto.click(); });
  $("#r-foto-gal").addEventListener("click", () => { foto.removeAttribute("capture"); foto.click(); });
  let ubicaPer = null; // indice del distress che si sta ubicando sulla foto
  function disegnaMarkers() {
    const layer = $("#r-foto-markers");
    if (!layer) return;
    layer.innerHTML = lista.map((x, i) => {
      const p = x.posizione;
      if (!p || !p.punti || !p.punti.length) return "";
      if (p.tipo === "area" && p.punti.length >= 2) {
        const [[x1, y1], [x2, y2]] = p.punti;
        const l = Math.min(x1, x2) * 100, t = Math.min(y1, y2) * 100;
        const w = Math.abs(x2 - x1) * 100, h = Math.abs(y2 - y1) * 100;
        return `<div class="foto-box${x.origine === "ai" ? " ai" : ""}" style="left:${l}%;top:${t}%;width:${w}%;height:${h}%"><span class="foto-box-tag">${x.origine === "ai" ? "AI" : (i + 1)}</span></div>`;
      }
      return `<div class="foto-mk${x.origine === "ai" ? " ai" : ""}" style="left:${p.punti[0][0] * 100}%;top:${p.punti[0][1] * 100}%">${i + 1}</div>`;
    }).join("");
  }
  function showFotoPreview() {
    const prev = $("#r-foto-prev"), name = $("#r-foto-name");
    aiBtn.disabled = !fotoFile;
    if (!fotoFile) { prev.innerHTML = ""; name.textContent = ""; return; }
    const url = URL.createObjectURL(fotoFile);
    prev.innerHTML = `<div class="foto-stage" id="r-foto-stage"><img src="${url}" class="foto-img" alt="anteprima" /><div class="foto-markers" id="r-foto-markers"></div></div>
      <button type="button" class="btn btn-ghost" id="r-foto-rm">${t("ril_m_rimuovi_foto")}</button>`;
    name.textContent = fotoFile.name || "";
    const stage = $("#r-foto-stage");
    stage.addEventListener("click", (ev) => {
      if (ubicaPer == null || !lista[ubicaPer]) return;
      const r = stage.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      lista[ubicaPer].posizione = { tipo: "punto", punti: [[+x.toFixed(4), +y.toFixed(4)]] };
      ubicaPer = null; stage.classList.remove("placing"); msg.textContent = "";
      disegnaMarkers(); renderChips();
    });
    prev.querySelector("#r-foto-rm").addEventListener("click", () => {
      fotoFile = null; foto.value = ""; aiMsg.textContent = ""; aiDiag.hidden = true; aiDiag.innerHTML = ""; ubicaPer = null;
      lista.forEach((x) => { delete x.posizione; }); // le posizioni erano riferite alla foto rimossa
      showFotoPreview(); renderChips();
    });
    disegnaMarkers();
  }
  foto.addEventListener("change", () => { fotoFile = foto.files[0] || null; aiMsg.textContent = ""; aiDiag.hidden = true; aiDiag.innerHTML = ""; showFotoPreview(); });

  function applicaAI(res) {
    if (res.strato && ["drenante_nuovo","drenante_maturo","non_drenante","non_determinabile"].includes(res.strato)) {
      strato.value = res.strato;
    }
    let n = 0;
    (res.distress || []).forEach((x) => {
      const d = catalogo.find((c) => String(c.codice) === String(x.codice));
      if (!d) return;
      const sev = ["bassa","media","alta"].includes(x.severita) ? x.severita : null;
      const item = {
        distress_id: d.id,
        nome: `${d.codice} · ${tx(d.nome) || ""}`,
        severita: d.ha_severita ? sev : null,
        estensione_valore: null,
        estensione_unita: d.unita_misura,
        origine: "ai",
        confidenza: typeof x.confidenza === "number" ? x.confidenza : null,
      };
      // l'AI disegna da sola: box_2d = [ymin, xmin, ymax, xmax] in 0-1000
      if (Array.isArray(x.box_2d) && x.box_2d.length === 4) {
        const [ymin, xmin, ymax, xmax] = x.box_2d.map(Number);
        const x1 = Math.min(xmin, xmax) / 1000, y1 = Math.min(ymin, ymax) / 1000;
        const x2 = Math.max(xmin, xmax) / 1000, y2 = Math.max(ymin, ymax) / 1000;
        if ([x1, y1, x2, y2].every((v) => v >= 0 && v <= 1)) {
          item.posizione = { tipo: "area", punti: [[+x1.toFixed(4), +y1.toFixed(4)], [+x2.toFixed(4), +y2.toFixed(4)]] };
        }
      }
      lista.push(item);
      n++;
    });
    renderChips();
    return n;
  }

  aiBtn.addEventListener("click", async () => {
    if (!fotoFile) return;
    aiBtn.disabled = true; aiMsg.style.color = "var(--muted)"; aiMsg.textContent = t("ril_m_ric_corso");
    try {
      const blob = await ridimensiona(fotoFile, 1024, 0.8);
      const image = await blobToBase64(blob);
      const esempi = await raccogliEsempi(strato.value || null);
      const res = await riconosciDistress({
        image, mimeType: "image/jpeg",
        strato: strato.value || null,
        catalogo: catalogo.map((d) => ({ codice: d.codice, nome: tx(d.nome) || "" })),
        esempi,
      });
      if (res && res.error) throw new Error(res.error);
      const n = applicaAI(res || {});
      if (res && res.descrizione) {
        aiDiag.hidden = false;
        aiDiag.innerHTML = `<div class="ai-diag-h">${t("ril_ai_diag")}</div><div class="ai-diag-t">${String(res.descrizione)}</div>`;
      }
      const rif = esempi.length ? ` · ${esempi.length} ${t("ril_esempi")}` : "";
      const mod = res && res._modello ? ` · ${res._modello}` : "";
      aiMsg.style.color = "var(--ok)"; aiMsg.textContent = `${t("ril_ric_ok")} · ${n} ${t("ril_aggiunti")}${rif}${mod}`;
    } catch (e) {
      aiMsg.style.color = "#ff8a8a"; aiMsg.textContent = (t("ril_errore_ai") + ": ") + ((e && e.message) || e);
    } finally {
      aiBtn.disabled = !fotoFile;
    }
  });

  function renderChips() {
    dlist.innerHTML = lista.map((x, i) => `
      <span class="chip">
        <strong>${x.nome}</strong>${x.severita ? ` · ${t("sev_"+x.severita)}` : ""}${x.estensione_valore != null ? ` · ${x.estensione_valore} ${UNITA[x.estensione_unita]||x.estensione_unita}` : ""}${x.origine === "ai" ? ` · <span style="color:var(--accent)">AI${x.confidenza != null ? " " + Math.round(x.confidenza*100) + "%" : ""}</span>` : ""}
        <button type="button" class="chip-loc${x.posizione ? " set" : ""}" data-i="${i}" title="${t("ril_ubica")}">📍${x.posizione ? " " + (i + 1) : ""}</button>
        <button type="button" class="chip-x" data-i="${i}" aria-label="rimuovi">×</button>
      </span>`).join("");
    dlist.querySelectorAll(".chip-x").forEach((b) =>
      b.addEventListener("click", () => { lista.splice(Number(b.dataset.i),1); renderChips(); }));
    dlist.querySelectorAll(".chip-loc").forEach((b) =>
      b.addEventListener("click", () => {
        if (!fotoFile) { msg.style.color = "#ff8a8a"; msg.textContent = t("ril_m_ubica_prima"); return; }
        ubicaPer = Number(b.dataset.i);
        const stage = $("#r-foto-stage"); if (stage) stage.classList.add("placing");
        msg.style.color = "var(--muted)"; msg.textContent = t("ril_m_tocca");
      }));
    disegnaMarkers();
  }

  dadd.addEventListener("click", () => {
    const d = catalogo.find((x) => x.id === dtipo.value);
    if (!d) { msg.style.color="#ff8a8a"; msg.textContent=t("ril_sel_tipo"); return; }
    lista.push({
      distress_id: d.id,
      nome: `${d.codice} · ${tx(d.nome) || ""}`,
      severita: d.ha_severita ? (dsev.value || null) : null,
      estensione_valore: dest.value === "" ? null : Number(dest.value),
      estensione_unita: d.unita_misura,
      origine: "operatore",
      confidenza: null,
    });
    dest.value = ""; msg.textContent = ""; renderChips();
  });

  saveBtn.addEventListener("click", async () => {
    if (!strada.value || !strato.value) {
      msg.style.color="#ff8a8a"; msg.textContent=t("ril_compila"); return;
    }
    saveBtn.disabled = true; msg.style.color="var(--muted)"; msg.textContent=t("nf_salvataggio");
    const rilievo = {
      strato: strato.value,
      strada: strada.value,
      direzione: dir.value || null,
      corsia: corsieSelezionate(),
      progressiva_m: prog.value === "" ? null : Number(prog.value),
      progressiva_origine: "manuale",
      scostamento_m: ultimoScostamento,
      gps_lat: lat.value === "" ? null : Number(lat.value),
      gps_lon: lon.value === "" ? null : Number(lon.value),
    };
    if (dataInput && dataInput.value) rilievo.created_at = new Date(dataInput.value).toISOString();
    const rows = lista.map(({ nome, ...keep }) => keep);
    // --- IQ (Indice di Qualità) calcolato dai distress di questo rilievo ---
    const itemsIQ = lista.map((x) => {
      const d = catalogo.find((c) => c.id === x.distress_id) || {};
      return {
        severita: x.severita,
        estensione_valore: x.estensione_valore,
        estensione_unita: x.estensione_unita || d.unita_misura,
        deduct_params: d.deduct_params,
        ha_severita: d.ha_severita,
      };
    });
    const ris = calcolaIQ(itemsIQ);
    rilievo.iq = ris.iq;
    rilievo.iq_fascia = ris.fascia;
    try {
      if (fotoFile) {
        msg.textContent = t("ril_m_elab_foto");
        const full = await ridimensiona(fotoFile, 1600, 0.8);
        const thumb = await ridimensiona(fotoFile, 320, 0.7);
        const base = (crypto.randomUUID ? crypto.randomUUID() : "f" + Date.now());
        msg.textContent = t("ril_m_caric_foto");
        await storage.put(full, `${base}.jpg`);
        await storage.put(thumb, `${base}_thumb.jpg`);
        rilievo.foto_id = `${base}.jpg`;
        rilievo.thumb_path = `${base}_thumb.jpg`;
        msg.textContent = t("nf_salvataggio");
      }
      const salvati = lista.slice();   // snapshot prima del reset
      const r = await db.rilievi.createConDistress(rilievo, rows);
      msg.style.color = "var(--ok)";
      msg.textContent = `✓ ${t("ril_salv_ok")} (id ${String(r.id).slice(0,8)}…) · ${rows.length} distress.`;

      // riepilogo: badge IQ + distress individuati (così non serve aprire lo Storico)
      const iqHtml = `<div class="iq-line"><span class="iq-badge iq-${ris.fasciaKey}">IQ ${ris.iq}</span><span class="iq-fascia">${ris.fascia}</span></div>`;
      const distrHtml = salvati.length
        ? `<div class="saved-title mono">${t("ril_saved_title")}</div><div class="saved-list">` +
          salvati.map((d) => {
            const sev = d.severita ? ` · ${t("sev_"+d.severita)}` : "";
            const org = d.origine === "ai"
              ? `<span class="saved-tag ai">AI${typeof d.confidenza === "number" ? " " + Math.round(d.confidenza*100) + "%" : ""}</span>`
              : `<span class="saved-tag op">${t("ril_saved_op")}</span>`;
            return `<div class="saved-item"><span class="saved-nome">${d.nome}</span><span class="saved-meta mono">${sev}</span>${org}</div>`;
          }).join("") + `</div>`
        : "";
      savedBox.innerHTML = iqHtml + distrHtml;
      savedBox.hidden = false;
      // reset leggero (lascio strada/direzione/corsia/strato per rilievi consecutivi)
      lista = []; renderChips();
      fotoFile = null; foto.value = ""; aiMsg.textContent = ""; showFotoPreview();
      prog.value=""; progFmt.textContent="—"; lat.value=""; lon.value=""; gpsMsg.textContent=""; dest.value="";
    } catch (e) {
      msg.style.color = "#ff8a8a";
      msg.textContent = (t("nf_errore") + ": ") + ((e && e.message) ? e.message : e);
    } finally {
      saveBtn.disabled = false;
    }
  });

  function nuovoRilievo() {
    strada.value=""; dir.innerHTML=`<option value="">—</option>`; dir.disabled=true;
    corsia.innerHTML=`<span class="hint">${t("ril_corsia_hint")}</span>`;
    strato.value="";
    prog.value=""; progFmt.textContent="—"; lat.value=""; lon.value=""; gpsMsg.textContent="";
    dest.value=""; dtipo.value=""; dsev.value=""; dsev.disabled=false; dunit.textContent="—";
    ultimoScostamento=null;
    lista=[]; renderChips();
    fotoFile=null; foto.value=""; aiMsg.textContent=""; aiDiag.hidden=true; aiDiag.innerHTML=""; aiBtn.disabled=true; showFotoPreview();
    if (dataInput) dataInput.value = oraLocaleISO();
    msg.textContent=""; msg.style.color="var(--muted)"; savedBox.hidden=true; savedBox.innerHTML="";
  }
  if (nuovoBtn) nuovoBtn.addEventListener("click", nuovoRilievo);
}

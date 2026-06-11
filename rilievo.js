// =====================================================================
//  Sezione RILIEVO (sottopasso 1: inserimento manuale + salvataggio).
//  Foto, GPS→progressiva, riconoscimento AI ed evoluzione: sottopassi successivi.
// =====================================================================

import { db, riconosciDistress } from "./db.js";
import { storage } from "./storage.js";
import { calcolaIQ, fasciaDi } from "./iq.js";
import { optgroupsDistress } from "./gruppi.js";

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

const STRADA_DIR = {
  A4:  [["est","Est"],["ovest","Ovest"]],
  A31: [["nord","Nord"],["sud","Sud"]],
};
const STRADA_CORSIE = { A4: [0,1,2,3], A31: [0,1,2] };
const SEV = [["bassa","Bassa"],["media","Media"],["alta","Alta"]];
const UNITA = { m: "m", m2: "m²", conteggio: "n°" };
const STRATI = [
  ["drenante_nuovo","Drenante nuovo"],
  ["drenante_maturo","Drenante maturo"],
  ["non_drenante","Non drenante"],
  ["non_determinabile","Non determinabile"],
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
          nome: e.distress ? ((e.distress.nome && e.distress.nome.it) || "") : "",
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
    <h2 class="sec-h">Localizzazione</h2>
    <div class="form-grid">
      <div class="field">
        <label>Strada</label>
        <select id="r-strada"><option value="">—</option>${opt("A4","A4")}${opt("A31","A31")}</select>
      </div>
      <div class="field">
        <label>Direzione</label>
        <select id="r-direzione" disabled><option value="">—</option></select>
      </div>
      <div class="field">
        <label>Corsia</label>
        <select id="r-corsia" disabled><option value="">—</option></select>
      </div>
      <div class="field">
        <label>Progressiva (metri) <span class="prog-km mono" id="r-prog-fmt"></span></label>
        <input id="r-prog" type="number" min="0" inputmode="numeric" placeholder="es. 217700" />
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label>Latitudine</label>
        <input id="r-lat" type="number" step="0.000001" placeholder="—" />
      </div>
      <div class="field">
        <label>Longitudine</label>
        <input id="r-lon" type="number" step="0.000001" placeholder="—" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button type="button" class="btn btn-ghost" id="r-gps">Usa GPS</button>
        <div class="hint" id="r-gps-msg"></div>
      </div>
    </div>
  </div>

  <div class="panel form-panel">
    <h2 class="sec-h">Foto</h2>
    <div class="foto-row">
      <label class="btn btn-ghost" style="cursor:pointer;display:inline-block">
        Scegli o scatta foto
        <input id="r-foto" type="file" accept="image/*" hidden />
      </label>
      <span id="r-foto-name" class="hint" style="margin-left:12px"></span>
    </div>
    <div id="r-foto-prev" class="foto-prev"></div>
    <div style="margin-top:14px">
      <button type="button" class="btn btn-primary" id="r-ai" disabled>Avvia riconoscimento AI</button>
      <div id="r-ai-msg" class="hint" style="margin-top:8px"></div>
      <div id="r-ai-diag" class="ai-diag" hidden></div>
    </div>
  </div>

  <div class="panel form-panel">
    <h2 class="sec-h">Pavimentazione</h2>
    <div class="form-grid">
      <div class="field">
        <label>Strato superficiale</label>
        <select id="r-strato"><option value="">—</option>${STRATI.map(([v,l])=>opt(v,l)).join("")}</select>
      </div>
    </div>
  </div>

  <div class="panel form-panel">
    <h2 class="sec-h">Distress (operatore)</h2>
    <div class="form-grid">
      <div class="field">
        <label>Tipo</label>
        <select id="r-dtipo"><option value="">caricamento…</option></select>
      </div>
      <div class="field">
        <label>Severità</label>
        <select id="r-dsev"><option value="">—</option>${SEV.map(([v,l])=>opt(v,l)).join("")}</select>
      </div>
      <div class="field">
        <label>Estensione (<span id="r-dunit">—</span>)</label>
        <input id="r-dest" type="number" step="0.01" min="0" placeholder="0" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button type="button" class="btn btn-ghost" id="r-dadd">+ Aggiungi</button>
      </div>
    </div>
    <div id="r-dlist" class="chips"></div>
  </div>

  <div class="panel form-panel">
    <button type="button" class="btn btn-primary" id="r-save">Salva rilievo</button>
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
    dir.innerHTML = `<option value="">—</option>` + (STRADA_DIR[s]||[]).map(([v,l])=>opt(v,l)).join("");
    corsia.innerHTML = `<option value="">—</option>` + (STRADA_CORSIE[s]||[]).map((c)=>opt(c,c)).join("");
    dir.disabled = !s; corsia.disabled = !s;
  });

  prog.addEventListener("input", () => progFmt.textContent = fmtProg(prog.value));

  let ultimoScostamento = null;
  async function calcolaProgressiva() {
    ultimoScostamento = null;
    const s = strada.value;
    if (!s) { gpsMsg.textContent = "Scegli prima la strada."; return; }
    if (lat.value === "" || lon.value === "") { gpsMsg.textContent = "Servono le coordinate."; return; }
    gpsMsg.textContent = "calcolo progressiva…";
    try {
      const r = await gpsToProgressiva(s, Number(lat.value), Number(lon.value));
      if (!r) { gpsMsg.textContent = `Dati ettometrici assenti per ${s}: caricali in Impostazioni.`; return; }
      prog.value = r.progressiva_m; progFmt.textContent = fmtProg(r.progressiva_m);
      ultimoScostamento = r.scostamento_m;
      gpsMsg.textContent = `progressiva calcolata · scostamento ${r.scostamento_m} m`;
    } catch (e) { gpsMsg.textContent = "Errore: " + ((e && e.message) || e); }
  }
  async function calcolaCoordinate() {
    const s = strada.value;
    if (!s) { gpsMsg.textContent = "Scegli prima la strada."; return; }
    if (prog.value === "") { gpsMsg.textContent = "Inserisci la progressiva."; return; }
    gpsMsg.textContent = "calcolo coordinate…";
    try {
      const r = await progressivaToGps(s, Number(prog.value));
      if (!r) { gpsMsg.textContent = `Dati ettometrici assenti per ${s}: caricali in Impostazioni.`; return; }
      lat.value = r.lat.toFixed(6); lon.value = r.lon.toFixed(6);
      gpsMsg.textContent = "coordinate calcolate dalla progressiva";
    } catch (e) { gpsMsg.textContent = "Errore: " + ((e && e.message) || e); }
  }
  // conversione automatica: progressiva -> coordinate e coordinate -> progressiva
  prog.addEventListener("change", () => { if (strada.value && prog.value !== "") calcolaCoordinate(); });
  lat.addEventListener("change", () => { if (strada.value && lat.value !== "" && lon.value !== "") calcolaProgressiva(); });
  lon.addEventListener("change", () => { if (strada.value && lat.value !== "" && lon.value !== "") calcolaProgressiva(); });

  gpsBtn.addEventListener("click", () => {
    if (!navigator.geolocation) { gpsMsg.textContent = "GPS non disponibile"; return; }
    gpsMsg.textContent = "lettura…";
    navigator.geolocation.getCurrentPosition(
      (p) => {
        lat.value = p.coords.latitude.toFixed(6); lon.value = p.coords.longitude.toFixed(6);
        gpsMsg.textContent = "posizione acquisita";
        if (strada.value) calcolaProgressiva();   // GPS -> progressiva automatica
      },
      () => { gpsMsg.textContent = "GPS negato o non disponibile"; },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  const foto = $("#r-foto"), aiBtn = $("#r-ai"), aiMsg = $("#r-ai-msg"), aiDiag = $("#r-ai-diag");
  let ubicaPer = null; // indice del distress che si sta ubicando sulla foto
  function disegnaMarkers() {
    const layer = $("#r-foto-markers");
    if (!layer) return;
    layer.innerHTML = lista.map((x, i) => (x.posizione && x.posizione.punti && x.posizione.punti[0])
      ? `<div class="foto-mk${x.origine === "ai" ? " ai" : ""}" style="left:${x.posizione.punti[0][0] * 100}%;top:${x.posizione.punti[0][1] * 100}%">${i + 1}</div>`
      : "").join("");
  }
  function showFotoPreview() {
    const prev = $("#r-foto-prev"), name = $("#r-foto-name");
    aiBtn.disabled = !fotoFile;
    if (!fotoFile) { prev.innerHTML = ""; name.textContent = ""; return; }
    const url = URL.createObjectURL(fotoFile);
    prev.innerHTML = `<div class="foto-stage" id="r-foto-stage"><img src="${url}" class="foto-img" alt="anteprima" /><div class="foto-markers" id="r-foto-markers"></div></div>
      <button type="button" class="btn btn-ghost" id="r-foto-rm">Rimuovi foto</button>`;
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
      lista.push({
        distress_id: d.id,
        nome: `${d.codice} · ${(d.nome && d.nome.it) || ""}`,
        severita: d.ha_severita ? sev : null,
        estensione_valore: null,
        estensione_unita: d.unita_misura,
        origine: "ai",
        confidenza: typeof x.confidenza === "number" ? x.confidenza : null,
      });
      n++;
    });
    renderChips();
    return n;
  }

  aiBtn.addEventListener("click", async () => {
    if (!fotoFile) return;
    aiBtn.disabled = true; aiMsg.style.color = "var(--muted)"; aiMsg.textContent = "riconoscimento in corso…";
    try {
      const blob = await ridimensiona(fotoFile, 1024, 0.8);
      const image = await blobToBase64(blob);
      const esempi = await raccogliEsempi(strato.value || null);
      const res = await riconosciDistress({
        image, mimeType: "image/jpeg",
        strato: strato.value || null,
        catalogo: catalogo.map((d) => ({ codice: d.codice, nome: (d.nome && d.nome.it) || "" })),
        esempi,
      });
      if (res && res.error) throw new Error(res.error);
      const n = applicaAI(res || {});
      if (res && res.descrizione) {
        aiDiag.hidden = false;
        aiDiag.innerHTML = `<div class="ai-diag-h">✦ Diagnosi AI</div><div class="ai-diag-t">${String(res.descrizione)}</div>`;
      }
      const rif = esempi.length ? ` · ${esempi.length} esempi` : "";
      const mod = res && res._modello ? ` · ${res._modello}` : "";
      aiMsg.style.color = "var(--ok)"; aiMsg.textContent = `riconoscimento completato · ${n} distress aggiunti${rif}${mod}`;
    } catch (e) {
      aiMsg.style.color = "#ff8a8a"; aiMsg.textContent = "Errore AI: " + ((e && e.message) || e);
    } finally {
      aiBtn.disabled = !fotoFile;
    }
  });

  function renderChips() {
    dlist.innerHTML = lista.map((x, i) => `
      <span class="chip">
        <strong>${x.nome}</strong>${x.severita ? ` · ${x.severita}` : ""}${x.estensione_valore != null ? ` · ${x.estensione_valore} ${UNITA[x.estensione_unita]||x.estensione_unita}` : ""}${x.origine === "ai" ? ` · <span style="color:var(--accent)">AI${x.confidenza != null ? " " + Math.round(x.confidenza*100) + "%" : ""}</span>` : ""}
        <button type="button" class="chip-loc${x.posizione ? " set" : ""}" data-i="${i}" title="Ubica sulla foto">📍${x.posizione ? " " + (i + 1) : ""}</button>
        <button type="button" class="chip-x" data-i="${i}" aria-label="rimuovi">×</button>
      </span>`).join("");
    dlist.querySelectorAll(".chip-x").forEach((b) =>
      b.addEventListener("click", () => { lista.splice(Number(b.dataset.i),1); renderChips(); }));
    dlist.querySelectorAll(".chip-loc").forEach((b) =>
      b.addEventListener("click", () => {
        if (!fotoFile) { msg.style.color = "#ff8a8a"; msg.textContent = "Carica prima una foto per ubicare i distress."; return; }
        ubicaPer = Number(b.dataset.i);
        const stage = $("#r-foto-stage"); if (stage) stage.classList.add("placing");
        msg.style.color = "var(--muted)"; msg.textContent = "Tocca la foto per posizionare il distress selezionato.";
      }));
    disegnaMarkers();
  }

  dadd.addEventListener("click", () => {
    const d = catalogo.find((x) => x.id === dtipo.value);
    if (!d) { msg.style.color="#ff8a8a"; msg.textContent="Seleziona un tipo di distress."; return; }
    lista.push({
      distress_id: d.id,
      nome: `${d.codice} · ${(d.nome && d.nome.it) || ""}`,
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
      msg.style.color="#ff8a8a"; msg.textContent="Compila almeno Strada e Strato superficiale."; return;
    }
    saveBtn.disabled = true; msg.style.color="var(--muted)"; msg.textContent="salvataggio…";
    const rilievo = {
      strato: strato.value,
      strada: strada.value,
      direzione: dir.value || null,
      corsia: corsia.value === "" ? null : Number(corsia.value),
      progressiva_m: prog.value === "" ? null : Number(prog.value),
      progressiva_origine: "manuale",
      scostamento_m: ultimoScostamento,
      gps_lat: lat.value === "" ? null : Number(lat.value),
      gps_lon: lon.value === "" ? null : Number(lon.value),
    };
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
        msg.textContent = "elaborazione foto…";
        const full = await ridimensiona(fotoFile, 1600, 0.8);
        const thumb = await ridimensiona(fotoFile, 320, 0.7);
        const base = (crypto.randomUUID ? crypto.randomUUID() : "f" + Date.now());
        msg.textContent = "caricamento foto…";
        await storage.put(full, `${base}.jpg`);
        await storage.put(thumb, `${base}_thumb.jpg`);
        rilievo.foto_id = `${base}.jpg`;
        rilievo.thumb_path = `${base}_thumb.jpg`;
        msg.textContent = "salvataggio…";
      }
      const salvati = lista.slice();   // snapshot prima del reset
      const r = await db.rilievi.createConDistress(rilievo, rows);
      msg.style.color = "var(--ok)";
      msg.textContent = `✓ Rilievo salvato (id ${String(r.id).slice(0,8)}…) · ${rows.length} distress.`;

      // riepilogo: badge IQ + distress individuati (così non serve aprire lo Storico)
      const iqHtml = `<div class="iq-line"><span class="iq-badge iq-${ris.fasciaKey}">IQ ${ris.iq}</span><span class="iq-fascia">${ris.fascia}</span></div>`;
      const distrHtml = salvati.length
        ? `<div class="saved-title mono">Distress registrati</div><div class="saved-list">` +
          salvati.map((d) => {
            const sev = d.severita ? ` · sev. ${d.severita}` : "";
            const org = d.origine === "ai"
              ? `<span class="saved-tag ai">AI${typeof d.confidenza === "number" ? " " + Math.round(d.confidenza*100) + "%" : ""}</span>`
              : `<span class="saved-tag op">operatore</span>`;
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
      msg.textContent = "Errore nel salvataggio: " + ((e && e.message) ? e.message : e);
    } finally {
      saveBtn.disabled = false;
    }
  });
}

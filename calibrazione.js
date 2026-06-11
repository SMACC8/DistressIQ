// =====================================================================
// Sezione CALIBRAZIONE: libreria di esempi di riferimento per il few-shot.
//  Passo 1 — carica foto dedicate ed etichettale (distress/severità/strato).
//  Diventano esempi in ml_esempio (fonte = key_image), inclusi nel few-shot
//  se "attivo". Annotazione ad aree/linee (campo posizione) nel passo 3.
// =====================================================================

import { optgroupsDistress } from "./gruppi.js";
import { db } from "./db.js";
import { storage } from "./storage.js";

const STRATO = {
  drenante_nuovo: "Drenante nuovo",
  drenante_maturo: "Drenante maturo",
  non_drenante: "Non drenante",
  non_determinabile: "Non determinabile",
};
const SEVL = { bassa: "Bassa", media: "Media", alta: "Alta" };
const it = (o) => (o && (o.it || o.en || o.es)) || "";

// numeri prima, poi i personalizzati (C1, C2...) — come nel Rilievo
function ordina(arr) {
  return [...arr].sort((a, b) => {
    const na = parseInt(a.codice, 10), nb = parseInt(b.codice, 10);
    const va = isNaN(na), vb = isNaN(nb);
    if (va && vb) return (a.codice || "").localeCompare(b.codice || "");
    if (va) return 1;
    if (vb) return -1;
    return na - nb;
  });
}

function thumbDi(fotoId) {
  return fotoId ? fotoId.replace(/\.jpg$/i, "_thumb.jpg") : null;
}

// File -> JPEG ridimensionato (riuso dello stesso approccio del Rilievo)
function ridimensiona(file, max, q) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > h && w > max) { h = Math.round((h * max) / w); w = max; }
      else if (h >= w && h > max) { w = Math.round((w * max) / h); h = max; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("conversione fallita"))), "image/jpeg", q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("immagine non leggibile")); };
    img.src = url;
  });
}

function markup() {
  return `
    <div class="panel form-panel">
      <h2 class="sec-h">Nuovo esempio di riferimento</h2>
      <div class="cal-foto">
        <input type="file" id="cal-file" accept="image/*" capture="environment" hidden>
        <button class="btn" id="cal-pick">Scegli o scatta foto</button>
        <div id="cal-prev" class="cal-prev" hidden>
          <img id="cal-prev-img" alt="anteprima">
          <button class="btn cal-rm" id="cal-rm">Rimuovi</button>
        </div>
      </div>
      <div class="form-grid" style="margin-top:16px">
        <div class="field">
          <label>Distress</label>
          <select id="cal-distress"><option value="">caricamento…</option></select>
        </div>
        <div class="field">
          <label>Severità</label>
          <select id="cal-sev">
            <option value="">—</option>
            <option value="bassa">Bassa</option>
            <option value="media">Media</option>
            <option value="alta">Alta</option>
          </select>
        </div>
        <div class="field">
          <label>Strato</label>
          <select id="cal-strato">
            <option value="">—</option>
            <option value="drenante_nuovo">Drenante nuovo</option>
            <option value="drenante_maturo">Drenante maturo</option>
            <option value="non_drenante">Non drenante</option>
            <option value="non_determinabile">Non determinabile</option>
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:16px">
        <button class="btn btn-primary" id="cal-save" disabled>Salva esempio</button>
        <span class="hint mono" id="cal-stato"></span>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <h2 class="sec-h">Libreria esempi</h2>
      <div class="mono" style="font-size:12px;color:var(--muted);margin-bottom:14px">
        Gli esempi <span style="color:var(--accent)">attivi</span> guidano il riconoscimento dell'AI come riferimenti (few-shot).
        Con <b>Annota</b> marchi <i>dove</i> si trova il distress su ciascun esempio. I riquadri che l'AI disegna li vedi invece nel <b>Rilievo</b>, dopo "Avvia riconoscimento AI".
      </div>
      <div id="cal-list" class="cal-list mono" style="color:var(--muted)">caricamento…</div>
    </div>`;
}

export async function renderCalibrazione(root) {
  root.innerHTML = markup();

  const fileInput = root.querySelector("#cal-file");
  const pickBtn = root.querySelector("#cal-pick");
  const prev = root.querySelector("#cal-prev");
  const prevImg = root.querySelector("#cal-prev-img");
  const rmBtn = root.querySelector("#cal-rm");
  const selDistress = root.querySelector("#cal-distress");
  const selSev = root.querySelector("#cal-sev");
  const selStrato = root.querySelector("#cal-strato");
  const saveBtn = root.querySelector("#cal-save");
  const stato = root.querySelector("#cal-stato");

  let file = null;
  let catalogo = [];

  // catalogo distress attivi nel menu
  try {
    catalogo = ordina(await db.distress.list());
    selDistress.innerHTML =
      `<option value="">— seleziona —</option>` + optgroupsDistress(catalogo);
  } catch (e) {
    selDistress.innerHTML = `<option value="">errore catalogo</option>`;
  }

  function aggiornaSeverita() {
    const d = catalogo.find((x) => x.id === selDistress.value);
    const ha = d ? d.ha_severita : true;
    selSev.disabled = !ha;
    if (!ha) selSev.value = "";
  }
  function aggiornaSave() {
    saveBtn.disabled = !(file && selDistress.value);
  }

  pickBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (file) {
      prevImg.src = URL.createObjectURL(file);
      prev.hidden = false;
    }
    aggiornaSave();
  });
  rmBtn.addEventListener("click", () => {
    file = null; fileInput.value = ""; prev.hidden = true; prevImg.removeAttribute("src");
    aggiornaSave();
  });
  selDistress.addEventListener("change", () => { aggiornaSeverita(); aggiornaSave(); });

  saveBtn.addEventListener("click", async () => {
    if (!file || !selDistress.value) return;
    saveBtn.disabled = true;
    stato.style.color = "var(--muted)";
    stato.textContent = "salvataggio…";
    try {
      const base = `esempi/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const full = await ridimensiona(file, 1280, 0.82);
      const thumb = await ridimensiona(file, 320, 0.7);
      await storage.put(full, `${base}.jpg`);
      await storage.put(thumb, `${base}_thumb.jpg`);
      await db.ml.create({
        foto_id: `${base}.jpg`,
        distress_id: selDistress.value,
        severita: selSev.value || null,
        strato: selStrato.value || null,
        posizione: null,
        fonte: "key_image",
        attivo: true,
      });
      // reset form
      file = null; fileInput.value = ""; prev.hidden = true; prevImg.removeAttribute("src");
      selSev.value = ""; selStrato.value = "";
      stato.style.color = "var(--accent)";
      stato.textContent = "esempio salvato";
      setTimeout(() => { stato.textContent = ""; }, 2500);
      caricaLista();
    } catch (e) {
      stato.style.color = "#ff8a8a";
      stato.textContent = `Errore: ${(e && e.message) ? e.message : e}`;
    } finally {
      aggiornaSave();
    }
  });

  async function caricaLista() {
    const box = root.querySelector("#cal-list");
    if (!box) return;
    try {
      const esempi = await db.ml.list();
      if (!esempi.length) {
        box.innerHTML = `<div class="placeholder"><div class="small">Nessun esempio ancora. Carica la prima foto di riferimento.</div></div>`;
        return;
      }
      box.style.color = "var(--text)";
      box.innerHTML = esempi.map((e) => {
        const turl = storage.url(thumbDi(e.foto_id));
        const nome = e.distress ? `${e.distress.codice}·${it(e.distress.nome)}` : "—";
        const meta = [SEVL[e.severita] || "", STRATO[e.strato] || "", e.fonte || ""]
          .filter(Boolean).join(" · ");
        const nReg = (e.posizione && Array.isArray(e.posizione.annotazioni)) ? e.posizione.annotazioni.length : 0;
        const regBadge = nReg ? `<span class="cal-reg mono">▢ ${nReg}</span>` : "";
        return `
          <div class="cal-item${e.attivo ? "" : " is-off"}" data-id="${e.id}">
            <img class="cal-thumb" src="${turl}" loading="lazy" alt="">
            <div class="cal-info">
              <div class="cal-title">${nome} ${regBadge}</div>
              <div class="cal-meta">${meta}</div>
            </div>
            <button class="btn cal-ann" data-id="${e.id}" title="Marca sull'immagine dove si trova il distress: guida l'AI">Annota</button>
            <button class="btn cal-tog" data-id="${e.id}" data-attivo="${e.attivo ? 1 : 0}">${e.attivo ? "Attivo" : "Disattivato"}</button>
            <button class="btn cal-del" data-id="${e.id}">Elimina</button>
          </div>`;
      }).join("");

      box.querySelectorAll(".cal-ann").forEach((b) =>
        b.addEventListener("click", () => {
          const e = esempi.find((x) => x.id === b.dataset.id);
          if (e) apriAnnotazione(e, caricaLista);
        }));

      box.querySelectorAll(".cal-tog").forEach((b) =>
        b.addEventListener("click", async () => {
          const id = b.dataset.id;
          const nuovo = b.dataset.attivo !== "1";
          b.disabled = true;
          try { await db.ml.update(id, { attivo: nuovo }); caricaLista(); }
          catch (err) { b.disabled = false; alert(`Errore: ${(err && err.message) || err}`); }
        }));

      box.querySelectorAll(".cal-del").forEach((b) =>
        b.addEventListener("click", async () => {
          const id = b.dataset.id;
          if (!confirm("Eliminare questo esempio?")) return;
          b.disabled = true;
          const e = esempi.find((x) => x.id === id);
          try {
            await db.ml.remove(id);
            if (e && e.foto_id) {
              storage.remove(e.foto_id).catch(() => {});
              storage.remove(thumbDi(e.foto_id)).catch(() => {});
            }
            caricaLista();
          } catch (err) { b.disabled = false; alert(`Errore: ${(err && err.message) || err}`); }
        }));
    } catch (e) {
      box.innerHTML = `Errore nel caricamento: ${(e && e.message) ? e.message : e}`;
    }
  }

  caricaLista();
}

// ---------- Annotazione: aree (rettangoli) e linee (polilinee) ----------
// Coordinate salvate normalizzate 0..1 -> indipendenti dalla risoluzione.
function apriAnnotazione(esempio, onSaved) {
  const N = 1000;
  const titolo = esempio.distress ? `${esempio.distress.codice}·${it(esempio.distress.nome)}` : "Esempio";

  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `
    <div class="modal modal-ann" role="dialog" aria-modal="true">
      <div class="m-head">
        <h3>Annotazione — ${titolo}</h3>
        <button class="m-close" aria-label="Chiudi">×</button>
      </div>
      <div class="m-body">
        <div class="ann-help">Marca <b>dove</b> si trova il distress su questa immagine di riferimento (disegna un'<b>area</b> o una <b>linea</b>). Queste regioni guidano il riconoscimento dell'AI sui rilievi futuri. Quando hai finito, premi <b>Salva annotazioni</b>.</div>
        <div class="ann-tools">
          <div class="ann-seg">
            <button class="btn ann-tool active" data-tool="area">Area</button>
            <button class="btn ann-tool" data-tool="linea">Linea</button>
          </div>
          <button class="btn" id="ann-fine">Termina linea</button>
          <button class="btn" id="ann-undo">Annulla ultimo</button>
          <button class="btn" id="ann-clear">Cancella tutto</button>
          <span class="hint mono" id="ann-info"></span>
        </div>
        <div class="ann-stage" id="ann-stage">
          <img id="ann-img" alt="">
          <svg id="ann-svg" viewBox="0 0 ${N} ${N}" preserveAspectRatio="none"></svg>
        </div>
        <div class="hint mono" style="margin-top:8px">Area: trascina per il rettangolo. Linea: tocca per aggiungere punti, poi "Termina linea" (o doppio tocco).</div>
      </div>
      <div class="m-foot">
        <div class="hint mono" id="ann-stato"></div>
        <div class="m-actions">
          <button class="btn" id="ann-annulla">Chiudi</button>
          <button class="btn btn-primary" id="ann-salva">Salva annotazioni</button>
        </div>
      </div>
    </div>`;

  const img = ov.querySelector("#ann-img");
  const svg = ov.querySelector("#ann-svg");
  const info = ov.querySelector("#ann-info");
  const stato = ov.querySelector("#ann-stato");
  const fineBtn = ov.querySelector("#ann-fine");
  const salvaBtn = ov.querySelector("#ann-salva");
  img.src = storage.url(esempio.foto_id);

  let tool = "area";
  let ann = (esempio.posizione && Array.isArray(esempio.posizione.annotazioni))
    ? esempio.posizione.annotazioni.map((a) => ({ tipo: a.tipo, punti: a.punti.map((p) => [p[0], p[1]]) }))
    : [];
  let lineaInCorso = null;
  let areaDrag = null;

  const px = (p) => [p[0] * N, p[1] * N];
  function rect(p0, p1, cls) {
    const [x0, y0] = px(p0), [x1, y1] = px(p1);
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    return `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" vector-effect="non-scaling-stroke"/>`;
  }
  function poly(punti, cls) {
    const pts = punti.map((p) => px(p).join(",")).join(" ");
    const dots = punti.map((p) => { const [x, y] = px(p); return `<rect class="ann-vtx" x="${x - 7}" y="${y - 7}" width="14" height="14" vector-effect="non-scaling-stroke"/>`; }).join("");
    return `<polyline class="${cls}" points="${pts}" fill="none" vector-effect="non-scaling-stroke"/>${dots}`;
  }
  function redraw() {
    let s = "";
    ann.forEach((a) => { s += a.tipo === "area" ? rect(a.punti[0], a.punti[1], "ann-shape") : poly(a.punti, "ann-shape"); });
    if (areaDrag) s += rect(areaDrag.start, areaDrag.end, "ann-shape ann-temp");
    if (lineaInCorso && lineaInCorso.length) s += poly(lineaInCorso, "ann-shape ann-temp");
    svg.innerHTML = s;
    info.textContent = `${ann.length} regioni` + (lineaInCorso ? ` · linea: ${lineaInCorso.length} punti` : "");
    fineBtn.hidden = tool !== "linea";
  }

  function xy(ev) {
    const r = svg.getBoundingClientRect();
    let x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  }
  function terminaLinea() {
    if (lineaInCorso && lineaInCorso.length >= 2) ann.push({ tipo: "linea", punti: lineaInCorso });
    lineaInCorso = null; redraw();
  }

  svg.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const p = xy(ev);
    if (tool === "area") { areaDrag = { start: p, end: p }; try { svg.setPointerCapture(ev.pointerId); } catch {} }
    else { if (!lineaInCorso) lineaInCorso = [p]; else lineaInCorso.push(p); }
    redraw();
  });
  svg.addEventListener("pointermove", (ev) => {
    if (tool === "area" && areaDrag) { areaDrag.end = xy(ev); redraw(); }
  });
  svg.addEventListener("pointerup", () => {
    if (tool === "area" && areaDrag) {
      const a = areaDrag; areaDrag = null;
      if (Math.abs(a.start[0] - a.end[0]) > 0.01 && Math.abs(a.start[1] - a.end[1]) > 0.01)
        ann.push({ tipo: "area", punti: [a.start, a.end] });
      redraw();
    }
  });
  svg.addEventListener("dblclick", () => { if (tool === "linea") terminaLinea(); });

  ov.querySelectorAll(".ann-tool").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.tool === tool) return;
      if (tool === "linea") terminaLinea();   // non perdere la linea in corso
      tool = b.dataset.tool;
      ov.querySelectorAll(".ann-tool").forEach((x) => x.classList.toggle("active", x === b));
      redraw();
    }));
  fineBtn.addEventListener("click", terminaLinea);
  ov.querySelector("#ann-undo").addEventListener("click", () => {
    if (lineaInCorso && lineaInCorso.length) { lineaInCorso.pop(); if (!lineaInCorso.length) lineaInCorso = null; }
    else ann.pop();
    redraw();
  });
  ov.querySelector("#ann-clear").addEventListener("click", () => { ann = []; lineaInCorso = null; areaDrag = null; redraw(); });

  const chiudi = () => { document.removeEventListener("keydown", onEsc); ov.remove(); };
  const onEsc = (e) => { if (e.key === "Escape") chiudi(); };
  ov.querySelector(".m-close").addEventListener("click", chiudi);
  ov.querySelector("#ann-annulla").addEventListener("click", chiudi);
  document.addEventListener("keydown", onEsc);

  salvaBtn.addEventListener("click", async () => {
    if (lineaInCorso) terminaLinea();
    salvaBtn.disabled = true; stato.style.color = "var(--muted)"; stato.textContent = "salvataggio…";
    try {
      await db.ml.update(esempio.id, { posizione: { annotazioni: ann } });
      chiudi();
      if (onSaved) onSaved();
    } catch (e) {
      salvaBtn.disabled = false;
      stato.style.color = "#ff8a8a";
      stato.textContent = "Errore: " + ((e && e.message) ? e.message : e);
    }
  });

  document.body.appendChild(ov);
  redraw();
}

// =====================================================================
//  TRAINING ROOM v2: gioco operatore-vs-AI con punti sulla foto.
//  - schermata iniziale con "Inizia"
//  - tocca la foto per segnare i distress (punti rossi H1, H2, ...)
//  - "Sfida l'AI": punti blu A1, A2, ... dai riquadri del modello
//  - "Soluzione": posizione corretta (verde) dall'esempio annotato
//  - punteggio su distress azzeccato + scarto di posizione
//  Quiz basato sulla banca esempi della Calibrazione (verità validata).
// =====================================================================

import { optgroupsDistress } from "./gruppi.js";
import { t } from "./i18n.js";
import { db, riconosciDistress } from "./db.js";
import { storage } from "./storage.js";

const SEVL = (k) => t("sev_" + k);
const it = (o) => (o && (o.it || o.en || o.es)) || "";

function ordina(arr) {
  return [...arr].sort((a, b) => {
    const na = parseInt(a.codice, 10), nb = parseInt(b.codice, 10);
    const va = isNaN(na), vb = isNaN(nb);
    if (va && vb) return (a.codice || "").localeCompare(b.codice || "");
    if (va) return 1; if (vb) return -1; return na - nb;
  });
}
function mescola(a) { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }

function ridimensiona(blob, max, q) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
      else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob((b) => b ? resolve(b) : reject(new Error("conversione")), "image/jpeg", q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("immagine")); };
    img.src = url;
  });
}
const b64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("lettura")); r.readAsDataURL(blob); });

function centroide(posizione) {
  if (!posizione || !Array.isArray(posizione.annotazioni)) return null;
  let sx = 0, sy = 0, n = 0;
  posizione.annotazioni.forEach((a) => (a.punti || []).forEach(([x, y]) => { sx += x; sy += y; n++; }));
  return n ? { x: sx / n, y: sy / n } : null;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const precisione = (d) => Math.max(0, Math.round(100 - d * 120)); // 0=perfetto -> 100%

export async function renderTraining(root) {
  root.innerHTML = `<div class="panel"><div class="mono" style="color:var(--muted)">${t("cat_caricamento")}</div></div>`;
  let esempi, catalogo;
  try {
    esempi = (await db.ml.list()).filter((e) => e.foto_id && e.distress);
    catalogo = ordina(await db.distress.list());
  } catch (e) {
    root.innerHTML = `<div class="panel mono" style="color:#ff8a8a">Errore: ${(e && e.message) || e}</div>`; return;
  }
  if (!esempi.length) {
    root.innerHTML = `<div class="panel"><div class="placeholder">
      <div class="big">${t("tr_vuota")}</div>
      <div class="small">${t("tr_vuota_sub")}</div></div></div>`;
    return;
  }

  const punti = { round: 0, tu: 0, ai: 0, aiRound: 0 };
  let ordine = [], idx = 0;

  // -------- schermata iniziale --------
  function start() {
    root.innerHTML = `
      <div class="panel tr-start">
        <div class="tr-start-titolo">${t("nav_training")}</div>
        <p class="tr-start-p">${t("tr_intro")}</p>
        <button class="btn btn-primary" id="tr-inizia">${t("tr_inizia")}</button>
      </div>`;
    root.querySelector("#tr-inizia").addEventListener("click", () => {
      ordine = mescola(esempi); idx = 0; punti.round = 0; punti.tu = 0; punti.ai = 0; punti.aiRound = 0;
      round();
    });
  }

  function scoreHtml() {
    const aiTxt = punti.aiRound ? `${punti.ai}/${punti.aiRound}` : "—";
    return `<div class="tr-score">
      <div class="tr-sc"><span class="tr-sc-l">${t("tr_round")}</span><span class="tr-sc-v">${punti.round}</span></div>
      <div class="tr-sc"><span class="tr-sc-l">${t("tr_tu")}</span><span class="tr-sc-v">${punti.tu}/${punti.round}</span></div>
      <div class="tr-sc"><span class="tr-sc-l">AI</span><span class="tr-sc-v">${aiTxt}</span></div>
    </div>`;
  }

  // -------- round --------
  function round() {
    const e = ordine[idx % ordine.length];
    const gt = { codice: e.distress.codice, nome: it(e.distress.nome), sev: e.severita, centro: centroide(e.posizione) };
    const userPunti = [];   // {x,y,distress_id,severita}
    let aiPunti = [];       // {x,y,codice,conf}
    let fase = "rispondi";  // rispondi | risolto
    const fatto = { ai: false, sol: false };

    root.innerHTML = `
      ${scoreHtml()}
      <div class="panel tr-card">
        <div class="tr-stage" id="tr-stage">
          <img class="tr-img" src="${storage.url(e.foto_id)}" alt="">
          <div class="tr-markers" id="tr-markers"></div>
        </div>
        <div class="hint mono" id="tr-hint" style="margin-top:8px;color:var(--muted)">${t("tr_hint")}</div>
        <div id="tr-lista" class="tr-lista"></div>
        <div class="tr-azioni">
          <button class="btn" id="tr-undo" title="${t("tr_undo_t")}">${t("tr_undo")}</button>
          <button class="btn" id="tr-ai" title="${t("tr_ai_t")}">${t("tr_sfida")}</button>
          <button class="btn btn-primary" id="tr-sol" title="${t("tr_sol_t")}">${t("tr_sol")}</button>
          <button class="btn" id="tr-next">${t("tr_next")}</button>
          <button class="btn btn-ghost" id="tr-end">${t("tr_termina")}</button>
        </div>
        <div id="tr-esito" hidden></div>
      </div>`;

    const stage = root.querySelector("#tr-stage");
    const layer = root.querySelector("#tr-markers");
    const lista = root.querySelector("#tr-lista");

    function disegnaMarker() {
      let s = "";
      userPunti.forEach((p, i) => { s += `<div class="tr-mk user" style="left:${p.x * 100}%;top:${p.y * 100}%">H${i + 1}</div>`; });
      aiPunti.forEach((p, i) => { s += `<div class="tr-mk ai" style="left:${p.x * 100}%;top:${p.y * 100}%">A${i + 1}</div>`; });
      if (fase === "risolto" && gt.centro) s += `<div class="tr-mk gt" style="left:${gt.centro.x * 100}%;top:${gt.centro.y * 100}%">G</div>`;
      layer.innerHTML = s;
    }
    function disegnaLista() {
      if (!userPunti.length) { lista.innerHTML = `<div class="mono" style="color:var(--muted);font-size:12px">${t("tr_nopunti")}</div>`; return; }
      lista.innerHTML = userPunti.map((p, i) => `
        <div class="tr-row">
          <span class="tr-row-h">H${i + 1}</span>
          <select class="tr-row-d" data-i="${i}" ${fase === "risolto" ? "disabled" : ""}>
            <option value="">${t("tr_distress_opt")}</option>
            ${optgroupsDistress(catalogo, p.distress_id)}
          </select>
        </div>`).join("");
      lista.querySelectorAll(".tr-row-d").forEach((sel) =>
        sel.addEventListener("change", () => { userPunti[Number(sel.dataset.i)].distress_id = sel.value; }));
    }

    stage.addEventListener("click", (ev) => {
      if (fase !== "rispondi") return;
      const r = stage.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      userPunti.push({ x, y, distress_id: "", severita: "" });
      disegnaMarker(); disegnaLista();
    });
    root.querySelector("#tr-undo").addEventListener("click", () => {
      if (fase !== "rispondi" || !userPunti.length) return;
      userPunti.pop(); disegnaMarker(); disegnaLista();
    });
    root.querySelector("#tr-next").addEventListener("click", () => { idx++; round(); });
    root.querySelector("#tr-end").addEventListener("click", start);
    root.querySelector("#tr-ai").addEventListener("click", (ev) => sfidaAI(ev.currentTarget));
    root.querySelector("#tr-sol").addEventListener("click", soluzione);

    disegnaLista();

    // -------- soluzione (valuta operatore) --------
    function soluzione() {
      if (fatto.sol) return;
      fatto.sol = true; fase = "risolto";
      punti.round++;
      const mio = userPunti.find((p) => {
        const d = catalogo.find((c) => c.id === p.distress_id);
        return d && String(d.codice) === String(gt.codice);
      });
      const distressOk = !!mio;
      if (distressOk) punti.tu++;
      root.querySelector(".tr-score").outerHTML = scoreHtml();
      disegnaMarker(); disegnaLista();
      root.querySelector("#tr-hint").textContent = "";

      let posTxt = "";
      if (gt.centro && mio) { const p = precisione(dist(mio, gt.centro)); posTxt = ` · ${t("tr_pos_prec")} ${p}%`; }
      else if (gt.centro && !mio) posTxt = ` · ${t("tr_pos")}: —`;
      else posTxt = ` · ${t("tr_no_pos")}`;

      mostraEsito(`<div class="tr-verdict ${distressOk ? "ok" : "no"}">${t("tr_tu")}: ${distressOk ? t("tr_distr_ok") : t("tr_distr_ko")}</div>
        <div class="tr-truth">${t("tr_sol")}: <b>${gt.codice} · ${gt.nome}${gt.sev ? ` · ${SEVL(gt.sev)}` : ""}</b>${posTxt}</div>`);
      // disabilita i select
      lista.querySelectorAll("select").forEach((s) => s.disabled = true);
    }

    // -------- sfida AI --------
    async function sfidaAI(btn) {
      if (fatto.ai) return;
      btn.disabled = true; const lbl0 = btn.textContent; btn.textContent = t("tr_ai_load");
      try {
        const resp = await fetch(storage.url(e.foto_id));
        const img = await b64(await ridimensiona(await resp.blob(), 1024, 0.8));
        const res = await riconosciDistress({
          image: img, mimeType: "image/jpeg", strato: null,
          catalogo: catalogo.map((d) => ({ codice: d.codice, nome: it(d.nome) })),
        });
        if (res && res.error) {
          mostraEsito(`<div class="tr-aimsg" style="color:#ff8a8a">${res.credito ? t("tr_credito") : t("tr_ai_nd")}</div>`, true);
          btn.disabled = false; btn.textContent = lbl0; return;
        }
        fatto.ai = true;
        const lst = (res && res.distress) || [];
        aiPunti = lst.map((x) => {
          let c = { x: 0.5, y: 0.5 };
          if (Array.isArray(x.box_2d) && x.box_2d.length === 4) {
            const [ymin, xmin, ymax, xmax] = x.box_2d.map(Number);
            c = { x: (xmin + xmax) / 2000, y: (ymin + ymax) / 2000 };
          }
          return { x: c.x, y: c.y, codice: x.codice, conf: x.confidenza };
        });
        const aiOk = lst.some((x) => String(x.codice) === String(gt.codice));
        punti.aiRound++; if (aiOk) punti.ai++;
        root.querySelector(".tr-score").outerHTML = scoreHtml();
        disegnaMarker();
        // scarto di posizione AI rispetto alla verità
        let posAI = "";
        if (gt.centro) {
          const match = aiPunti.find((p) => String(p.codice) === String(gt.codice));
          if (match) posAI = ` · ${t("tr_pos_prec")} ${precisione(dist(match, gt.centro))}%`;
        }
        const nomeDi = (cod) => { const d = catalogo.find((c) => String(c.codice) === String(cod)); return d ? `${cod}·${it(d.nome)}` : cod; };
        const elenco = lst.length ? lst.map((x, i) => `A${i + 1}=${nomeDi(x.codice)}${typeof x.confidenza === "number" ? ` ${Math.round(x.confidenza * 100)}%` : ""}`).join(", ") : t("tr_nulla");
        const diag = res && res.descrizione ? `<div class="tr-diag">✦ ${String(res.descrizione)}</div>` : "";
        mostraEsito(`<div class="tr-aimsg ${aiOk ? "ok" : "no"}">AI: ${aiOk ? t("tr_ai_ok") : t("tr_ai_ko")}${posAI}<br><span class="mono" style="color:var(--muted)">${t("tr_ha_visto")} ${elenco}</span></div>${diag}`, true);
        btn.disabled = true; btn.textContent = t("tr_ai_done");
      } catch (err) {
        mostraEsito(`<div class="tr-aimsg" style="color:#ff8a8a">Errore: ${(err && err.message) || err}</div>`, true);
        btn.disabled = false; btn.textContent = lbl0;
      }
    }

    function mostraEsito(html, append) {
      const box = root.querySelector("#tr-esito");
      box.hidden = false;
      box.innerHTML = append ? box.innerHTML + html : html;
    }
  }

  start();
}

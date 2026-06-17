// =====================================================================
//  Bootstrap dell'app · router a hash, navigazione, i18n, stato rete, SW.
//  Le sezioni qui sono placeholder: la logica arriva nei passi successivi.
// =====================================================================

import { ping, db, suggerisciDistress } from "./db.js";
import { SUPABASE_URL } from "./config.js";
import { renderRilievo } from "./rilievo.js";
import { renderStorico } from "./storico.js";
import { renderStatistiche } from "./statistiche.js";
import { renderCalibrazione } from "./calibrazione.js";
import { renderTraining } from "./training.js";
import { raggruppa, labelGruppo } from "./gruppi.js";
import { t, tx, setLingua, getLang } from "./i18n.js";

const SB_HOST = (() => { try { return new URL(SUPABASE_URL).host; } catch { return SUPABASE_URL; } })();


const UNITA = (k) => (k ? t("unita_" + k) : "");
const STRATI_KEYS = ["drenante_nuovo", "drenante_maturo", "non_drenante", "non_determinabile"];
const STRATO = (k) => (k ? t("strato_" + k) : "");

// ---------- Icone (SVG inline, stroke = currentColor) ----------
const ICON = {
  rilievo: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.2-1.6A1 1 0 0 1 9 5h6a1 1 0 0 1 .8.4L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="12.5" r="3.2"/>',
  storico: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  statistiche: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  training: '<path d="M7 4v6a5 5 0 0 0 10 0V4M5 4h14M9 21h6M12 15v6"/>',
  calibrazione: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  impostazioni: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.5a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.2-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 2 2 0 1 1 0 4z"/>',
};
const svg = (name) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

// ---------- Sezioni (route -> titolo i18n + icona) ----------
const SECTIONS = [
  { id: "rilievo",      icon: "rilievo",      label: "nav_rilievo" },
  { id: "storico",      icon: "storico",      label: "nav_storico" },
  { id: "statistiche",  icon: "statistiche",  label: "nav_statistiche" },
  { id: "training",     icon: "training",     label: "nav_training" },
  { id: "calibrazione", icon: "calibrazione", label: "nav_calibrazione" },
  { id: "impostazioni", icon: "impostazioni", label: "nav_impostazioni" },
];
const DEFAULT = "rilievo";

// ---------- Navigazione ----------
function renderNav() {
  const ul = document.getElementById("navlist");
  ul.innerHTML = SECTIONS.map((s) => `
    <li><a href="#/${s.id}" data-route="${s.id}">
      ${svg(s.icon)}<span class="label">${t(s.label)}</span>
    </a></li>`).join("");
}

// ---------- Render della vista (placeholder per ora) ----------
function renderView(route) {
  const sec = SECTIONS.find((s) => s.id === route) || SECTIONS[0];
  const content = document.getElementById("content");
  const head = `
    <div class="view-head">
      <h1>${t(sec.label)}</h1>
      <span class="tag mono">DistressIQ</span>
      <span class="slogan">SviluPPAta da Sergio Moro</span>
    </div>`;

  if (sec.id === "impostazioni") {
    content.innerHTML = head + impostazioniMarkup() + modelloMarkup() + infoMarkup() + linguaMarkup() + ettometricaMarkup() + catalogoMarkup();
    verificaConnessione();           // prova concreta dello strato dati
    initEttometrica();               // upload CSV progressive
    initLingua();                    // selettore lingua
    initModello();                   // selettore modello AI
    caricaCatalogo();                // lista distress cliccabile
  } else if (sec.id === "rilievo") {
    content.innerHTML = head + `<div id="rilievo-root"></div>`;
    renderRilievo(document.getElementById("rilievo-root"));
  } else if (sec.id === "storico") {
    content.innerHTML = head + `<div id="storico-root"></div>`;
    renderStorico(document.getElementById("storico-root"));
  } else if (sec.id === "statistiche") {
    content.innerHTML = head + `<div id="statistiche-root"></div>`;
    renderStatistiche(document.getElementById("statistiche-root"));
  } else if (sec.id === "calibrazione") {
    content.innerHTML = head + `<div id="calibrazione-root"></div>`;
    renderCalibrazione(document.getElementById("calibrazione-root"));
  } else if (sec.id === "training") {
    content.innerHTML = head + `<div id="training-root"></div>`;
    renderTraining(document.getElementById("training-root"));
  } else {
    content.innerHTML = head + `
      <div class="panel">
        <div class="placeholder">
          <div class="big">${t("in_costruzione")}</div>
          <div class="small">${t("in_costruzione_sub")}</div>
        </div>
      </div>`;
  }

  document.querySelectorAll(".nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.route === sec.id));
  content.scrollTo(0, 0);
}

// Pannello "Connessione" in Impostazioni (verifica reale verso Supabase)
function impostazioniMarkup() {
  return `
    <div class="panel">
      <h2 style="margin:0 0 14px;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">${t("conn_titolo")}</h2>
      <div class="mono" style="font-size:13px;line-height:2">
        <div>URL · <span style="color:var(--accent)">${SB_HOST}</span></div>
        <div>${t("conn_key")}</div>
        <div id="conn-stato">… ${t("conn_verifica")}</div>
      </div>
    </div>`;
}

async function verificaConnessione() {
  const el = document.getElementById("conn-stato");
  if (!el) return;
  try {
    const r = await ping();
    el.innerHTML =
      `<span style="color:var(--ok)">● ${t("conn_ok")}</span> · ${r.distressCount} ${t("conn_catalogo")}`;
  } catch (e) {
    el.innerHTML =
      `<span style="color:#ff6b6b">● ${t("conn_ko")}</span> · ${(e && e.message) ? e.message : e}`;
  }
}

// ---------- Selettore modello AI (standard gratuito / pro a pagamento) ----------
function modelloMarkup() {
  let tier = "standard";
  try { tier = localStorage.getItem("distressiq_model_tier") || "standard"; } catch {}
  const opt = (v, l) => `<button type="button" class="lang-btn${tier === v ? " active" : ""}" data-tier="${v}">${l}</button>`;
  return `
    <div class="panel" style="margin-top:16px">
      <h2 style="margin:0 0 10px;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">${t("imp_modello")}</h2>
      <div class="lang-seg">${opt("standard", t("mod_standard"))}${opt("pro", t("mod_pro"))}</div>
      <div class="mono" style="font-size:12px;color:var(--muted);margin-top:10px">${t("mod_nota")}</div>
    </div>`;
}
function initModello() {
  document.querySelectorAll("[data-tier]").forEach((b) =>
    b.addEventListener("click", () => {
      try { localStorage.setItem("distressiq_model_tier", b.dataset.tier); } catch {}
      document.querySelectorAll("[data-tier]").forEach((x) => x.classList.toggle("active", x === b));
    }));
}

// ---------- Info: come funziona + riferimenti ----------
function infoMarkup() {
  return `
    <div class="panel" style="margin-top:16px">
      <h2 style="margin:0 0 10px;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">${t("info_titolo")}</h2>
      <div class="info-prose" style="font-size:13px;line-height:1.55">${t("info_come")}</div>
      <h3 style="margin:16px 0 6px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">${t("info_rif_titolo")}</h3>
      <div class="info-prose" style="font-size:12.5px;line-height:1.5;color:var(--muted)">${t("info_rif")}</div>
      <div class="hint mono" style="margin-top:10px">${t("info_nota")}</div>
    </div>`;
}

// ---------- Selettore lingua ----------
function linguaMarkup() {
  const opt = (v, l) => `<button type="button" class="lang-btn${getLang() === v ? " active" : ""}" data-lang="${v}">${l}</button>`;
  return `
    <div class="panel" style="margin-top:16px">
      <h2 style="margin:0 0 10px;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">${t("imp_lingua")}</h2>
      <div class="lang-seg">${opt("it", "Italiano")}${opt("en", "English")}${opt("es", "Español")}</div>
      <div class="mono" style="font-size:12px;color:var(--muted);margin-top:10px">${t("imp_lingua_nota")}</div>
    </div>`;
}
function initLingua() {
  document.querySelectorAll("[data-lang]").forEach((b) =>
    b.addEventListener("click", () => setLang(b.dataset.lang)));
}

// ---------- Dati ettometrici (progressive): upload CSV ----------
function ettometricaMarkup() {
  return `
    <div class="panel" style="margin-top:16px">
      <h2 style="margin:0 0 6px;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">${t("imp_etto_titolo")}</h2>
      <div class="mono" style="font-size:12px;color:var(--muted);margin-bottom:12px">${t("imp_etto_desc")}</div>
      <div id="etto-stato" class="mono" style="font-size:13px;color:var(--muted);margin-bottom:12px">…</div>
      <input type="file" id="etto-file" accept=".csv,text/csv" hidden>
      <button class="btn" id="etto-pick">${t("imp_etto_pick")}</button>
      <span class="hint mono" id="etto-pre" style="margin-left:10px"></span>
      <div style="margin-top:12px">
        <button class="btn btn-primary" id="etto-carica" disabled>${t("imp_etto_carica")}</button>
        <span class="hint mono" id="etto-msg" style="margin-left:10px"></span>
      </div>
    </div>`;
}
function progDaTesto(s) {
  if (!s) return null;
  s = String(s).trim();
  if (s.includes("+")) { const [km, m] = s.split("+"); const k = parseInt(km, 10), mm = parseInt(m, 10); return (isNaN(k) || isNaN(mm)) ? null : k * 1000 + mm; }
  const n = parseInt(s, 10); return isNaN(n) ? null : n;
}
function parseEtto(testo) {
  const out = [];
  testo.split(/\r?\n/).forEach((riga) => {
    if (!riga.trim()) return;
    const c = riga.split(";");
    if (c.length < 4) return;
    const lat = parseFloat(c[0]), lon = parseFloat(c[1]);
    const strada = (c[2] || "").trim().toUpperCase();
    const prog = progDaTesto(c[3]);
    if (isNaN(lat) || isNaN(lon) || !strada || prog == null) return; // salta intestazione e righe non valide
    out.push({ strada, progressiva_m: prog, lat, lon });
  });
  return out;
}
async function initEttometrica() {
  const stato = document.getElementById("etto-stato");
  if (!stato) return;
  const file = document.getElementById("etto-file");
  const pick = document.getElementById("etto-pick");
  const pre = document.getElementById("etto-pre");
  const carica = document.getElementById("etto-carica");
  const msg = document.getElementById("etto-msg");
  try { const n = await db.ettometriche.count(); stato.textContent = n ? `${n} ${t("imp_etto_punti")} ${t("imp_etto_caricati")}` : t("imp_etto_vuoto"); }
  catch { stato.textContent = t("imp_etto_stato_ko"); }

  let righe = null;
  pick.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      righe = parseEtto(String(reader.result));
      if (!righe.length) { pre.textContent = t("imp_etto_norighe"); carica.disabled = true; return; }
      const a4 = righe.filter((r) => r.strada === "A4").length, a31 = righe.filter((r) => r.strada === "A31").length;
      pre.textContent = `${righe.length} ${t("imp_etto_punti")} (A4: ${a4}, A31: ${a31}) ${t("imp_etto_pronti")}`;
      carica.disabled = false;
    };
    reader.readAsText(f);
  });
  carica.addEventListener("click", async () => {
    if (!righe || !righe.length) return;
    carica.disabled = true; msg.style.color = "var(--muted)"; msg.textContent = t("imp_etto_svuoto");
    try {
      await db.ettometriche.clear();
      const BATCH = 500;
      for (let i = 0; i < righe.length; i += BATCH) {
        msg.textContent = `${t("imp_etto_carico")} ${Math.min(i + BATCH, righe.length)}/${righe.length}…`;
        await db.ettometriche.insertMany(righe.slice(i, i + BATCH));
      }
      msg.style.color = "var(--ok)"; msg.textContent = `${t("imp_etto_fatto")} ${righe.length} ${t("imp_etto_punti")} ${t("imp_etto_caricati")}`;
      stato.textContent = `${righe.length} ${t("imp_etto_punti")} ${t("imp_etto_caricati")}`;
    } catch (e) {
      msg.style.color = "#ff8a8a"; msg.textContent = (t("ril_errore") + ": ") + ((e && e.message) ? e.message : e);
      carica.disabled = false;
    }
  });
}

// ---------- Catalogo distress: lista cliccabile + pop-up ----------
let CATALOGO = [];

function catalogoMarkup() {
  return `
    <div class="panel" style="margin-top:16px">
      <div class="cat-head">
        <h2 style="margin:0;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">${t("catalogo_titolo")}</h2>
        <button class="btn" id="cat-nuovo">${t("cat_nuovo")}</button>
      </div>
      <div class="mono" style="font-size:12px;color:var(--muted);margin:6px 0 14px">${t("cat_suggerimento")}</div>
      <div id="cat-list" class="cat-list mono" style="color:var(--muted)">${t("cat_caricamento")}</div>
    </div>`;
}

async function caricaCatalogo() {
  const nuovoBtn = document.getElementById("cat-nuovo");
  if (nuovoBtn) nuovoBtn.onclick = apriFormNuovo;
  const box = document.getElementById("cat-list");
  if (!box) return;
  try {
    CATALOGO = await db.distress.listAll();
    if (!CATALOGO.length) { box.innerHTML = t("cat_vuoto"); return; }
    box.style.color = "var(--text)";
    const itemHtml = (d) => {
      const badges =
        (d.personalizzato ? `<span class="badge custom">${t("badge_custom")}</span>` : "") +
        (!d.attivo ? `<span class="badge off">${t("badge_off")}</span>` : "");
      return `
        <button class="cat-item${d.attivo ? "" : " is-off"}" data-id="${d.id}">
          <span class="cod">${d.codice ?? "—"}</span>
          <span class="nm">${tx(d.nome)}</span>
          <span class="cat-badges">${badges}</span>
          <span class="meta">${UNITA(d.unita_misura) || d.unita_misura || ""}</span>
        </button>`;
    };
    box.innerHTML = raggruppa(CATALOGO).map((g) =>
      `<div class="cat-gruppo">${labelGruppo(g.key)}</div>` + g.items.map(itemHtml).join("")
    ).join("");
    box.querySelectorAll(".cat-item").forEach((b) =>
      b.addEventListener("click", () => apriDettaglio(b.dataset.id)));
  } catch (e) {
    box.innerHTML = `${t("cat_errore")}: ${(e && e.message) ? e.message : e}`;
  }
}

function apriDettaglio(id) {
  const d = CATALOGO.find((x) => x.id === id);
  if (!d) return;
  const campo = (k, v) => v ? `<div class="m-field"><div class="k">${k}</div><div class="v">${v}</div></div>` : "";
  const appl = (d.applicabilita || []).map((s) => STRATO(s) || s).join(" · ");
  const sev = d.ha_severita ? t("sev_si") : t("sev_no");

  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="m-head">
        <h3>${tx(d.nome)}</h3>
        <button class="m-close" aria-label="${t("chiudi")}">×</button>
      </div>
      <div class="m-body">
        <div class="m-meta">
          <span>${t("lbl_codice")}: ${d.codice ?? "—"}</span>
          <span>${t("lbl_unita")}: ${UNITA(d.unita_misura) || d.unita_misura || "—"}</span>
          <span>${t("lbl_severita")}: ${sev}</span>
        </div>
        ${campo(t("lbl_applicabilita"), appl)}
        ${campo(t("lbl_descrizione"), tx(d.descrizione))}
        ${campo(t("lbl_cause"), tx(d.cause))}
        ${campo(t("lbl_soluzioni"), tx(d.soluzioni))}
      </div>
      <div class="m-foot">
        <div class="mono" style="font-size:12px;color:var(--muted)">${t("lbl_stato")}:
          <span style="color:${d.attivo ? "var(--accent)" : "#ff8a8a"}">${d.attivo ? t("stato_attivo") : t("stato_off")}</span>
        </div>
        <button class="btn" id="d-toggle">${d.attivo ? t("tog_disattiva") : t("tog_attiva")}</button>
      </div>
    </div>`;

  const chiudi = () => { document.removeEventListener("keydown", onEsc); ov.remove(); };
  const onEsc = (e) => { if (e.key === "Escape") chiudi(); };
  ov.addEventListener("click", (e) => { if (e.target === ov) chiudi(); });
  ov.querySelector(".m-close").addEventListener("click", chiudi);
  const tog = ov.querySelector("#d-toggle");
  if (tog) tog.addEventListener("click", async () => {
    tog.disabled = true;
    try {
      await db.distress.update(d.id, { attivo: !d.attivo });
      chiudi();
      caricaCatalogo();
    } catch (e) {
      tog.disabled = false;
      alert(`${t("nf_errore")}: ${(e && e.message) ? e.message : e}`);
    }
  });
  document.addEventListener("keydown", onEsc);
  document.body.appendChild(ov);
}

// ---------- Nuovo distress personalizzato ----------
function prossimoCodiceCustom() {
  let max = 0;
  CATALOGO.forEach((d) => {
    const m = /^C(\d+)$/.exec(d.codice || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "C" + (max + 1);
}

function apriFormNuovo() {
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  const strati = STRATI_KEYS
    .map((k) => `<label class="chk"><input type="checkbox" value="${k}" checked> ${t("strato_" + k)}</label>`)
    .join("");
  ov.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="m-head">
        <h3>${t("nf_titolo")}</h3>
        <button class="m-close" aria-label="${t("chiudi")}">×</button>
      </div>
      <div class="m-body">
        <div class="form-grid">
          <div class="field"><label>${t("nf_codice")}</label><input id="nf-codice" value="${prossimoCodiceCustom()}"></div>
          <div class="field"><label>${t("nf_unita")}</label>
            <select id="nf-unita">
              <option value="m2">${t("unita_m2")}</option>
              <option value="m">${t("unita_m")}</option>
              <option value="conteggio">${t("unita_conteggio")}</option>
            </select>
          </div>
        </div>
        <div class="field" style="margin-top:14px"><label>${t("nf_nome")}</label><input id="nf-nome" placeholder="${t("nf_nome_ph")}"></div>
        <div class="nf-ai-row">
          <button class="btn" id="nf-ai">${t("nf_ai")}</button>
          <span class="hint mono" id="nf-ai-stato"></span>
        </div>
        <div class="field" style="margin-top:14px">
          <label>${t("nf_applicabilita")}</label>
          <div class="chk-grid">${strati}</div>
        </div>
        <label class="chk" style="margin-top:14px"><input type="checkbox" id="nf-sev" checked> ${t("nf_severita")}</label>
        <div class="field" style="margin-top:14px"><label>${t("nf_descrizione")}</label><textarea id="nf-desc" rows="2"></textarea></div>
        <div class="field" style="margin-top:14px"><label>${t("nf_cause")}</label><textarea id="nf-cause" rows="2"></textarea></div>
        <div class="field" style="margin-top:14px"><label>${t("nf_soluzioni")}</label><textarea id="nf-sol" rows="2"></textarea></div>
      </div>
      <div class="m-foot">
        <div class="hint mono" id="nf-err" style="color:#ff8a8a"></div>
        <div class="m-actions">
          <button class="btn" id="nf-annulla">${t("nf_annulla")}</button>
          <button class="btn btn-primary" id="nf-salva">${t("nf_salva")}</button>
        </div>
      </div>
    </div>`;

  const chiudi = () => { document.removeEventListener("keydown", onEsc); ov.remove(); };
  const onEsc = (e) => { if (e.key === "Escape") chiudi(); };
  ov.addEventListener("click", (e) => { if (e.target === ov) chiudi(); });
  ov.querySelector(".m-close").addEventListener("click", chiudi);
  ov.querySelector("#nf-annulla").addEventListener("click", chiudi);
  document.addEventListener("keydown", onEsc);

  const aiBtn = ov.querySelector("#nf-ai");
  const aiStato = ov.querySelector("#nf-ai-stato");
  aiBtn.addEventListener("click", async () => {
    const nome = ov.querySelector("#nf-nome").value.trim();
    aiStato.style.color = "var(--muted)";
    if (!nome) { aiStato.style.color = "#ff8a8a"; aiStato.textContent = t("nf_ai_nome"); return; }
    aiBtn.disabled = true;
    aiStato.textContent = t("nf_ai_lavoro");
    try {
      const r = await suggerisciDistress({ nome, unita_misura: ov.querySelector("#nf-unita").value });
      if (r && r.error) throw new Error(r.error);
      if (r && r.descrizione) ov.querySelector("#nf-desc").value = r.descrizione;
      if (r && r.cause) ov.querySelector("#nf-cause").value = r.cause;
      if (r && r.soluzioni) ov.querySelector("#nf-sol").value = r.soluzioni;
      aiStato.textContent = "";
    } catch (e) {
      aiStato.style.color = "#ff8a8a";
      aiStato.textContent = `${t("nf_ai_errore")}: ${(e && e.message) ? e.message : e}`;
    } finally {
      aiBtn.disabled = false;
    }
  });

  const err = ov.querySelector("#nf-err");
  const salva = ov.querySelector("#nf-salva");
  salva.addEventListener("click", async () => {
    err.textContent = "";
    const codice = ov.querySelector("#nf-codice").value.trim();
    const nome = ov.querySelector("#nf-nome").value.trim();
    if (!nome) { err.textContent = t("nf_nome_obbl"); return; }
    if (codice && CATALOGO.some((d) => (d.codice || "").toLowerCase() === codice.toLowerCase())) {
      err.textContent = t("nf_cod_dup"); return;
    }
    const appl = Array.from(ov.querySelectorAll(".chk-grid input:checked")).map((i) => i.value);
    const jb = (s) => { const v = s.trim(); return v ? { it: v } : null; };
    const payload = {
      codice: codice || null,
      nome: { it: nome },
      descrizione: jb(ov.querySelector("#nf-desc").value),
      cause: jb(ov.querySelector("#nf-cause").value),
      soluzioni: jb(ov.querySelector("#nf-sol").value),
      applicabilita: appl,
      unita_misura: ov.querySelector("#nf-unita").value,
      ha_severita: ov.querySelector("#nf-sev").checked,
      personalizzato: true,
      attivo: true,
    };
    salva.disabled = true;
    salva.textContent = t("nf_salvataggio");
    try {
      await db.distress.create(payload);
      chiudi();
      caricaCatalogo();
    } catch (e) {
      salva.disabled = false;
      salva.textContent = t("nf_salva");
      err.textContent = `${t("nf_errore")}: ${(e && e.message) ? e.message : e}`;
    }
  });

  document.body.appendChild(ov);
  ov.querySelector("#nf-nome").focus();
}

// ---------- Router a hash (compatibile GitHub Pages / sottocartelle) ----------
function currentRoute() {
  const r = (location.hash || "").replace(/^#\/?/, "");
  return SECTIONS.some((s) => s.id === r) ? r : DEFAULT;
}
function navigate() { renderView(currentRoute()); }
function setLang(l) {
  if (l === getLang()) return;
  setLingua(l);
  renderNav(); updateStatus(); navigate();
}
window.addEventListener("hashchange", navigate);

// ---------- Stato rete ----------
function updateStatus() {
  const el = document.getElementById("status");
  const lbl = document.getElementById("status-label");
  const on = navigator.onLine;
  el.classList.toggle("online", on);
  lbl.textContent = t(on ? "status_online" : "status_offline");
}
window.addEventListener("online", updateStatus);
window.addEventListener("offline", updateStatus);

// ---------- Avvio ----------
renderNav();
if (!location.hash) location.replace(`#/${DEFAULT}`);
navigate();
updateStatus();

// ---------- Service worker (offline-first) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("./sw.js").catch((e) =>
      console.warn("SW non registrato:", e)));
}

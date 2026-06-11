// =====================================================================
//  Sezione STATISTICHE: dashboard degli aggregati dello Storico.
//  Donut (SVG) per fasce/gravità/origine + barre colorate. Nessuna libreria.
// =====================================================================

import { db } from "./db.js";
import { calcolaIQ, FASCE } from "./iq.js";

const STRATO = {
  drenante_nuovo: "Drenante nuovo",
  drenante_maturo: "Drenante maturo",
  non_drenante: "Non drenante",
  non_determinabile: "Non determinabile",
};
const SEVL = { bassa: "Bassa", media: "Media", alta: "Alta", nessuna: "Nessuna" };

const FASCIA_COLORE = { ottimo: "#38c172", buono: "#8bd450", discreto: "#ffc400", scarso: "#ff8c1a", critico: "#e5484d" };
const GRAVITA_COLORE = { bassa: "#38c172", media: "#ff8c1a", alta: "#e5484d", nessuna: "#6b7280" };
const ORIGINE_COLORE = { operatore: "#2d7ff9", ai: "#a855f7" };
const STRADA_COLORE = { A4: "#ffc400", A31: "#2d7ff9" };
const PALETTE = ["#ffc400", "#2d7ff9", "#38c172", "#a855f7", "#ff8c1a", "#e5484d", "#14b8a6", "#f472b6", "#8bd450", "#60a5fa", "#fbbf24", "#f87171"];

function aggrega(rilievi) {
  const s = {
    nRilievi: rilievi.length, conFoto: 0, distressTot: 0,
    perTipo: {}, perGravita: { bassa: 0, media: 0, alta: 0, nessuna: 0 },
    perStrada: {}, perStrato: {}, perOrigine: { operatore: 0, ai: 0 }, perMese: {},
    iqSum: 0, iqCount: 0, perFascia: {},
  };
  rilievi.forEach((r) => {
    if (r.foto_id) s.conFoto++;
    if (r.strada) s.perStrada[r.strada] = (s.perStrada[r.strada] || 0) + 1;
    if (r.strato) s.perStrato[r.strato] = (s.perStrato[r.strato] || 0) + 1;
    const mese = (r.created_at || "").slice(0, 7);
    if (mese) s.perMese[mese] = (s.perMese[mese] || 0) + 1;
    const items = (r.rilievo_distress || []).map((x) => ({
      severita: x.severita, estensione_valore: x.estensione_valore,
      estensione_unita: x.estensione_unita || (x.distress && x.distress.unita_misura),
      deduct_params: x.distress && x.distress.deduct_params,
      ha_severita: x.distress && x.distress.ha_severita,
    }));
    const ris = calcolaIQ(items);
    s.iqSum += ris.iq; s.iqCount++;
    s.perFascia[ris.fasciaKey] = (s.perFascia[ris.fasciaKey] || 0) + 1;
    (r.rilievo_distress || []).forEach((d) => {
      s.distressTot++;
      const cod = d.distress ? d.distress.codice : "?";
      const nome = d.distress && d.distress.nome ? (d.distress.nome.it || "") : "";
      if (!s.perTipo[cod]) s.perTipo[cod] = { etichetta: `${cod}·${nome}`, n: 0 };
      s.perTipo[cod].n++;
      s.perGravita[d.severita || "nessuna"] = (s.perGravita[d.severita || "nessuna"] || 0) + 1;
      if (d.origine) s.perOrigine[d.origine] = (s.perOrigine[d.origine] || 0) + 1;
    });
  });
  return s;
}

function kpi(s) {
  const aiPct = s.distressTot ? Math.round((s.perOrigine.ai / s.distressTot) * 100) : 0;
  const iqMedio = s.iqCount ? Math.round(s.iqSum / s.iqCount) : "—";
  const cards = [
    ["Rilievi", s.nRilievi],
    ["IQ medio", iqMedio],
    ["Distress totali", s.distressTot],
    ["Con foto", s.conFoto],
    ["Distress da AI", `${s.perOrigine.ai} · ${aiPct}%`],
  ];
  return `<div class="kpi-grid">` + cards.map(([l, v]) =>
    `<div class="kpi"><div class="kpi-val mono">${v}</div><div class="kpi-lbl">${l}</div></div>`).join("") + `</div>`;
}

function donut(segments) {
  const total = segments.reduce((a, b) => a + b.value, 0);
  if (!total) return `<div class="hint mono" style="color:var(--muted)">nessun dato</div>`;
  const r = 50, cx = 60, cy = 60, w = 18, C = 2 * Math.PI * r;
  let off = 0;
  const arcs = segments.map((g) => {
    const len = g.value / total * C;
    const c = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="${g.color}" stroke-width="${w}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    off += len; return c;
  }).join("");
  const leg = segments.map((g) =>
    `<div class="leg-row"><span class="leg-dot" style="background:${g.color}"></span><span class="leg-lbl">${g.label}</span><span class="leg-val mono">${g.value} · ${Math.round(g.value / total * 100)}%</span></div>`).join("");
  return `<div class="donut-wrap">
    <svg viewBox="0 0 120 120" class="donut"><circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="var(--line)" stroke-width="${w}"/>${arcs}<text x="60" y="58" class="donut-tot">${total}</text><text x="60" y="74" class="donut-sub">totale</text></svg>
    <div class="donut-leg">${leg}</div>
  </div>`;
}

function barsColored(entries) {
  if (!entries.length) return `<div class="hint mono" style="color:var(--muted)">nessun dato</div>`;
  const max = Math.max(...entries.map((e) => e.value), 1);
  return `<div class="bars">` + entries.map((e) => `
    <div class="bar-row">
      <div class="bar-label" title="${e.label}">${e.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((e.value / max) * 100)}%;background:${e.color || "var(--accent)"}"></div></div>
      <div class="bar-val mono">${e.value}</div>
    </div>`).join("") + `</div>`;
}

function card(title, inner, full) {
  return `<div class="dash-card${full ? " dash-full" : ""}"><div class="dash-h">${title}</div>${inner}</div>`;
}

export async function renderStatistiche(root) {
  root.innerHTML = `<div class="panel"><div class="mono" style="color:var(--muted)">caricamento…</div></div>`;
  let rilievi;
  try { rilievi = await db.rilievi.listConDistress(); }
  catch (e) { root.innerHTML = `<div class="panel mono" style="color:#ff8a8a">Errore: ${(e && e.message) || e}</div>`; return; }

  if (!rilievi.length) {
    root.innerHTML = `<div class="panel"><div class="placeholder">
      <div class="big">Nessun dato</div>
      <div class="small">Crea qualche rilievo per vedere le statistiche.</div></div></div>`;
    return;
  }

  const s = aggrega(rilievi);

  const fasciaSeg = FASCE.filter((f) => s.perFascia[f.key]).map((f) => ({ label: f.label, value: s.perFascia[f.key], color: FASCIA_COLORE[f.key] || "#888" }));
  const gravitaSeg = ["bassa", "media", "alta", "nessuna"].filter((k) => s.perGravita[k]).map((k) => ({ label: SEVL[k], value: s.perGravita[k], color: GRAVITA_COLORE[k] }));
  const origineSeg = [
    { label: "Operatore", value: s.perOrigine.operatore || 0, color: ORIGINE_COLORE.operatore },
    { label: "AI", value: s.perOrigine.ai || 0, color: ORIGINE_COLORE.ai },
  ].filter((e) => e.value);

  const tipoEntries = Object.values(s.perTipo).sort((a, b) => b.n - a.n).slice(0, 12)
    .map((t, i) => ({ label: t.etichetta, value: t.n, color: PALETTE[i % PALETTE.length] }));
  const stradaEntries = Object.entries(s.perStrada).map(([k, v], i) => ({ label: k, value: v, color: STRADA_COLORE[k] || PALETTE[i % PALETTE.length] }));
  const stratoEntries = Object.entries(s.perStrato).map(([k, v], i) => ({ label: STRATO[k] || k, value: v, color: PALETTE[(i + 2) % PALETTE.length] }));
  const meseEntries = Object.keys(s.perMese).sort().map((m) => {
    const [y, mo] = m.split("-");
    return { label: `${mo}/${y.slice(2)}`, value: s.perMese[m], color: "#6db3ff" };
  });

  root.innerHTML =
    kpi(s) +
    `<div class="dash-grid">` +
    card("IQ per fascia", donut(fasciaSeg)) +
    card("Gravità", donut(gravitaSeg)) +
    card("Origine dei distress", donut(origineSeg)) +
    card("Distress per tipo", barsColored(tipoEntries), true) +
    card("Rilievi per strada", barsColored(stradaEntries)) +
    card("Rilievi per strato", barsColored(stratoEntries)) +
    card("Rilievi per mese", barsColored(meseEntries), true) +
    `</div>`;
}

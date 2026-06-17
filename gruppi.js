// =====================================================================
//  Raggruppamento LTPP del catalogo distress (lato codice, nessuna
//  migrazione DB). Ordine e separatori per: Fessurazione, Riparazioni e
//  buche, Deformazioni superficiali, Difetti superficiali, Varie,
//  Personalizzati. Usato da catalogo e da tutti i menù a tendina.
// =====================================================================

import { t, tx } from "./i18n.js";

export function labelGruppo(key) { return t("gruppo_" + key); }

export const GRUPPI = [
  { key: "fessurazione",  label: "Fessurazione" },
  { key: "riparazioni",   label: "Riparazioni e buche" },
  { key: "deformazioni",  label: "Deformazioni superficiali" },
  { key: "difetti",       label: "Difetti superficiali" },
  { key: "varie",         label: "Varie" },
  { key: "personalizzati", label: "Personalizzati" },
];

// mappa codice -> gruppo (i distress seminati)
const MAPPA = {
  "1": "fessurazione", "3": "fessurazione", "7": "fessurazione", "8": "fessurazione", "10": "fessurazione", "17": "fessurazione",
  "11": "riparazioni", "13": "riparazioni",
  "4": "deformazioni", "5": "deformazioni", "6": "deformazioni", "15": "deformazioni", "16": "deformazioni", "18": "deformazioni",
  "2": "difetti", "12": "difetti", "19": "difetti", "C1": "difetti",
  "9": "varie", "C2": "varie",
};

// codici da non mostrare nel catalogo né nei menù (rimossi dall'uso)
const ESCLUSI = new Set(["14"]);

export function gruppoDi(d) {
  return MAPPA[d.codice] || (d.personalizzato ? "personalizzati" : "varie");
}

const numKey = (c) => { const n = parseInt(c, 10); return isNaN(n) ? 9999 : n; };

// restituisce [{key,label,items:[...]}] in ordine, solo gruppi non vuoti
export function raggruppa(catalogo) {
  const byKey = {};
  (catalogo || []).filter((d) => !ESCLUSI.has(d.codice)).forEach((d) => { const k = gruppoDi(d); (byKey[k] || (byKey[k] = [])).push(d); });
  return GRUPPI
    .map((g) => ({ ...g, items: (byKey[g.key] || []).sort((a, b) => numKey(a.codice) - numKey(b.codice) || String(a.codice).localeCompare(String(b.codice))) }))
    .filter((g) => g.items.length);
}

// <optgroup> per i <select> di scelta distress
export function optgroupsDistress(catalogo, selectedId) {
  return raggruppa(catalogo).map((g) =>
    `<optgroup label="${labelGruppo(g.key)}">` +
    g.items.map((d) => `<option value="${d.id}"${selectedId === d.id ? " selected" : ""}>${d.codice}·${tx(d.nome) || ""}</option>`).join("") +
    `</optgroup>`
  ).join("");
}

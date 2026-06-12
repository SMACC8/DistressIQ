// =====================================================================
//  Motore IQ — Indice di Qualità (0-100), ispirato al PCI (ASTM D6433),
//  adattato alle pavimentazioni drenanti. È una stima PCI-like:
//   1) per ogni distress si stima la densità% (estensione vs area di rif.);
//   2) si interpola il "deduct" sulla curva del distress (deduct_params);
//   3) si combinano i deduct con pesi decrescenti -> CDV;
//   4) IQ = 100 - CDV.
//  Le costanti qui sotto sono TARABILI: sono il punto di calibrazione.
// =====================================================================

const AREA_RIF_M2 = 10;     // area nominale inquadrata in una foto (m²)
const LUNGH_RIF_M = 4;      // lunghezza nominale (m) per distress lineari: ~lato di un riquadro di 10 m²
const PESO_CONTEGGIO = 10;  // ogni elemento conteggiato ≈ 10% di densità
// densità usata quando l'estensione non è stata misurata (tipico per l'AI)
const DENSITA_DEFAULT = { bassa: 5, media: 20, alta: 50, unica: 20 };
// combinazione PCI-like: il primo deduct pesa pieno, gli altri sempre meno
const PESI_CDV = [1, 0.45, 0.35, 0.25, 0.15, 0.1];

import { t } from "./i18n.js";

export const labelFascia = (key) => t("fascia_" + key);

export const FASCE = [
  { key: "ottimo",   label: "Ottimo",   min: 90 },
  { key: "buono",    label: "Buono",    min: 78 },
  { key: "discreto", label: "Discreto", min: 64 },
  { key: "scarso",   label: "Scarso",   min: 50 },
  { key: "critico",  label: "Critico",  min: 0  },
];

export function fasciaDi(iq) {
  if (iq == null || isNaN(iq)) return null;
  return FASCE.find((f) => iq >= f.min) || FASCE[FASCE.length - 1];
}

// interpolazione lineare sulla curva [[densità, deduct], ...], con origine (0,0)
function interp(punti, x) {
  if (!Array.isArray(punti) || !punti.length) return 0;
  const pts = [[0, 0], ...punti];
  if (x <= 0) return 0;
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1]; // oltre l'ultimo punto: si satura al deduct massimo
}

function densita(item) {
  const haSev = !!item.ha_severita;
  const sevKey = haSev ? (item.severita || "media") : "unica";
  const v = item.estensione_valore;
  if (v == null || isNaN(v)) return DENSITA_DEFAULT[sevKey] != null ? DENSITA_DEFAULT[sevKey] : 20;
  const u = item.estensione_unita;
  let d;
  if (u === "m2") d = (v / AREA_RIF_M2) * 100;
  else if (u === "m") d = (v / LUNGH_RIF_M) * 100;
  else if (u === "conteggio") d = v * PESO_CONTEGGIO;
  else d = v;
  return Math.max(0, Math.min(100, d));
}

function deductDi(item) {
  const dp = item.deduct_params;
  if (!dp || typeof dp !== "object") {
    const base = { bassa: 10, media: 25, alta: 45 };
    return item.ha_severita ? (base[item.severita] != null ? base[item.severita] : 25) : 15;
  }
  const curva = item.ha_severita
    ? (dp[item.severita] || dp.media || dp.unica)
    : (dp.unica || dp.media);
  return Math.max(0, Math.min(100, interp(curva, densita(item))));
}

// items: [{ severita, estensione_valore, estensione_unita, deduct_params, ha_severita }]
export function calcolaIQ(items) {
  const deducts = (items || []).map(deductDi).filter((d) => d > 0).sort((a, b) => b - a);
  if (!deducts.length) {
    const f = fasciaDi(100);
    return { iq: 100, fascia: labelFascia(f.key), fasciaKey: f.key };
  }
  let cdv = 0;
  deducts.forEach((d, i) => { cdv += d * (PESI_CDV[i] != null ? PESI_CDV[i] : 0.05); });
  cdv = Math.min(100, cdv);
  const iq = Math.max(0, Math.round(100 - cdv));
  const f = fasciaDi(iq);
  return { iq, fascia: labelFascia(f.key), fasciaKey: f.key };
}

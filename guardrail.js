// =====================================================================
//  Freno di sicurezza per le chiamate AI (circuit breaker lato client).
//  Scopo: evitare "tempeste" di richieste (un loop/bug nell'app) che
//  brucerebbero credito Gemini in pochi secondi.
//
//  IMPORTANTE — leggere senza pietà:
//   • Questo ferma lo scenario REALISTICO: l'app che, per un bug, spara
//     molte chiamate ravvicinate. Tutte le chiamate AI passano da qui,
//     quindi il loop viene bloccato.
//   • NON è una barriera di sicurezza assoluta: vive nel browser, quindi
//     non protegge da usi fuori dall'app. Il tetto VERO va messo su
//     Google Cloud (budget alert + quota massima). Questo è il cinturone;
//     il budget cap su Cloud è l'airbag.
//
//  Conta in modo cumulativo riconoscimento + suggerimenti (stesso credito).
// =====================================================================
import { t } from "./i18n.js";

// --- Limiti TARABILI ---
const MIN_INTERVALLO_MS = 1500;                      // tra due chiamate consecutive
const BURST_MAX = 8,    BURST_MS  = 60 * 1000;       // max 8 al minuto
const MEDIA_MAX = 30,   MEDIA_MS  = 10 * 60 * 1000;  // max 30 in 10 minuti
const GIORNO_MAX = 250, GIORNO_MS = 24 * 3600 * 1000; // max 250 al giorno

const CHIAVE = "distressiq_ai_calls";

function leggi(ora) {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(CHIAVE) || "[]"); } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  return arr.filter((x) => typeof x === "number" && ora - x < GIORNO_MS); // tieni 24h
}
function salva(arr) { try { localStorage.setItem(CHIAVE, JSON.stringify(arr)); } catch {} }
function conta(arr, ora, finestra) { return arr.filter((x) => ora - x < finestra).length; }

function attesaTesto(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)} min`;
}

// Da invocare PRIMA di ogni chiamata AI. Lancia un errore (con messaggio
// tradotto) se un limite è superato; altrimenti registra la chiamata.
export function guardAI() {
  const ora = Date.now();
  const arr = leggi(ora);
  const ultimo = arr.length ? arr[arr.length - 1] : 0;

  if (ultimo && ora - ultimo < MIN_INTERVALLO_MS) {
    throw new Error(t("guard_rapide"));
  }

  let attesa = 0;
  if (conta(arr, ora, BURST_MS)  >= BURST_MAX)  attesa = Math.max(attesa, BURST_MS  - (ora - arr[arr.length - BURST_MAX]));
  if (conta(arr, ora, MEDIA_MS)  >= MEDIA_MAX)  attesa = Math.max(attesa, MEDIA_MS  - (ora - arr[arr.length - MEDIA_MAX]));
  if (arr.length                 >= GIORNO_MAX) attesa = Math.max(attesa, GIORNO_MS - (ora - arr[arr.length - GIORNO_MAX]));

  if (attesa > 0) {
    throw new Error(t("guard_limite").replace("{t}", attesaTesto(attesa)));
  }

  arr.push(ora);
  salva(arr);
}

// Quante chiamate nelle ultime 24h (per eventuale indicatore in UI).
export function contatoreAI() {
  return leggi(Date.now()).length;
}

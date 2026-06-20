// =====================================================================
//  Strato dati · unico punto di contatto con Supabase.
//  Le sezioni dell'app NON parlano mai direttamente con supabase: usano `db`.
//  Così domani possiamo cambiare/estendere il backend senza toccare le viste.
// =====================================================================

import { createClient } from "./vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { guardAI } from "./guardrail.js";
import { getLang } from "./i18n.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Verifica connessione: conta le righe del catalogo distress (head = nessun dato scaricato).
export async function ping() {
  const { count, error } = await supabase
    .from("distress")
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  return { ok: true, distressCount: count ?? 0 };
}

// ---------- Accesso dati (lo estenderemo sezione per sezione) ----------
export const db = {
  distress: {
    list: async () => {
      const { data, error } = await supabase
        .from("distress").select("*").eq("attivo", true).order("codice");
      if (error) throw error;
      return data;
    },
    // tutte le voci (anche disattivate), in ordine di inserimento — per la gestione in Impostazioni
    listAll: async () => {
      const { data, error } = await supabase
        .from("distress").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
    create: async (d) => {
      const { data, error } = await supabase.from("distress").insert(d).select().single();
      if (error) throw error;
      return data;
    },
    update: async (id, patch) => {
      const { data, error } = await supabase
        .from("distress").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
  },

  rilievi: {
    list: async () => {
      const { data, error } = await supabase
        .from("rilievo").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    create: async (rilievo) => {
      const { data, error } = await supabase
        .from("rilievo").insert(rilievo).select().single();
      if (error) throw error;
      return data;
    },
    update: async (id, patch) => {
      const { data, error } = await supabase
        .from("rilievo").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    // inserisce il rilievo e i distress collegati (operatore/AI)
    createConDistress: async (rilievo, distressList) => {
      const { data: r, error } = await supabase
        .from("rilievo").insert(rilievo).select().single();
      if (error) throw error;
      if (distressList && distressList.length) {
        const rows = distressList.map((d) => ({ ...d, rilievo_id: r.id }));
        const { error: e2 } = await supabase.from("rilievo_distress").insert(rows);
        if (e2) throw e2;
      }
      return r;
    },
    // distress collegati a un rilievo (per lo Storico/dettaglio)
    distressDi: async (rilievoId) => {
      const { data, error } = await supabase
        .from("rilievo_distress").select("*, distress(*)").eq("rilievo_id", rilievoId);
      if (error) throw error;
      return data;
    },
    // tutti i rilievi con i distress annidati (e il catalogo), per lo Storico
    listConDistress: async () => {
      const { data, error } = await supabase
        .from("rilievo")
        .select("*, rilievo_distress(*, distress(codice, nome, unita_misura, deduct_params, ha_severita))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    // elimina rilievi per id (i rilievo_distress collegati vanno via in cascata)
    remove: async (ids) => {
      const { error } = await supabase.from("rilievo").delete().in("id", ids);
      if (error) throw error;
    },
  },

  ettometriche: {
    list: async (strada) => {
      const { data, error } = await supabase
        .from("ettometrica").select("*").eq("strada", strada).order("progressiva_m");
      if (error) throw error;
      return data;
    },
    count: async () => {
      const { count, error } = await supabase
        .from("ettometrica").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
    clear: async () => {
      const { error } = await supabase.from("ettometrica").delete().gte("progressiva_m", 0);
      if (error) throw error;
    },
    insertMany: async (rows) => {
      const { error } = await supabase.from("ettometrica").insert(rows);
      if (error) throw error;
    },
  },

  // Banca esempi per il few-shot (Calibrazione)
  ml: {
    list: async () => {
      const { data, error } = await supabase
        .from("ml_esempio")
        .select("*, distress(codice, nome, ha_severita)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    // esempi attivi (con codice/nome distress) per il few-shot del riconoscimento
    listAttivi: async () => {
      const { data, error } = await supabase
        .from("ml_esempio")
        .select("foto_id, strato, severita, posizione, distress(codice, nome)")
        .eq("attivo", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    create: async (esempio) => {
      const { data, error } = await supabase
        .from("ml_esempio").insert(esempio).select().single();
      if (error) throw error;
      return data;
    },
    update: async (id, patch) => {
      const { data, error } = await supabase
        .from("ml_esempio").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    remove: async (id) => {
      const { error } = await supabase.from("ml_esempio").delete().eq("id", id);
      if (error) throw error;
    },
  },
};

// Invoca la Edge Function di riconoscimento AI (proxy verso Gemini)
export async function riconosciDistress(payload) {
  guardAI();                                   // freno anti-tempesta di chiamate
  let tier = "standard";
  try { tier = localStorage.getItem("distressiq_model_tier") || "standard"; } catch {}
  const { data, error } = await supabase.functions.invoke("riconosci-distress", { body: { ...payload, tier, lang: getLang() } });
  if (error) throw error;
  return data;
}

// Invoca la Edge Function che, dal nome, suggerisce descrizione/cause/soluzioni
export async function suggerisciDistress(payload) {
  guardAI();                                   // stesso freno (stesso credito)
  const { data, error } = await supabase.functions.invoke("suggerisci-distress", { body: { ...payload, lang: getLang() } });
  if (error) throw error;
  return data;
}

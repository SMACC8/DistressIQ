// =====================================================================
//  Configurazione runtime di DistressIQ.
//
//  La publishable key di Supabase È PUBBLICA per definizione: la sicurezza
//  la fanno le Row Level Security, quindi può stare nel client senza problemi.
//  NON mettere MAI qui la chiave "sb_secret_..." né la chiave Gemini:
//  quella vivrà come secret della Edge Function (passo 4).
// =====================================================================

export const SUPABASE_URL = "https://dslfchynrfpjbhhyuccp.supabase.co";
export const SUPABASE_KEY = "sb_publishable_mQ2Rr6suFutLhmesb5aIwQ_EaLzQCwX";

// Bucket di Supabase Storage per le foto (fase di sviluppo).
// In produzione le immagini piene passeranno a Google Drive dietro la stessa
// interfaccia (vedi storage.js).
export const BUCKET_FOTO = "foto";

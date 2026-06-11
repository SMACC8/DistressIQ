// =====================================================================
//  Interfaccia di storage immagini.
//  Implementazione attuale: Supabase Storage.
//  Domani basterà riscrivere questi tre metodi per Google Drive: le sezioni
//  che li usano (Rilievo, Storico, Calibrazione...) non cambiano di una riga.
// =====================================================================

import { supabase } from "./db.js";
import { BUCKET_FOTO } from "./config.js";

export const storage = {
  // Carica un File/Blob al percorso indicato; ritorna il path salvato.
  put: async (file, path) => {
    const { error } = await supabase.storage
      .from(BUCKET_FOTO)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    return path;
  },

  // URL pubblico (bucket pubblico in sviluppo).
  // Per un bucket privato passeremo a createSignedUrl mantenendo la stessa firma.
  url: (path) => supabase.storage.from(BUCKET_FOTO).getPublicUrl(path).data.publicUrl,

  remove: async (path) => {
    const { error } = await supabase.storage.from(BUCKET_FOTO).remove([path]);
    if (error) throw error;
  },
};

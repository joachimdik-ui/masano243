const getWindowValue = (...keys) => {
  if (typeof window === "undefined") return undefined;
  for (const key of keys) {
    const value = window[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const getProcessValue = (...keys) => {
  if (typeof process === "undefined" || !process.env) return undefined;
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const readSupabaseValue = (...keys) => getWindowValue(...keys) ?? getProcessValue(...keys);

const supabaseUrl = readSupabaseValue("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL")
  || "https://cisgavepcswtgnpomlyg.supabase.co";
const supabaseAnonKey = readSupabaseValue("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY")
  || "sb_publishable_ImWO2pVSsT9DjXAv9_gq2g_gPFAUxC5";

const createSupabaseClient = (url, key) => {
  if (!url || !key) return null;
  if (typeof window !== "undefined" && window.supabase && typeof window.supabase.createClient === "function") {
    return window.supabase.createClient(url, key);
  }
  return null;
};

export const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

const scoopSupabaseUrl = readSupabaseValue("SCOOP_SUPABASE_URL") || "https://qkzzhjeeuierlqkqexrf.supabase.co";
const scoopSupabaseAnonKey = readSupabaseValue("SCOOP_SUPABASE_PUBLISHABLE_KEY")
  || "sb_publishable_ZbBHL33f1N8IwdvKRyWLfA_CI9hmi_z";

export const scoopSupabase = createSupabaseClient(scoopSupabaseUrl, scoopSupabaseAnonKey);

const buildUrl = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_SUPABASE_URL
  : "";
const buildAnonKey = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  : "";

const supabaseUrl = window.NEXT_PUBLIC_SUPABASE_URL
  || window.SUPABASE_URL
  || buildUrl
  || "https://cisgavepcswtgnpomlyg.supabase.co";
const supabaseAnonKey = window.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || window.SUPABASE_ANON_KEY
  || buildAnonKey
  || "sb_publishable_ImWO2pVSsT9DjXAv9_gq2g_gPFAUxC5";

const createSupabaseClient = (url, key) => window.supabase && url && key
  ? window.supabase.createClient(url, key)
  : null;

export const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

const scoopSupabaseUrl = window.SCOOP_SUPABASE_URL
  || "https://qkzzhjeeuierlqkqexrf.supabase.co";
const scoopSupabaseAnonKey = window.SCOOP_SUPABASE_PUBLISHABLE_KEY
  || "sb_publishable_ZbBHL33f1N8IwdvKRyWLfA_CI9hmi_z";

export const scoopSupabase = createSupabaseClient(scoopSupabaseUrl, scoopSupabaseAnonKey);

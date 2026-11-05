// api/tv-admin.js — Masano TV : directs OBS (RTMPS) via Cloudflare Stream.
//
//   POST   /api/tv-admin        crée un direct (live input Cloudflare) + la ligne tv_contenus
//                               → { id, rtmps: { url, streamKey } }
//   GET    /api/tv-admin?id=…   réaffiche le serveur RTMPS et la clé d'un direct existant
//   DELETE /api/tv-admin?id=…   supprime le direct chez Cloudflare puis la ligne tv_contenus
//
// Réservé aux administrateurs : le jeton Supabase de l'admin est vérifié avec public.is_admin().
// La clé OBS n'est JAMAIS stockée en base : elle est relue chez Cloudflare à la demande.
//
// Variables d'environnement Vercel :
//   SUPABASE_URL, SUPABASE_ANON_KEY
//   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_STREAM_API_TOKEN   (permission Stream : Edit)
//   CLOUDFLARE_STREAM_CUSTOMER_CODE   (la partie « xxxx » de customer-xxxx.cloudflarestream.com,
//                                      visible dans Cloudflare → Stream → n'importe quelle vidéo)

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

const ALLOWED_FIELDS = [
  "titre", "description", "emission_nom", "sport", "competition",
  "statut", "debut", "fin", "miniature_url", "match_id", "publie"
];
const STATUSES = ["programme", "en_direct", "termine"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new HttpError(500, `Configuration manquante sur Vercel : ${name}.`);
  return value;
};

const cloudflare = async (path, options = {}) => {
  const account = env("CLOUDFLARE_ACCOUNT_ID");
  const token = env("CLOUDFLARE_STREAM_API_TOKEN");
  const response = await fetch(`${CLOUDFLARE_API}/accounts/${account}/stream${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 404) throw new HttpError(404, "Direct introuvable chez Cloudflare.");
  if (!response.ok || body.success === false) {
    throw new HttpError(502, `Cloudflare Stream : ${body.errors?.[0]?.message || `erreur HTTP ${response.status}`}`);
  }
  return body.result;
};

const requireAdmin = async (req) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Connexion requise.");
  const base = env("SUPABASE_URL").replace(/\/$/, "");
  const anonKey = env("SUPABASE_ANON_KEY");
  const headers = { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const check = await fetch(`${base}/rest/v1/rpc/is_admin`, { method: "POST", headers, body: "{}" });
  if (!check.ok) throw new HttpError(401, "Session invalide. Reconnectez-vous.");
  if ((await check.json().catch(() => false)) !== true) throw new HttpError(403, "Réservé aux administrateurs.");
  return { base, headers };
};

const supabaseRest = async ({ base, headers }, path, options = {}) => {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new HttpError(502, `Base de données : ${body?.message || `erreur HTTP ${response.status}`}`);
  return body;
};

const cleanText = (value, max) => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
};
const cleanUrl = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};
const cleanDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const getRow = async (admin, id) => {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new HttpError(400, "Identifiant invalide.");
  const rows = await supabaseRest(admin, `tv_contenus?id=eq.${id}&select=id,type,live_input_id`);
  if (!rows?.length) throw new HttpError(404, "Contenu TV introuvable.");
  return rows[0];
};

const createDirect = async (admin, input) => {
  const titre = cleanText(input.titre, 160);
  if (!titre) throw new HttpError(400, "Le titre est obligatoire.");
  const statut = STATUSES.includes(input.statut) ? input.statut : "en_direct";
  const debut = cleanDate(input.debut);
  const fin = cleanDate(input.fin);
  if (debut && fin && new Date(fin) <= new Date(debut)) throw new HttpError(400, "La fin doit être après le début.");

  const customerCode = env("CLOUDFLARE_STREAM_CUSTOMER_CODE");
  const liveInput = await cloudflare("/live_inputs", {
    method: "POST",
    body: JSON.stringify({ meta: { name: titre }, recording: { mode: "automatic" } })
  });

  // Lecture HLS : la même adresse diffuse le direct puis l'enregistrement automatique.
  const hls = `https://customer-${customerCode}.cloudflarestream.com/${liveInput.uid}/manifest/video.m3u8`;
  const row = {
    type: "direct",
    titre,
    description: cleanText(input.description, 2000),
    emission_nom: cleanText(input.emission_nom, 160),
    sport: cleanText(input.sport, 80),
    competition: cleanText(input.competition, 160),
    statut,
    debut,
    fin,
    miniature_url: cleanUrl(input.miniature_url),
    match_id: cleanText(input.match_id, 120),
    publie: Boolean(input.publie),
    live_input_id: liveInput.uid,
    hls_url: hls,
    replay_url: hls
  };

  try {
    const [created] = await supabaseRest(admin, "tv_contenus", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(row)
    });
    return {
      id: created.id,
      rtmps: { url: liveInput.rtmps.url, streamKey: liveInput.rtmps.streamKey }
    };
  } catch (error) {
    // La base a refusé : on n'abandonne pas un direct orphelin chez Cloudflare.
    await cloudflare(`/live_inputs/${liveInput.uid}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const admin = await requireAdmin(req);
    const id = String(req.query?.id || "");

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      if (body.type && body.type !== "direct") throw new HttpError(400, "Seuls les directs passent par OBS.");
      const input = Object.fromEntries(ALLOWED_FIELDS.map((field) => [field, body[field]]));
      return res.status(201).json(await createDirect(admin, input));
    }

    if (req.method === "GET") {
      const row = await getRow(admin, id);
      if (row.type !== "direct" || !row.live_input_id) throw new HttpError(400, "Ce contenu n’a pas de clé OBS.");
      const liveInput = await cloudflare(`/live_inputs/${row.live_input_id}`);
      return res.status(200).json({ rtmps: { url: liveInput.rtmps.url, streamKey: liveInput.rtmps.streamKey } });
    }

    if (req.method === "DELETE") {
      const row = await getRow(admin, id);
      if (row.live_input_id) {
        try {
          await cloudflare(`/live_inputs/${row.live_input_id}`, { method: "DELETE" });
        } catch (error) {
          if (error.status !== 404) throw error; // déjà supprimé chez Cloudflare : on continue
        }
      }
      await supabaseRest(admin, `tv_contenus?id=eq.${row.id}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    throw new HttpError(405, "Méthode non autorisée.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error("api/tv-admin", error);
    return res.status(status).json({ error: status >= 500 && !(error instanceof HttpError) ? "Erreur interne du serveur." : error.message });
  }
};
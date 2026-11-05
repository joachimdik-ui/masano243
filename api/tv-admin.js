const json = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const optionalDate = (value, label) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} n’est pas une date valide.`);
  return date.toISOString();
};

const optionalUrl = (value, label) => {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} doit être une URL valide.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} doit commencer par http:// ou https://.`);
  }
  return url.href;
};

const authorizeAdmin = async (request, supabaseUrl, supabaseKey) => {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const headers = { apikey: supabaseKey, Authorization: authorization };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return false;
  const adminResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}"
  });
  if (!adminResponse.ok) return false;
  return (await json(adminResponse)) === true;
};

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (!["POST", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "POST, DELETE");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cloudflareToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  const missing = [
    !supabaseUrl && "SUPABASE_URL",
    !supabaseKey && "SUPABASE_ANON_KEY",
    !cloudflareAccountId && "CLOUDFLARE_ACCOUNT_ID",
    !cloudflareToken && "CLOUDFLARE_STREAM_API_TOKEN"
  ].filter(Boolean);
  if (missing.length) {
    return response.status(503).json({
      error: `Configuration Vercel manquante : ${missing.join(", ")}.`
    });
  }

  const normalizedSupabaseUrl = supabaseUrl.replace(/\/+$/, "");
  try {
    if (!await authorizeAdmin(request, normalizedSupabaseUrl, supabaseKey)) {
      return response.status(403).json({ error: "Accès réservé aux administrateurs." });
    }

    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/stream/live_inputs`;
    const cloudflareHeaders = {
      Authorization: `Bearer ${cloudflareToken}`,
      "Content-Type": "application/json"
    };
    if (request.method === "DELETE") {
      const id = String(request.query?.id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return response.status(400).json({ error: "Identifiant de programme TV invalide." });
      }
      const recordResponse = await fetch(
        `${normalizedSupabaseUrl}/rest/v1/tv_contenus?id=eq.${encodeURIComponent(id)}&select=id,type,live_input_id`,
        { headers: { apikey: supabaseKey, Authorization: request.headers.authorization } }
      );
      const records = await json(recordResponse);
      if (!recordResponse.ok) return response.status(502).json({ error: "Impossible de vérifier le direct dans Supabase." });
      const record = Array.isArray(records) ? records[0] : null;
      if (!record || record.type !== "direct" || !record.live_input_id) {
        return response.status(404).json({ error: "Le direct associé à ce programme est introuvable." });
      }

      const deleteInputResponse = await fetch(
        `${cloudflareUrl}/${encodeURIComponent(record.live_input_id)}`,
        { method: "DELETE", headers: cloudflareHeaders }
      );
      if (!deleteInputResponse.ok && deleteInputResponse.status !== 404) {
        console.error("Cloudflare Stream live input deletion failed.", deleteInputResponse.status);
        return response.status(502).json({ error: "Cloudflare n’a pas pu supprimer la clé RTMPS de ce direct." });
      }
      const deleteRecordResponse = await fetch(
        `${normalizedSupabaseUrl}/rest/v1/tv_contenus?id=eq.${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: {
            apikey: supabaseKey,
            Authorization: request.headers.authorization,
            Prefer: "return=minimal"
          }
        }
      );
      if (!deleteRecordResponse.ok) {
        console.error("Supabase could not delete the TV content after removing its Cloudflare input.", deleteRecordResponse.status);
        return response.status(502).json({ error: "La clé RTMPS a été supprimée, mais le programme n’a pas pu être retiré de Supabase." });
      }
      return response.status(200).json({ deleted: true });
    }

    const body = request.body && typeof request.body === "object" ? request.body : {};
    let content;
    try {
      const title = String(body.titre || "").trim();
      if (!title) throw new Error("Le titre du direct est obligatoire.");
      content = {
        type: "direct",
        titre: title,
        description: String(body.description || "").trim() || null,
        emission_nom: String(body.emission_nom || "").trim() || null,
        sport: String(body.sport || "").trim() || null,
        competition: String(body.competition || "").trim() || null,
        statut: ["programme", "en_direct", "termine"].includes(body.statut) ? body.statut : "programme",
        debut: optionalDate(body.debut, "La date de début"),
        fin: optionalDate(body.fin, "La date de fin"),
        miniature_url: optionalUrl(body.miniature_url, "La miniature"),
        match_id: String(body.match_id || "").trim() || null,
        publie: body.publie === true
      };
      if (content.debut && content.fin && new Date(content.fin) <= new Date(content.debut)) {
        throw new Error("La fin doit être après le début.");
      }
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }

    const createResponse = await fetch(cloudflareUrl, {
      method: "POST",
      headers: cloudflareHeaders,
      body: JSON.stringify({ recording: { mode: "automatic" } })
    });
    const created = await json(createResponse);
    if (!createResponse.ok || !created.success || !created.result?.uid) {
      console.error("Cloudflare Stream live input creation failed.", createResponse.status);
      return response.status(502).json({ error: "Cloudflare n’a pas pu créer la clé de direct. Vérifiez le jeton et ses droits Stream Write." });
    }

    const input = created.result;
    const streamKey = input.rtmps?.streamKey;
    const rtmpsUrl = input.rtmps?.url;
    const hlsUrl = input.playback?.hls;
    if (!streamKey || !rtmpsUrl || !hlsUrl) {
      console.error("Cloudflare Stream returned incomplete live input credentials.");
      await fetch(`${cloudflareUrl}/${encodeURIComponent(input.uid)}`, {
        method: "DELETE",
        headers: cloudflareHeaders
      });
      return response.status(502).json({ error: "Cloudflare n’a pas retourné les informations RTMPS/HLS attendues." });
    }

    const insertResponse = await fetch(`${normalizedSupabaseUrl}/rest/v1/tv_contenus`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: request.headers.authorization,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        ...content,
        live_input_id: input.uid,
        hls_url: hlsUrl
      })
    });
    const inserted = await json(insertResponse);
    if (!insertResponse.ok || !Array.isArray(inserted) || !inserted[0]) {
      console.error("Supabase could not save the Cloudflare live input.", insertResponse.status);
      const deleteResponse = await fetch(`${cloudflareUrl}/${encodeURIComponent(input.uid)}`, {
        method: "DELETE",
        headers: cloudflareHeaders
      });
      if (!deleteResponse.ok) console.error("Cloudflare Stream live input cleanup failed.", deleteResponse.status);
      return response.status(502).json({ error: "Le direct a été créé mais n’a pas pu être enregistré dans Supabase. Vérifiez la migration TV et les droits administrateur." });
    }

    return response.status(201).json({
      content: inserted[0],
      rtmps: { url: rtmpsUrl, streamKey }
    });
  } catch (error) {
    console.error("Masano TV admin request failed.", error);
    return response.status(500).json({ error: error.message || "Impossible de créer le direct." });
  }
};

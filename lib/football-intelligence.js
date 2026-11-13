const crypto = require("node:crypto");

const SOURCES = [
  {
    source_key: "football-data.org",
    name: "football-data.org",
    source_type: "sports_api",
    base_url: "https://www.football-data.org/",
    trust_tier: "secondary"
  },
  {
    source_key: "thesportsdb",
    name: "TheSportsDB",
    source_type: "sports_api",
    base_url: "https://www.thesportsdb.com/",
    trust_tier: "secondary"
  },
  {
    source_key: "tavily",
    name: "Tavily Search",
    source_type: "web_search",
    base_url: "https://tavily.com/",
    trust_tier: "unclassified"
  }
];

const SOURCE_BY_KEY = new Map(SOURCES.map((source) => [source.source_key, source]));
const SPORTS_API_SOURCES = SOURCES.filter((source) => source.source_type === "sports_api");

const WEB_SEARCH_TOPICS = [
  "Léopards de la RDC équipe nationale masculine prochains matchs résultats récents FIFA CAF",
  "équipe nationale féminine de football de la RDC prochains matchs résultats FECOFA CAF",
  "RDC football sélections U23 U20 U17 calendrier matchs résultats CAF FIFA",
  "clubs de la RDC Ligue des Champions CAF Coupe de la Confédération saison courante matchs résultats classement",
  "CAF compétitions interclubs groupes classement clubs congolais République démocratique du Congo"
];

const normalizeTeamName = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const matchEntityKey = (match, sourceKey) => {
  const date = String(match.date_match || "").slice(0, 10);
  const home = normalizeTeamName(match.equipe_domicile);
  const away = normalizeTeamName(match.equipe_visiteur);
  if (date && home && away) {
    return `match:${date}:${[home, away].sort().join(":")}`;
  }
  const externalId = match.provider_id ?? match.id;
  if (externalId === null || externalId === undefined || String(externalId).trim() === "") {
    return null;
  }
  return `match:${sourceKey}:${String(externalId).trim()}`;
};

const isSportsDbMatch = (match) => (
  String(match.details_provider || "").toLowerCase() === "thesportsdb"
  || String(match.id || "").startsWith("thesportsdb-")
);

const providerForMatch = (match, defaultSource) => (
  defaultSource === "thesportsdb" || isSportsDbMatch(match)
    ? "thesportsdb"
    : "football-data.org"
);

const parseBearerToken = (authorization) => {
  const match = String(authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
};

const safeEqual = (first, second) => {
  const firstBuffer = Buffer.from(String(first || ""));
  const secondBuffer = Buffer.from(String(second || ""));
  return firstBuffer.length === secondBuffer.length
    && crypto.timingSafeEqual(firstBuffer, secondBuffer);
};

const hashPayload = (payload) => crypto.createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex");

const utcDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

const dailyWebSearchQuery = (date = new Date()) => {
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  const topic = WEB_SEARCH_TOPICS[day % WEB_SEARCH_TOPICS.length];
  return `${topic} ${date.getUTCFullYear()}`;
};

const buildWebSearchObservations = (result, sourceId, syncRunId, collectedAt, query) => {
  const observations = [];
  const rejected = [];
  const answer = typeof result.answer === "string" ? result.answer.trim() : "";
  const searchResults = Array.isArray(result.results) ? result.results : [];
  const seenUrls = new Set();
  const citations = [];

  for (const item of searchResults) {
    let sourceUrl;
    try {
      sourceUrl = new URL(String(item.url || ""));
    } catch {
      rejected.push("Résultat Web ignoré : URL invalide.");
      continue;
    }
    if (!["https:", "http:"].includes(sourceUrl.protocol)
      || sourceUrl.username || sourceUrl.password) {
      rejected.push("Résultat Web ignoré : URL non autorisée.");
      continue;
    }
    const canonicalUrl = sourceUrl.href;
    if (seenUrls.has(canonicalUrl)) continue;
    seenUrls.add(canonicalUrl);
    citations.push({ url: canonicalUrl, title: String(item.title || "").slice(0, 300) });
    const payload = {
      topic: query,
      title: String(item.title || "").slice(0, 300),
      content: String(item.content || "").slice(0, 5000),
      source_url: canonicalUrl,
      published_date: item.published_date || null,
      relevance_score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      ai_answer: answer || null
    };

    observations.push({
      source_id: sourceId,
      sync_run_id: syncRunId,
      entity_type: "news",
      entity_key: `web-result:${crypto.createHash("sha256").update(canonicalUrl).digest("hex")}`,
      external_id: canonicalUrl,
      source_url: canonicalUrl,
      collected_at: collectedAt,
      content_hash: hashPayload(payload),
      payload
    });
  }

  if (answer) {
    const payload = {
      topic: query,
      answer,
      citations,
      generated_by: "Tavily Search (AI-generated; unverified)"
    };
    observations.push({
      source_id: sourceId,
      sync_run_id: syncRunId,
      entity_type: "news",
      entity_key: `web-answer:${utcDateKey(new Date(collectedAt))}:${hashPayload(query).slice(0, 24)}`,
      external_id: null,
      source_url: citations[0]?.url || "https://tavily.com/",
      collected_at: collectedAt,
      content_hash: hashPayload(payload),
      payload
    });
  }

  return { observations, rejected };
};

const chunk = (items, size) => {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const createFootballRepository = (environment = process.env) => {
  const baseUrl = String(environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!baseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis pour la synchronisation football.");
  }

  const request = async (table, { method = "GET", query = "", body, prefer } = {}) => {
    const url = `${baseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`;
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json"
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;

    const response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Supabase ${table} a répondu HTTP ${response.status}${detail ? ` : ${detail}` : ""}.`);
    }
    if (response.status === 204) return [];
    const content = await response.text();
    return content ? JSON.parse(content) : [];
  };

  const upsert = (table, rows, conflictColumns) => request(table, {
    method: "POST",
    query: `on_conflict=${encodeURIComponent(conflictColumns)}`,
    body: rows,
    prefer: "resolution=merge-duplicates,return=representation"
  });

  const insertNew = (table, rows, conflictColumns) => request(table, {
    method: "POST",
    query: `on_conflict=${encodeURIComponent(conflictColumns)}`,
    body: rows,
    prefer: "resolution=ignore-duplicates,return=representation"
  });

  const insertObservations = async (observations) => {
    let inserted = 0;
    for (const batch of chunk(observations, 50)) {
      const saved = await insertNew(
        "football_observations",
        batch,
        "source_id,entity_type,entity_key,content_hash"
      );
      if (!Array.isArray(saved)) throw new Error("Réponse Supabase invalide pour les observations football.");
      inserted += saved.length;
    }
    return inserted;
  };

  const reserveSearchCredit = async (periodMonth, monthlyLimit) => {
    const result = await request("rpc/reserve_football_search_credit", {
      method: "POST",
      body: { p_period_month: periodMonth, p_monthly_limit: monthlyLimit }
    });
    if (typeof result !== "boolean") {
      throw new Error("Réponse Supabase invalide pour la réservation du crédit de recherche.");
    }
    return result;
  };

  const upsertCache = async (cacheKey, sourceId, payload, fetchedAt) => {
    const expiresAt = new Date(new Date(fetchedAt).getTime() + 5 * 60 * 1000).toISOString();
    await upsert("football_data_cache", [{
      cache_key: cacheKey,
      source_id: sourceId,
      payload,
      fetched_at: fetchedAt,
      expires_at: expiresAt,
      updated_at: fetchedAt
    }], "cache_key");
  };

  return {
    insertObservations,
    request,
    reserveSearchCredit,
    upsert,
    upsertCache
  };
};

const buildObservations = (matches, sourceId, sourceKey, syncRunId, collectedAt) => {
  const observations = [];
  const rejected = [];

  for (const match of matches) {
    if (!match || typeof match !== "object" || Array.isArray(match)) {
      rejected.push("Élément de match invalide.");
      continue;
    }
    const home = String(match.equipe_domicile || "").trim();
    const away = String(match.equipe_visiteur || "").trim();
    const entityKey = matchEntityKey(match, sourceKey);
    if (!home || !away || !entityKey) {
      rejected.push("Match ignoré : équipes ou identifiant de rencontre manquant.");
      continue;
    }
    const scores = [match.score_domicile, match.score_visiteur];
    const invalidScore = scores.some((score) => {
      if (score === null || score === undefined) return false;
      if (typeof score === "string" && !/^\d+$/.test(score.trim())) return true;
      return !Number.isInteger(Number(score)) || Number(score) < 0;
    });
    if (invalidScore) {
      rejected.push(`Match ignoré : score invalide pour ${home} – ${away}.`);
      continue;
    }
    const source = SOURCE_BY_KEY.get(sourceKey);
    if (!source) throw new Error(`Source football inconnue : ${sourceKey}.`);

    observations.push({
      source_id: sourceId,
      sync_run_id: syncRunId,
      entity_type: "match",
      entity_key: entityKey,
      external_id: String(match.provider_id ?? match.id ?? ""),
      source_url: match.source_url || match.url || source.base_url,
      collected_at: collectedAt,
      content_hash: hashPayload(match),
      payload: match
    });
  }

  return { observations, rejected };
};

module.exports = {
  SOURCES,
  SPORTS_API_SOURCES,
  WEB_SEARCH_TOPICS,
  buildObservations,
  buildWebSearchObservations,
  createFootballRepository,
  dailyWebSearchQuery,
  isSportsDbMatch,
  matchEntityKey,
  parseBearerToken,
  providerForMatch,
  safeEqual
};

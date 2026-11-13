const {
  SOURCES,
  SPORTS_API_SOURCES,
  buildObservations,
  buildWebSearchObservations,
  createFootballRepository,
  dailyWebSearchQuery,
  isSportsDbMatch,
  parseBearerToken,
  providerForMatch,
  safeEqual
} = require("../lib/football-intelligence");

const TAVILY_MONTHLY_SEARCH_LIMIT = 500;

const deploymentOrigin = () => {
  const configuredHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!configuredHost) throw new Error("VERCEL_PROJECT_PRODUCTION_URL ou VERCEL_URL est requis.");
  const url = new URL(configuredHost.includes("://") ? configuredHost : `https://${configuredHost}`);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("L’origine de déploiement doit être une URL HTTPS valide.");
  }
  return url.origin;
};

const fetchFeed = async (origin, path) => {
  try {
    const response = await fetch(new URL(path, origin), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `L’API ${path} a répondu HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload.matches)) throw new Error(`L’API ${path} a renvoyé une liste de matchs invalide.`);
    return {
      path,
      matches: payload.matches,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      updated_at: payload.updated_at || null,
      error: null
    };
  } catch (error) {
    console.error(`Football intelligence: impossible de lire ${path}.`, error);
    return { path, matches: [], warnings: [], updated_at: null, error: error.message };
  }
};

const groupBySource = (feeds) => {
  const matches = new Map(SPORTS_API_SOURCES.map(({ source_key }) => [source_key, []]));
  const warnings = new Map(SPORTS_API_SOURCES.map(({ source_key }) => [source_key, []]));
  const successfulFeeds = new Map(SPORTS_API_SOURCES.map(({ source_key }) => [source_key, 0]));
  const failedFeeds = new Map(SPORTS_API_SOURCES.map(({ source_key }) => [source_key, []]));

  for (const feed of feeds) {
    if (feed.error) {
      const affectedSources = feed.path === "/api/leopards-matches"
        ? ["thesportsdb"]
        : ["football-data.org", "thesportsdb"];
      for (const sourceKey of affectedSources) {
        failedFeeds.get(sourceKey).push({ path: feed.path, error: feed.error });
      }
      continue;
    }
    for (const match of feed.matches) {
      const sourceKey = providerForMatch(match, feed.path === "/api/leopards-matches" ? "thesportsdb" : "football-data.org");
      matches.get(sourceKey).push(match);
    }
    if (feed.path === "/api/leopards-matches") {
      if (!feed.warnings.length || feed.matches.length) {
        successfulFeeds.set("thesportsdb", successfulFeeds.get("thesportsdb") + 1);
      }
    } else {
      successfulFeeds.set("football-data.org", successfulFeeds.get("football-data.org") + 1);
      if (!feed.warnings.length || feed.matches.some(isSportsDbMatch)) {
        successfulFeeds.set("thesportsdb", successfulFeeds.get("thesportsdb") + 1);
      }
    }
    for (const warning of feed.warnings) warnings.get("thesportsdb").push(String(warning));
  }

  return { matches, warnings, successfulFeeds, failedFeeds };
};

const updateSyncLog = (repository, id, fields) => repository.request("football_sync_logs", {
  method: "PATCH",
  query: `id=eq.${encodeURIComponent(id)}`,
  body: fields,
  prefer: "return=minimal"
});

const runDailyWebResearch = async (repository, sourceId, syncRunId, collectedAt) => {
  const apiKey = process.env.TAVILY_API_KEY;
  const periodMonth = `${collectedAt.slice(0, 7)}-01`;
  const hasSearchCapacity = await repository.reserveSearchCredit(
    periodMonth,
    TAVILY_MONTHLY_SEARCH_LIMIT
  );
  if (!hasSearchCapacity) {
    return {
      status: "quota_exhausted",
      reason: `Plafond interne de ${TAVILY_MONTHLY_SEARCH_LIMIT} recherches atteint pour le mois.`,
      records_inserted: 0
    };
  }

  const query = dailyWebSearchQuery(new Date(collectedAt));
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : { "X-Tavily-Access-Mode": "keyless" })
  };
  const upstream = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: "basic",
      max_results: 5,
      chunks_per_source: 1,
      include_answer: "basic",
      include_published_date: true
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!upstream.ok) {
    throw new Error(`Tavily a répondu HTTP ${upstream.status}.`);
  }

  const payload = await upstream.json();
  if (!payload || !Array.isArray(payload.results)) {
    throw new Error("Tavily a renvoyé un format de recherche invalide.");
  }
  const { observations, rejected } = buildWebSearchObservations(
    payload,
    sourceId,
    syncRunId,
    collectedAt,
    query
  );
  const inserted = await repository.insertObservations(observations);
  await repository.upsertCache(
    `web-search:${query}`,
    sourceId,
    { query, answer: payload.answer || null, results: payload.results },
    collectedAt
  );
  return {
    status: rejected.length ? "partial" : "succeeded",
    query,
    access_mode: apiKey ? "api_key" : "keyless",
    searches_reserved: 1,
    results_fetched: payload.results.length,
    records_inserted: inserted,
    warnings: rejected
  };
};

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 16) {
    return response.status(503).json({ error: "CRON_SECRET doit être configuré avec au moins 16 caractères." });
  }
  if (!safeEqual(parseBearerToken(request.headers?.authorization), cronSecret)) {
    return response.status(401).json({ error: "Authentification Cron invalide." });
  }
  if (process.env.FOOTBALL_INTELLIGENCE_SYNC_ENABLED !== "true") {
    return response.status(503).json({
      error: "Synchronisation désactivée. Appliquez la migration et validez la configuration avant de l’activer."
    });
  }

  let repository;
  try {
    repository = createFootballRepository();
  } catch (error) {
    return response.status(503).json({ error: error.message });
  }

  let syncRunId;
  const startedAt = new Date().toISOString();
  try {
    const savedSources = await repository.upsert("football_sources", SOURCES, "source_key");
    if (!Array.isArray(savedSources) || savedSources.length !== SOURCES.length) {
      throw new Error("Impossible de retrouver les sources football dans Supabase.");
    }
    const sourceIds = new Map(savedSources.map((source) => [source.source_key, source.id]));
    const enabledSources = new Set(savedSources
      .filter((source) => source.enabled !== false)
      .map((source) => source.source_key));

    const [syncRun] = await repository.request("football_sync_logs", {
      method: "POST",
      body: [{ trigger_type: "cron", status: "running", started_at: startedAt }],
      prefer: "return=representation"
    });
    syncRunId = syncRun?.id;
    if (!syncRunId) throw new Error("Impossible de créer le journal de synchronisation football.");

    const origin = deploymentOrigin();
    const [internationalFeed, leopardsFeed] = await Promise.all([
      fetchFeed(origin, "/api/international-matches"),
      fetchFeed(origin, "/api/leopards-matches")
    ]);

    const feeds = [internationalFeed, leopardsFeed];
    const grouped = groupBySource(feeds);
    const collectedAt = new Date().toISOString();
    const sourceResults = { feeds: [], sources: {} };
    let itemsFetched = 0;
    let itemsInserted = 0;
    let hasErrors = [...grouped.failedFeeds.values()].some((failures) => failures.length > 0);

    for (const feed of feeds) {
      sourceResults.feeds.push({
        path: feed.path,
        status: feed.error ? "failed" : feed.warnings.length ? "partial" : "succeeded",
        records: feed.matches.length,
        warnings: feed.warnings,
        error: feed.error
      });
    }

    for (const source of SPORTS_API_SOURCES) {
      const sourceKey = source.source_key;
      if (!enabledSources.has(sourceKey)) {
        sourceResults.sources[sourceKey] = {
          status: "skipped",
          records_fetched: 0,
          records_valid: 0,
          records_inserted: 0,
          warnings: [],
          error: "Source désactivée."
        };
        continue;
      }
      const sourceMatches = grouped.matches.get(sourceKey);
      const rejected = [];
      const { observations, rejected: rejectedItems } = buildObservations(
        sourceMatches,
        sourceIds.get(sourceKey),
        sourceKey,
        syncRunId,
        collectedAt
      );
      rejected.push(...rejectedItems);
      itemsFetched += sourceMatches.length;

      let inserted = 0;
      let persistenceError = null;
      try {
        inserted = await repository.insertObservations(observations);
        itemsInserted += inserted;
        if (grouped.successfulFeeds.get(sourceKey) > 0) {
          await repository.upsertCache(
            `matches:${sourceKey}`,
            sourceIds.get(sourceKey),
            { matches: sourceMatches, warnings: grouped.warnings.get(sourceKey) },
            collectedAt
          );
        }
      } catch (error) {
        hasErrors = true;
        persistenceError = error.message;
        console.error(`Football intelligence: enregistrement ${sourceKey} échoué.`, error);
      }

      const sourceFailed = grouped.successfulFeeds.get(sourceKey) === 0 || persistenceError;
      const sourcePartial = !sourceFailed && (
        grouped.failedFeeds.get(sourceKey).length > 0
        || grouped.warnings.get(sourceKey).length > 0
        || rejected.length > 0
      );
      if (sourceFailed || sourcePartial) hasErrors = true;
      sourceResults.sources[sourceKey] = {
        status: sourceFailed ? "failed" : sourcePartial ? "partial" : "succeeded",
        records_fetched: sourceMatches.length,
        records_valid: observations.length,
        records_inserted: inserted,
        warnings: [...grouped.warnings.get(sourceKey), ...rejected],
        error: persistenceError
      };
    }

    const tavily = SOURCES.find((source) => source.source_key === "tavily");
    const tavilyId = sourceIds.get("tavily");
    try {
      if (!enabledSources.has("tavily")) {
        sourceResults.web_search = {
          status: "skipped",
          reason: "Source Tavily désactivée.",
          records_inserted: 0
        };
      } else {
        sourceResults.web_search = await runDailyWebResearch(
          repository,
          tavilyId,
          syncRunId,
          collectedAt
        );
        if (sourceResults.web_search.status === "partial"
          || sourceResults.web_search.status === "quota_exhausted") {
          hasErrors = true;
        }
      }
    } catch (error) {
      hasErrors = true;
      sourceResults.web_search = {
        status: "failed",
        records_inserted: 0,
        error: error.message
      };
      console.error(`Football intelligence: recherche Web ${tavily?.name || "Tavily"} échouée.`, error);
    }

    const completedAt = new Date().toISOString();
    const activeSources = Object.values(sourceResults.sources)
      .filter((source) => source.status !== "skipped");
    const status = activeSources.length > 0
      && activeSources.every((source) => source.status === "failed")
      ? "failed"
      : hasErrors
        ? "partial"
        : "succeeded";
    await updateSyncLog(repository, syncRunId, {
      status,
      completed_at: completedAt,
      source_results: sourceResults,
      items_fetched: itemsFetched,
      items_inserted: itemsInserted,
      error: status === "failed" ? "Aucune source football n’a pu être synchronisée." : null
    });

    response.setHeader("Cache-Control", "no-store");
    return response.status(status === "failed" ? 502 : 200).json({
      status,
      sync_run_id: syncRunId,
      items_fetched: itemsFetched,
      items_inserted: itemsInserted,
      source_results: sourceResults
    });
  } catch (error) {
    console.error("Football intelligence synchronization failed.", error);
    if (syncRunId) {
      try {
        await updateSyncLog(repository, syncRunId, {
          status: "failed",
          completed_at: new Date().toISOString(),
          error: error.message
        });
      } catch (logError) {
        console.error("Football intelligence: impossible de finaliser le journal.", logError);
      }
    }
    return response.status(500).json({
      error: "La synchronisation football a échoué.",
      detail: error.message,
      sync_run_id: syncRunId || null
    });
  }
};

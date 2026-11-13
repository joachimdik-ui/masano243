const {
  hashPayload,
  SOURCES
} = require("./football-intelligence");

const ARCHIVE_SOURCE_KEY = "football-data-archive";
const ARCHIVE_BASE_URL = SOURCES.find((source) => source.source_key === ARCHIVE_SOURCE_KEY).base_url;

const COLLECTIONS = [
  {
    key: "national-team/fixtures",
    entityType: "match",
    data: require("../football-data/football-data/national-team/fixtures.json")
  },
  {
    key: "national-team/results",
    entityType: "match",
    data: require("../football-data/football-data/national-team/results.json")
  },
  {
    key: "national-team/standings",
    entityType: "standings",
    data: require("../football-data/football-data/national-team/standings.json")
  },
  {
    key: "national-team/news",
    entityType: "news",
    data: require("../football-data/football-data/national-team/news.json")
  },
  {
    key: "caf/clubs",
    entityType: "team",
    data: require("../football-data/football-data/caf/clubs.json")
  },
  {
    key: "caf/champions-league",
    entityType: "competition",
    data: require("../football-data/football-data/caf/champions-league.json")
  },
  {
    key: "caf/confederation-cup",
    entityType: "competition",
    data: require("../football-data/football-data/caf/confederation-cup.json")
  },
  {
    key: "caf/fixtures",
    entityType: "match",
    data: require("../football-data/football-data/caf/fixtures.json")
  },
  {
    key: "caf/standings",
    entityType: "standings",
    data: require("../football-data/football-data/caf/standings.json")
  },
  {
    key: "head-to-head/confrontations",
    entityType: "head_to_head",
    data: require("../football-data/football-data/head-to-head/confrontations.json")
  }
];

const validHttpUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const sourceUrlFor = (item, collectionKey) => {
  const citations = Array.isArray(item.sources) ? item.sources : [];
  for (const citation of citations) {
    const sourceUrl = validHttpUrl(citation?.url);
    if (sourceUrl) return sourceUrl;
  }
  return `${ARCHIVE_BASE_URL}/${collectionKey}.json`;
};

const buildFootballDataArchiveObservations = (sourceId, syncRunId, collectedAt) => {
  const observations = [];
  const rejected = [];
  const collectionResults = {};

  for (const collection of COLLECTIONS) {
    if (!Array.isArray(collection.data.items)) {
      throw new Error(`Collection football-data invalide : ${collection.key}.`);
    }

    const result = {
      records_fetched: collection.data.items.length,
      records_valid: 0,
      warnings: []
    };

    for (const item of collection.data.items) {
      const itemId = String(item?.id || "").trim();
      if (!item || typeof item !== "object" || Array.isArray(item) || !itemId) {
        const warning = `${collection.key} : élément ignoré, identifiant manquant ou invalide.`;
        rejected.push(warning);
        result.warnings.push(warning);
        continue;
      }

      const payload = {
        archive: "football-data",
        collection: collection.key,
        archive_meta: {
          schema_version: collection.data.meta?.schema_version || null,
          last_sync: collection.data.meta?.last_sync || null
        },
        archive_verification: item.verification || null,
        item
      };

      observations.push({
        source_id: sourceId,
        sync_run_id: syncRunId,
        entity_type: collection.entityType,
        entity_key: `football-data:${collection.key}:${itemId}`,
        external_id: itemId,
        source_url: sourceUrlFor(item, collection.key),
        collected_at: collectedAt,
        content_hash: hashPayload({ collection: collection.key, item }),
        payload
      });
      result.records_valid += 1;
    }

    collectionResults[collection.key] = result;
  }

  return { observations, rejected, collections: collectionResults };
};

module.exports = {
  ARCHIVE_SOURCE_KEY,
  buildFootballDataArchiveObservations
};

const crypto = require("node:crypto");
const { fetchInternationalResults } = require("../scripts/update-international-results");
const deploymentArchive = require("../data/international-results.json");

const ARCHIVE_PATH = "data/international-results.json";
const DEFAULT_REPOSITORY = "joachimdik-ui/masano243";
const DEFAULT_BRANCH = "main";

const safeEqual = (first, second) => {
  const firstBuffer = Buffer.from(String(first || ""));
  const secondBuffer = Buffer.from(String(second || ""));
  return firstBuffer.length === secondBuffer.length
    && crypto.timingSafeEqual(firstBuffer, secondBuffer);
};

const githubRequest = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API returned HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.status === 204 ? null : response.json();
};

const deploymentOrigin = () => {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!host) throw new Error("VERCEL_PROJECT_PRODUCTION_URL or VERCEL_URL is required.");
  return new URL(`https://${host}`).origin;
};

const fetchApiSnapshot = async (origin, path, previous, retrievedAt) => {
  try {
    const response = await fetch(new URL(path, origin));
    if (!response.ok) throw new Error(`Internal API returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload.matches)) throw new Error("Internal API returned an invalid matches array.");
    return {
      source: path,
      providers: path === "/api/leopards-matches"
        ? ["TheSportsDB"]
        : ["football-data.org", "TheSportsDB"],
      fetched_at: retrievedAt,
      last_success_at: retrievedAt,
      status: "ok",
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      provider_updated_at: payload.updated_at || null,
      matches: payload.matches
    };
  } catch (error) {
    console.error(`Could not refresh API snapshot ${path}.`, error);
    return {
      source: previous?.source || path,
      providers: previous?.providers || (path === "/api/leopards-matches"
        ? ["TheSportsDB"]
        : ["football-data.org", "TheSportsDB"]),
      fetched_at: previous?.fetched_at || null,
      last_success_at: previous?.last_success_at || null,
      attempted_at: retrievedAt,
      status: "stale",
      error: error.message,
      warnings: previous?.warnings || [],
      provider_updated_at: previous?.provider_updated_at || null,
      matches: Array.isArray(previous?.matches) ? previous.matches : []
    };
  }
};

const splitInternationalMatches = (snapshot) => {
  const matches = Array.isArray(snapshot.matches) ? snapshot.matches : [];
  return {
    ...snapshot,
    international: matches.filter((match) => match.competition_category !== "interclubs"),
    interclubs: matches.filter((match) => match.competition_category === "interclubs")
  };
};

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers?.authorization || "";
  if (!cronSecret || !safeEqual(authorization, `Bearer ${cronSecret}`)) {
    return response.status(401).json({ error: "Authentification Cron invalide." });
  }
  const githubToken = process.env.GITHUB_DATA_SYNC_TOKEN;
  if (!githubToken) {
    return response.status(503).json({ error: "Configurez GITHUB_DATA_SYNC_TOKEN dans les variables d’environnement Vercel." });
  }

  const repository = process.env.GITHUB_DATA_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = process.env.GITHUB_DATA_BRANCH || DEFAULT_BRANCH;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w./-]+$/.test(branch)) {
    return response.status(500).json({ error: "Configuration du dépôt GitHub invalide." });
  }

  try {
    const retrievedAt = new Date().toISOString();
    const [archive, currentFile] = await Promise.all([
      fetchInternationalResults(),
      githubRequest(
        `https://api.github.com/repos/${repository}/contents/${ARCHIVE_PATH}?ref=${encodeURIComponent(branch)}`,
        githubToken
      )
    ]);

    const previous = deploymentArchive;
    const origin = deploymentOrigin();
    const previousInternational = previous.api_snapshots?.international || {};
    const previousInterclubs = previous.api_snapshots?.interclubs || {};
    const previousCombinedSnapshot = {
      source: previousInternational.source || previousInterclubs.source || "/api/international-matches",
      providers: previousInternational.providers || previousInterclubs.providers || ["football-data.org", "TheSportsDB"],
      fetched_at: previousInternational.fetched_at || previousInterclubs.fetched_at || null,
      last_success_at: previousInternational.last_success_at || previousInterclubs.last_success_at || null,
      status: previousInternational.status === "stale" || previousInterclubs.status === "stale" ? "stale" : "ok",
      warnings: [...(previousInternational.warnings || []), ...(previousInterclubs.warnings || [])],
      provider_updated_at: previousInternational.provider_updated_at || previousInterclubs.provider_updated_at || null,
      matches: [
        ...(Array.isArray(previousInternational.matches) ? previousInternational.matches : []),
        ...(Array.isArray(previousInterclubs.matches) ? previousInterclubs.matches : [])
      ]
    };
    const [internationalSnapshot, leopardsSnapshot] = await Promise.all([
      fetchApiSnapshot(origin, "/api/international-matches", previousCombinedSnapshot, retrievedAt),
      fetchApiSnapshot(origin, "/api/leopards-matches", previous.api_snapshots?.leopards, retrievedAt)
    ]);
    const international = splitInternationalMatches(internationalSnapshot);
    const payload = {
      ...archive,
      schema_version: 2,
      updated_at: retrievedAt,
      api_snapshots: {
        international: {
          source: international.source,
          source_url: "https://www.football-data.org/",
          providers: ["football-data.org"],
          fetched_at: international.fetched_at,
          last_success_at: international.last_success_at,
          attempted_at: international.attempted_at || retrievedAt,
          status: international.status,
          error: international.error || null,
          warnings: international.warnings,
          provider_updated_at: international.provider_updated_at,
          matches: international.international
        },
        interclubs: {
          source: international.source,
          source_url: "https://www.thesportsdb.com/",
          providers: ["TheSportsDB"],
          fetched_at: international.fetched_at,
          last_success_at: international.last_success_at,
          attempted_at: international.attempted_at || retrievedAt,
          status: international.status,
          error: international.error || null,
          warnings: international.warnings,
          provider_updated_at: international.provider_updated_at,
          matches: international.interclubs
        },
        leopards: {
          source: leopardsSnapshot.source,
          source_url: "https://www.thesportsdb.com/",
          providers: ["TheSportsDB"],
          fetched_at: leopardsSnapshot.fetched_at,
          last_success_at: leopardsSnapshot.last_success_at,
          attempted_at: leopardsSnapshot.attempted_at || retrievedAt,
          status: leopardsSnapshot.status,
          error: leopardsSnapshot.error || null,
          warnings: leopardsSnapshot.warnings,
          provider_updated_at: leopardsSnapshot.provider_updated_at,
          matches: leopardsSnapshot.matches
        }
      }
    };
    const serialized = `${JSON.stringify(payload)}\n`;
    const blob = Buffer.from(serialized, "utf8");
    const content = blob.toString("base64");
    const gitBlobSha = crypto.createHash("sha1")
      .update(`blob ${blob.length}\0`)
      .update(blob)
      .digest("hex");
    if (currentFile?.sha === gitBlobSha) {
      return response.status(200).json({
        status: "unchanged",
        matches: archive.matches.length,
        updated_through: archive.updated_through,
        api_snapshots: Object.fromEntries(
          Object.entries(payload.api_snapshots).map(([key, snapshot]) => [key, {
            status: snapshot.status,
            matches: snapshot.matches.length
          }])
        )
      });
    }

    const committed = await githubRequest(
      `https://api.github.com/repos/${repository}/contents/${ARCHIVE_PATH}`,
      githubToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Met à jour les données sportives (${retrievedAt.slice(0, 10)})`,
          content,
          branch,
          ...(currentFile?.sha ? { sha: currentFile.sha } : {})
        })
      }
    );
    const hasStaleSources = Object.values(payload.api_snapshots).some((snapshot) => snapshot.status !== "ok");
    return response.status(200).json({
      status: hasStaleSources ? "updated_with_stale_sources" : "updated",
      commit: committed?.commit?.sha || null,
      matches: archive.matches.length,
      updated_through: archive.updated_through,
      api_snapshots: Object.fromEntries(
        Object.entries(payload.api_snapshots).map(([key, snapshot]) => [key, {
          status: snapshot.status,
          matches: snapshot.matches.length
        }])
      )
    });
  } catch (error) {
    console.error("Sports data synchronization failed.", error);
    return response.status(500).json({ error: "La synchronisation des données sportives a échoué.", detail: error.message });
  }
};

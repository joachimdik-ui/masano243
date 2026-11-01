const { listFirst, normalizeEvent, request: requestTheSportsDB } = require("../lib/thesportsdb");

const normalizeMatch = (match) => ({
  id: `international-${match.id}`,
  details_provider: "football-data",
  provider_id: match.id,
  equipe_domicile: match.homeTeam?.name || "Équipe à confirmer",
  equipe_visiteur: match.awayTeam?.name || "Équipe à confirmer",
  home_team_id: match.homeTeam?.id ?? null,
  away_team_id: match.awayTeam?.id ?? null,
  logo_domicile: match.homeTeam?.crest || "",
  logo_visiteur: match.awayTeam?.crest || "",
  score_domicile: match.score?.fullTime?.home ?? null,
  score_visiteur: match.score?.fullTime?.away ?? null,
  statut: match.status,
  competition: match.competition?.name || "Football international",
  date_match: match.utcDate || null,
  minute: match.minute ?? null,
  stade: match.venue || "",
  arbitre: Array.isArray(match.referees)
    ? match.referees.map((referee) => referee.name).filter(Boolean).join(", ")
    : "",
  buteurs: Array.isArray(match.goals) ? match.goals.map((goal) => ({
    minute: goal.minute ?? null,
    minute_additionnelle: goal.injuryTime ?? null,
    joueur: goal.scorer?.name || "",
    passeur: goal.assist?.name || "",
    equipe: goal.team?.name || ""
  })) : []
});

const configuredIds = (value, defaults) => {
  const parsed = String(value || defaults).split(",").map((id) => id.trim()).filter(Boolean);
  return [...new Set(parsed.filter((id) => /^\d{1,12}$/.test(id)))];
};

const fetchCongoleseClubMatches = async () => {
  const teamIds = new Set(configuredIds(
    process.env.THESPORTSDB_CONGOLESE_CLUB_IDS,
    "138139,141051,139093,141056"
  ));
  const leagueIds = configuredIds(
    process.env.THESPORTSDB_CLUB_COMPETITION_IDS,
    "4720,5057"
  );
  const warnings = [];
  const requests = leagueIds.flatMap((leagueId) => [
    { endpoint: "eventsnextleague.php", key: "events", leagueId },
    { endpoint: "eventspastleague.php", key: "results", leagueId }
  ]);
  const eventLists = await Promise.all(requests.map(async ({ endpoint, key, leagueId }) => {
    try {
      const payload = await requestTheSportsDB(endpoint, { id: leagueId });
      return listFirst(payload, [key, key === "events" ? "results" : "events"]);
    } catch (error) {
      console.error(`TheSportsDB ${endpoint} (${leagueId}) request failed.`, error);
      warnings.push(`${endpoint}:${leagueId}`);
      return [];
    }
  }));
  const seen = new Set();
  const matches = eventLists.flat()
    .filter((event) => (
      teamIds.has(String(event.idHomeTeam || ""))
      || teamIds.has(String(event.idAwayTeam || ""))
    ))
    .filter((event) => {
      if (!event.idEvent || seen.has(String(event.idEvent))) return false;
      seen.add(String(event.idEvent));
      return true;
    })
    .map((event) => ({
      ...normalizeEvent(event, "international"),
      competition_category: "interclubs"
    }));
  return { matches, warnings };
};

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "Configurez FOOTBALL_DATA_API_KEY dans les variables d’environnement Vercel." });
  }

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 2);
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + 5);
  const dateFrom = from.toISOString().slice(0, 10);
  const dateTo = to.toISOString().slice(0, 10);
  const url = `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;

  try {
    const upstream = await fetch(url, { headers: { "X-Auth-Token": apiKey } });
    if (!upstream.ok) {
      console.error("football-data.org returned", upstream.status);
      return response.status(502).json({ error: "Le fournisseur des scores internationaux est momentanément indisponible." });
    }
    const payload = await upstream.json();
    if (!Array.isArray(payload.matches)) {
      console.error("football-data.org returned an invalid matches response.");
      return response.status(502).json({ error: "Réponse invalide du fournisseur des scores internationaux." });
    }
    const clubFixtures = await fetchCongoleseClubMatches();
    const internationalMatches = payload.matches.map(normalizeMatch);
    const existing = new Set(internationalMatches.map((match) => (
      `${String(match.date_match || "").slice(0, 10)}|${match.equipe_domicile.toLowerCase()}|${match.equipe_visiteur.toLowerCase()}`
    )));
    const clubMatches = clubFixtures.matches.filter((match) => !existing.has(
      `${String(match.date_match || "").slice(0, 10)}|${match.equipe_domicile.toLowerCase()}|${match.equipe_visiteur.toLowerCase()}`
    ));
    response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=300");
    return response.status(200).json({
      matches: [...internationalMatches, ...clubMatches],
      warnings: clubFixtures.warnings,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("International scores request failed.", error);
    return response.status(502).json({ error: "Impossible de joindre le fournisseur des scores internationaux." });
  }
};

const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);

const normalizeMatch = (match) => {
  const status = match.fixture?.status?.short;
  const homeScore = match.goals?.home;
  const awayScore = match.goals?.away;

  return {
    id: `api-football-${match.fixture.id}`,
    details_provider: "api-football",
    provider_id: match.fixture.id,
    source: "international",
    competition: match.league?.name || "Football international",
    equipe_domicile: match.teams?.home?.name || "Équipe à confirmer",
    equipe_visiteur: match.teams?.away?.name || "Équipe à confirmer",
    logo_domicile: match.teams?.home?.logo || "",
    logo_visiteur: match.teams?.away?.logo || "",
    home_team_id: match.teams?.home?.id ?? null,
    away_team_id: match.teams?.away?.id ?? null,
    score_domicile: homeScore === null || homeScore === undefined ? null : Number(homeScore),
    score_visiteur: awayScore === null || awayScore === undefined ? null : Number(awayScore),
    statut: LIVE_STATUSES.has(status) ? "live" : FINISHED_STATUSES.has(status) ? "finished" : "upcoming",
    ...(typeof match.fixture?.status?.elapsed === "number" ? { minute: match.fixture.status.elapsed } : {}),
    date_match: match.fixture?.date || "",
    stade: match.fixture?.venue?.name || "",
    arbitre: match.fixture?.referee || "",
    league_id: match.league?.id ?? null,
    season: match.league?.season ?? null
  };
};

const normalizeFootballDataMatch = (match) => ({
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

const isDomesticRdcMatch = (match) => {
  const country = String(match.league?.country || "").trim().toLowerCase();
  const competition = String(match.league?.name || "").toLowerCase();
  const isRdc = ["dr congo", "congo dr", "democratic republic of the congo"].includes(country);
  return isRdc && !/\bcaf\b/.test(competition);
};

const fetchFixturesPage = async (params, page, apiKey) => {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  const upstream = await fetch(`https://v3.football.api-sports.io/fixtures?${query}`, {
    headers: { "x-apisports-key": apiKey }
  });
  if (!upstream.ok) {
    console.error("API-Football international fixtures returned", upstream.status);
    throw new Error("Le fournisseur des matchs internationaux est momentanément indisponible.");
  }

  const payload = await upstream.json();
  if (payload.errors && Object.keys(payload.errors).length > 0) {
    console.error("API-Football international fixtures reported an API error.", payload.errors);
    throw new Error("Le fournisseur des matchs internationaux a retourné une erreur.");
  }
  if (!Array.isArray(payload.response)) {
    console.error("API-Football returned an invalid international fixtures response.");
    throw new Error("Réponse invalide du fournisseur des matchs internationaux.");
  }
  return payload;
};

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }

  const apiKey = process.env.API_FOOTBALL_API_KEY;
  if (!apiKey) {
    const footballDataKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!footballDataKey) {
      return response.status(503).json({ error: "Configurez API_FOOTBALL_API_KEY dans les variables d’environnement Vercel." });
    }

    const today = new Date();
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 2);
    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() + 5);
    const params = new URLSearchParams({
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10)
    });

    try {
      const upstream = await fetch(`https://api.football-data.org/v4/matches?${params}`, {
        headers: { "X-Auth-Token": footballDataKey }
      });
      if (!upstream.ok) {
        console.error("football-data.org returned", upstream.status);
        return response.status(502).json({ error: "Le fournisseur des scores internationaux est momentanément indisponible." });
      }

      const payload = await upstream.json();
      if (!Array.isArray(payload.matches)) {
        console.error("football-data.org returned an invalid matches response.");
        return response.status(502).json({ error: "Réponse invalide du fournisseur des scores internationaux." });
      }
      response.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=30");
      return response.status(200).json({
        matches: payload.matches.map(normalizeFootballDataMatch),
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error("football-data.org international fixtures request failed.", error);
      return response.status(502).json({ error: "Impossible de joindre le fournisseur des matchs internationaux." });
    }
  }

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 2);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 5);
  const params = new URLSearchParams({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    timezone: "UTC"
  });

  try {
    const firstPage = await fetchFixturesPage(params, 1, apiKey);
    const totalPages = Number(firstPage.paging?.total);
    const fixtures = [...firstPage.response];
    if (Number.isInteger(totalPages) && totalPages > 1) {
      for (let page = 2; page <= totalPages; page += 1) {
        const nextPage = await fetchFixturesPage(params, page, apiKey);
        fixtures.push(...nextPage.response);
      }
    }

    const matches = fixtures
      .filter((match) => !isDomesticRdcMatch(match))
      .map(normalizeMatch);
    response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    return response.status(200).json({ matches, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error("International API-Football fixtures request failed.", error);
    return response.status(502).json({ error: error.message || "Impossible de joindre le fournisseur des matchs internationaux." });
  }
};

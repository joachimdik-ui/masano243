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
    competition_category: "leopards",
    competition: match.league?.name || "Sélection nationale de la RDC",
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

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }

  const apiKey = process.env.API_FOOTBALL_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "Configurez API_FOOTBALL_API_KEY dans les variables d’environnement Vercel." });
  }

  const teamId = Number(process.env.API_FOOTBALL_TEAM_ID || 12);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return response.status(500).json({ error: "API_FOOTBALL_TEAM_ID doit être un identifiant d’équipe valide." });
  }

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 14);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 365);
  const params = new URLSearchParams({
    team: String(teamId),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  });

  try {
    const upstream = await fetch(`https://v3.football.api-sports.io/fixtures?${params}`, {
      headers: { "x-apisports-key": apiKey }
    });
    if (!upstream.ok) {
      console.error("API-Football returned", upstream.status);
      return response.status(502).json({ error: "Le fournisseur des matchs des Léopards est momentanément indisponible." });
    }

    const payload = await upstream.json();
    if (payload.errors && Object.keys(payload.errors).length > 0) {
      console.error("API-Football reported an API error.", payload.errors);
      return response.status(502).json({ error: "Le fournisseur des matchs des Léopards a retourné une erreur." });
    }
    if (!Array.isArray(payload.response)) {
      console.error("API-Football returned an invalid fixtures response.");
      return response.status(502).json({ error: "Réponse invalide du fournisseur des matchs des Léopards." });
    }

    const matches = payload.response
      .filter((match) => match.teams?.home?.id === teamId || match.teams?.away?.id === teamId)
      .map(normalizeMatch);
    response.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=30");
    return response.status(200).json({ matches, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error("Leopards fixtures request failed.", error);
    return response.status(502).json({ error: "Impossible de joindre le fournisseur des matchs des Léopards." });
  }
};

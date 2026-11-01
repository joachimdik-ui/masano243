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
    response.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=30");
    if (!Array.isArray(payload.matches)) {
      console.error("football-data.org returned an invalid matches response.");
      return response.status(502).json({ error: "Réponse invalide du fournisseur des scores internationaux." });
    }
    return response.status(200).json({
      matches: payload.matches.map(normalizeMatch),
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("International scores request failed.", error);
    return response.status(502).json({ error: "Impossible de joindre le fournisseur des scores internationaux." });
  }
};

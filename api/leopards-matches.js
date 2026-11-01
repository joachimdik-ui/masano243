const { list, normalizeEvent, request } = require("../lib/thesportsdb");

module.exports = async function handler(requestObject, response) {
  if (requestObject.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }

  const teamId = Number(process.env.THESPORTSDB_LEOPARDS_TEAM_ID || 136475);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return response.status(500).json({ error: "THESPORTSDB_LEOPARDS_TEAM_ID doit être un identifiant TheSportsDB valide." });
  }

  const warnings = [];
  const loadEvents = async (endpoint, key) => {
    try {
      return list(await request(endpoint, { id: teamId }), key);
    } catch (error) {
      console.error(`TheSportsDB ${endpoint} des Léopards a échoué.`, error);
      warnings.push(endpoint);
      return [];
    }
  };

  const [upcoming, recent] = await Promise.all([
    loadEvents("eventsnext.php", "events"),
    loadEvents("eventslast.php", "results")
  ]);
  if (!upcoming.length && !recent.length && warnings.length) {
    return response.status(502).json({ error: "Impossible de charger le calendrier des Léopards depuis TheSportsDB." });
  }

  const seen = new Set();
  const matches = [...upcoming, ...recent]
    .filter((event) => {
      if (!event.idEvent || seen.has(String(event.idEvent))) return false;
      seen.add(String(event.idEvent));
      return String(event.idHomeTeam) === String(teamId) || String(event.idAwayTeam) === String(teamId);
    })
    .map((event) => normalizeEvent(event, "leopards"))
    .sort((first, second) => new Date(first.date_match) - new Date(second.date_match));

  response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=300");
  return response.status(200).json({ matches, warnings, updated_at: new Date().toISOString() });
};

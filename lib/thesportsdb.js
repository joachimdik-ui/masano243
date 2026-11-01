const API_BASE = "https://www.thesportsdb.com/api/v1/json/123";

const request = async (endpoint, params = {}) => {
  const url = new URL(`${API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TheSportsDB ${endpoint} a répondu HTTP ${response.status}.`);
  return response.json();
};

const list = (payload, key) => {
  const value = payload?.[key];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Réponse TheSportsDB invalide (${key}).`);
  return value;
};

const listFirst = (payload, keys) => {
  const key = keys.find((candidate) => payload?.[candidate] !== undefined);
  return key ? list(payload, key) : [];
};

const numeric = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeEvent = (event, source = "international") => {
  const status = String(event.strStatus || event.strProgress || "").toUpperCase();
  const scores = [numeric(event.intHomeScore), numeric(event.intAwayScore)];
  const isLive = /\b(1H|HT|2H|ET|BT|LIVE|IN PLAY|IN PROGRESS|HALF TIME|1ST HALF|2ND HALF)\b/.test(status);
  const isFinished = /\b(FT|AET|PEN|FINISHED|FULL TIME|MATCH FINISHED)\b/.test(status)
    || (!isLive && scores.every((score) => score !== null)
      && new Date(event.strTimestamp || event.dateEvent || "").getTime() < Date.now());

  return {
    id: `thesportsdb-${event.idEvent}`,
    details_provider: "thesportsdb",
    provider_id: numeric(event.idEvent) ?? event.idEvent,
    source,
    ...(source === "leopards" ? { competition_category: "leopards" } : {}),
    competition: event.strLeague || "Football",
    equipe_domicile: event.strHomeTeam || "Équipe à confirmer",
    equipe_visiteur: event.strAwayTeam || "Équipe à confirmer",
    logo_domicile: event.strHomeTeamBadge || "",
    logo_visiteur: event.strAwayTeamBadge || "",
    home_team_id: numeric(event.idHomeTeam),
    away_team_id: numeric(event.idAwayTeam),
    score_domicile: scores[0],
    score_visiteur: scores[1],
    statut: isLive ? "live" : isFinished ? "finished" : "upcoming",
    date_match: event.strTimestamp || [event.dateEvent, event.strTime].filter(Boolean).join("T"),
    stade: event.strVenue || "",
    arbitre: event.strOfficial || "",
    league_id: numeric(event.idLeague),
    season: event.strSeason || null
  };
};

module.exports = { list, listFirst, normalizeEvent, numeric, request };

import { supabase } from "../supabaseClient.js";

const text = (value, fallback = "") => typeof value === "string" ? value : fallback;

const normalizeStatus = (status) => {
  const value = String(status || "").trim().toLowerCase();
  if (["live", "in_play", "in play", "en cours", "en direct", "paused", "pause", "mi-temps"].includes(value)) return "live";
  if (["finished", "ft", "terminé", "termine", "completed", "après prolongation", "apres prolongation"].includes(value)) return "finished";
  return "upcoming";
};

const normalizeCompetition = (competition) => {
  const name = text(competition).trim();
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const isLinafoot = /linafoot/.test(normalized);
  const category = /basket|coupe rdc/.test(normalized)
    ? "basketball"
    : isLinafoot && /(?:^|[^a-z0-9])(?:l2|ligue\s*2|division\s*2)(?:$|[^a-z0-9])/.test(normalized)
      ? "linafoot_l2"
      : isLinafoot && /(?:^|[^a-z0-9])(?:l1|ligue\s*1|division\s*1)(?:$|[^a-z0-9])/.test(normalized)
        ? "linafoot_l1"
        : isLinafoot || /rdc|congo/.test(normalized)
          ? "local_other"
          : "international";
  return { name: name || "Compétition à confirmer", category };
};

const normalizeTeamName = (team) => String(team || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export const isLeopardsMatch = (home, away) => [home, away].some((team) => {
  const name = normalizeTeamName(team);
  return [
    "congo dr",
    "congo dem rep",
    "congo dem republic",
    "dr congo",
    "congo democratic republic",
    "congo democratic republic of",
    "congo democratic republic of the",
    "democratic republic congo",
    "democratic republic of congo",
    "democratic republic of the congo",
    "rd congo",
    "rdc",
    "les leopards"
  ].includes(name);
});

export const normalizeMatch = (match, source = "local") => {
  const leagueName = match.ligue === "L1" ? "Linafoot Ligue 1" : match.ligue === "L2" ? "Linafoot Ligue 2" : "";
  const competitionName = text(leagueName || match.competition || match.competition_nom || match.league || match.competition_name);
  const competition = normalizeCompetition(competitionName);
  const home = text(match.equipe_domicile || match.club_domicile?.nom || match.equipe_home || match.home_team || match.domicile);
  const away = text(match.equipe_visiteur || match.club_visiteur?.nom || match.equipe_away || match.away_team || match.visiteur);
  const isLeopards = source === "international" && isLeopardsMatch(home, away);
  const homeScore = match.score_domicile ?? match.score_home ?? match.home_score;
  const awayScore = match.score_visiteur ?? match.score_away ?? match.away_score;
  const date = match.date_match || match.date || match.kickoff || match.utcDate || "";
  const homeLogo = match.club_domicile?.logo_url || match.logo_domicile || match.homeTeam?.crest || "";
  const awayLogo = match.club_visiteur?.logo_url || match.logo_visiteur || match.awayTeam?.crest || "";

  return {
    id: String(match.id ?? `${source}-${date}-${home}-${away}`),
    equipe_domicile: home || "Équipe à confirmer",
    equipe_visiteur: away || "Équipe à confirmer",
    logo_domicile: text(homeLogo),
    logo_visiteur: text(awayLogo),
    score_domicile: homeScore === null || homeScore === undefined ? null : Number(homeScore),
    score_visiteur: awayScore === null || awayScore === undefined ? null : Number(awayScore),
    statut: normalizeStatus(match.statut || match.status),
    competition: competition.name,
    competition_category: isLeopards ? "leopards" : competition.category,
    date_match: date,
    minute: match.minute ?? match.elapsed ?? null,
    ligue: match.ligue || null,
    groupe: match.groupe || null,
    journee: match.journee ?? null,
    stade: match.stade || "",
    arbitre: text(match.arbitre || match.referee || match.fixture?.referee),
    resume_video_url: text(match.resume_video_url || match.video_url || match.highlights_url),
    resume_video_thumbnail: text(match.resume_video_thumbnail || match.video_thumbnail_url || match.thumbnail_url || match.highlights_thumbnail_url),
    details_provider: text(match.details_provider),
    provider_id: match.provider_id ?? null,
    home_team_id: match.home_team_id ?? null,
    away_team_id: match.away_team_id ?? null,
    league_id: match.league_id ?? null,
    season: match.season ?? null,
    buteurs: Array.isArray(match.buteurs) ? match.buteurs : [],
    club_domicile_id: match.club_domicile_id || null,
    club_visiteur_id: match.club_visiteur_id || null,
    source
  };
};

export const fetchMatchDetails = async (matchId) => {
  const response = await fetch(`/api/match-details?id=${encodeURIComponent(matchId)}`);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `Détails du match indisponibles (HTTP ${response.status}).`);
  }
  const details = await response.json();
  if (!details || !Array.isArray(details.events) || !Array.isArray(details.scorers)) {
    throw new Error("Réponse invalide de l’API de détails des matchs.");
  }
  return details;
};

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

export const fetchLocalMatchDetails = async (match) => {
  if (!supabase) throw new Error("Client Supabase non configuré.");
  if (!isUuid(match.id)) throw new Error("Identifiant Supabase du match invalide.");

  const eventsRequest = supabase
    .from("match_events")
    .select("id, club_id, type, minute, minute_additionnelle, joueur, passeur, detail, ordre, club:clubs!match_events_club_id_fkey(nom)")
    .eq("match_id", match.id)
    .order("minute", { ascending: true, nullsFirst: false })
    .order("minute_additionnelle", { ascending: true, nullsFirst: false })
    .order("ordre", { ascending: true });
  const lineupsRequest = supabase
    .from("match_lineups")
    .select("id, club_id, formation, entraineur")
    .eq("match_id", match.id);
  const hasClubIds = isUuid(match.club_domicile_id) && isUuid(match.club_visiteur_id);
  let historyRequest;
  if (hasClubIds) {
    const homeId = match.club_domicile_id;
    const awayId = match.club_visiteur_id;
    historyRequest = supabase
      .from("matchs")
      .select("id, date_match, competition, equipe_domicile, equipe_visiteur, score_domicile, score_visiteur")
      .neq("id", match.id)
      .in("statut", ["finished", "Terminé"])
      .not("score_domicile", "is", null)
      .not("score_visiteur", "is", null)
      .or(`and(club_domicile_id.eq.${homeId},club_visiteur_id.eq.${awayId}),and(club_domicile_id.eq.${awayId},club_visiteur_id.eq.${homeId})`)
      .order("date_match", { ascending: false })
      .limit(5);
  }

  const [eventsResult, lineupsResult, historyResult] = await Promise.all([
    eventsRequest,
    lineupsRequest,
    historyRequest || Promise.resolve({ data: [], error: null })
  ]);
  for (const result of [eventsResult, lineupsResult, historyResult]) {
    if (result.error) throw result.error;
  }

  const eventRows = eventsResult.data || [];
  const eventTeamName = (clubId, fallback = "") => {
    if (clubId && clubId === match.club_domicile_id) return match.equipe_domicile;
    if (clubId && clubId === match.club_visiteur_id) return match.equipe_visiteur;
    return fallback;
  };
  const scorers = eventRows
    .filter((event) => ["goal", "but", "penalty", "own_goal", "but_contre"].includes(event.type))
    .map((event) => ({
      elapsed: event.minute,
      extra: event.minute_additionnelle,
      type: "goal",
      team: eventTeamName(event.club_id, event.club?.nom || ""),
      player: event.joueur || "",
      assist: event.passeur || "",
      detail: event.detail || ""
    }));
  const lineupRows = lineupsResult.data || [];
  const lineupIds = lineupRows.map((lineup) => lineup.id);
  let players = [];
  if (lineupIds.length) {
    const { data, error } = await supabase
      .from("match_lineup_players")
      .select("lineup_id, nom, numero, position, est_remplacant, ordre")
      .in("lineup_id", lineupIds)
      .order("est_remplacant", { ascending: true })
      .order("ordre", { ascending: true });
    if (error) throw error;
    players = data || [];
  }
  const lineupFor = (clubId) => {
    const lineup = lineupRows.find((item) => item.club_id === clubId);
    if (!lineup) return null;
    return {
      formation: lineup.formation || "",
      coach: lineup.entraineur || "",
      players: players.filter((player) => player.lineup_id === lineup.id).map((player) => ({
        name: player.nom,
        number: player.numero,
        position: player.position || "",
        substitute: player.est_remplacant
      }))
    };
  };
  const hasFinalScore = match.statut === "finished"
    && Number.isInteger(match.score_domicile)
    && Number.isInteger(match.score_visiteur);
  const hasGoals = scorers.length > 0;

  return {
    venue: match.stade || "",
    referee: match.arbitre || "",
    events: eventRows.map((event) => ({
      elapsed: event.minute,
      extra: event.minute_additionnelle,
      type: event.type === "goal" || event.type === "but" || event.type === "penalty" || event.type === "own_goal" || event.type === "but_contre"
        ? "goal"
        : event.type === "booking" || event.type === "card" || event.type === "yellow_card" || event.type === "red_card"
          ? "booking"
          : event.type === "substitution" || event.type === "subst"
            ? "substitution"
            : event.type,
      team: eventTeamName(event.club_id, event.club?.nom || ""),
      player: event.joueur || "",
      assist: event.passeur || "",
      detail: event.detail || ""
    })),
    scorers,
    scorers_status: hasGoals
      ? "available"
      : hasFinalScore && match.score_domicile + match.score_visiteur === 0
        ? "none"
        : hasFinalScore
          ? "unavailable"
          : "pending",
    lineups: {
      home: lineupFor(match.club_domicile_id),
      away: lineupFor(match.club_visiteur_id)
    },
    history: (historyResult.data || []).map((item) => ({
      date: item.date_match || "",
      competition: item.competition || "",
      home: item.equipe_domicile || "",
      away: item.equipe_visiteur || "",
      home_score: item.score_domicile,
      away_score: item.score_visiteur
    })),
    rankings: [],
    highlights_url: match.resume_video_url || "",
    highlights_thumbnail_url: match.resume_video_thumbnail || "",
    warnings: []
  };
};

export const fetchMatchsLocaux = async () => {
  if (!supabase) throw new Error("Client Supabase non configuré.");
  const { data, error } = await supabase
    .from("matchs")
    .select(`
      *,
      club_domicile:clubs!matchs_club_domicile_id_fkey(logo_url),
      club_visiteur:clubs!matchs_club_visiteur_id_fkey(logo_url)
    `);
  if (error) throw error;
  return (data || []).map((match) => normalizeMatch(match, "local"));
};

export const fetchMatchsEpfKin = async () => {
  if (!supabase) throw new Error("Client Supabase non configuré.");
  const { data, error } = await supabase
    .from("epf_kin_matches")
    .select(`
      id, date_match, saison, journee, serie, stade, statut,
      score_domicile, score_visiteur,
      club_domicile:epf_kin_clubs!epf_kin_matches_club_domicile_id_fkey(nom, logo_url),
      club_visiteur:epf_kin_clubs!epf_kin_matches_club_visiteur_id_fkey(nom, logo_url)
    `)
    .eq("saison", "2026-2027")
    .order("date_match", { ascending: true });

  if (error) throw error;
  return (data || []).map((match) => ({
    ...normalizeMatch({
      ...match,
      competition: `Championnat EPF-KIN 2026-2027 · Série ${match.serie}`,
      equipe_domicile: match.club_domicile?.nom || "",
      equipe_visiteur: match.club_visiteur?.nom || ""
    }, "epf_kin"),
    competition_category: "epf_kin",
    serie: match.serie,
    source: "epf_kin"
  }));
};

export const fetchEpfKinStandings = async (saison, serie) => {
  if (!["A", "B", "C"].includes(serie)) throw new Error("Série EPF-KIN invalide.");
  if (!supabase) throw new Error("Client Supabase non configuré.");
  const { data, error } = await supabase
    .from("epf_kin_standings")
    .select("position, club_id, nom, logo_url, joues, victoires, nuls, defaites, buts_pour, buts_contre, difference_buts, points")
    .eq("saison", saison)
    .eq("serie", serie)
    .order("position", { ascending: true });

  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    equipe: row.nom,
    competition: `Championnat EPF-KIN ${saison}`,
    club: { id: row.club_id, nom: row.nom, logo_url: row.logo_url }
  }));
};

export const fetchEpfKinTopScorers = async (saison, serie = null, limit = 20) => {
  if (serie !== null && !["A", "B", "C"].includes(serie)) throw new Error("Série EPF-KIN invalide.");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("La limite du classement des buteurs doit être un entier positif.");
  if (!supabase) throw new Error("Client Supabase non configuré.");
  let query = supabase
    .from("epf_kin_top_scorers")
    .select("id, nom, club_id, club, logo_url, saison, serie, buts, penaltys, matches_joues")
    .eq("saison", saison)
    .order("buts", { ascending: false })
    .order("penaltys", { ascending: true })
    .order("nom", { ascending: true })
    .order("serie", { ascending: true })
    .order("club", { ascending: true })
    .limit(limit);
  if (serie) query = query.eq("serie", serie);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    club: { id: row.club_id, nom: row.club, logo_url: row.logo_url }
  }));
};

export const fetchMatchsInternationaux = async () => {
  const response = await fetch("/api/international-matches");
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `API internationale indisponible (HTTP ${response.status}).`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.matches)) throw new Error("Réponse invalide de l’API internationale.");
  return payload.matches.map((match) => normalizeMatch(match, "international"));
};

export const fetchMatchsLeopards = async () => {
  const response = await fetch("/api/leopards-matches");
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `API des Léopards indisponible (HTTP ${response.status}).`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.matches)) throw new Error("Réponse invalide de l’API des Léopards.");
  return payload.matches;
};

const sortStandingsRows = (first, second) => {
  const firstPosition = Number(first.position ?? first.rang ?? Number.NaN);
  const secondPosition = Number(second.position ?? second.rang ?? Number.NaN);
  if (Number.isFinite(firstPosition) && Number.isFinite(secondPosition) && firstPosition !== secondPosition) {
    return firstPosition - secondPosition;
  }
  const firstPoints = Number(first.points ?? first.pts ?? 0);
  const secondPoints = Number(second.points ?? second.pts ?? 0);
  if (firstPoints !== secondPoints) return secondPoints - firstPoints;
  const firstDiff = Number(first.difference_buts ?? first.goal_difference ?? 0);
  const secondDiff = Number(second.difference_buts ?? second.goal_difference ?? 0);
  if (firstDiff !== secondDiff) return secondDiff - firstDiff;
  const firstGoalsFor = Number(first.buts_pour ?? first.goals_for ?? 0);
  const secondGoalsFor = Number(second.buts_pour ?? second.goals_for ?? 0);
  if (firstGoalsFor !== secondGoalsFor) return secondGoalsFor - firstGoalsFor;
  return (Number(first.gagnes ?? first.victoires ?? first.wins ?? 0) - Number(second.gagnes ?? second.victoires ?? second.wins ?? 0)) || 0;
};

export const fetchClassement = async (competition = "", groupe = "") => {
  if (!supabase) throw new Error("Client Supabase non configuré.");
  const { data, error } = await supabase.from("classements").select("*");
  if (error) throw error;
  return (data || [])
    .filter((row) => !competition || text(row.competition) === competition)
    .filter((row) => !groupe || text(row.groupe) === groupe)
    .sort(sortStandingsRows);
};

export const subscribeMatchsLocaux = (onChange) => {
  if (!supabase) throw new Error("Client Supabase non configuré.");
  return supabase
    .channel("public:matchs")
    .on("postgres_changes", { event: "*", schema: "public", table: "matchs" }, onChange)
    .subscribe();
};

export const unsubscribeMatchsLocaux = (channel) => supabase?.removeChannel(channel);
export const subscribeClassementsLocaux = (onChange) => {
  if (!supabase) throw new Error("Client Supabase non configuré.");
  return supabase
    .channel("public:classements")
    .on("postgres_changes", { event: "*", schema: "public", table: "classements" }, onChange)
    .subscribe();
};

export { normalizeCompetition };

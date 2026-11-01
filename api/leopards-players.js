// Fonction serverless Vercel exposée sur /api/leopards-players.
//   GET /api/leopards-players            -> effectif des Léopards
//   GET /api/leopards-players?id=<id>    -> profil et statistiques disponibles d'un joueur
// Source : TheSportsDB. Les données liées à un identifiant API-Football restent sauvegardées dans Supabase.

const { list, listFirst, numeric, request: requestTheSportsDB } = require("../lib/thesportsdb");

const NATIONAL_TEAM_ID = Number(process.env.THESPORTSDB_LEOPARDS_TEAM_ID || 136475);
const positionLabels = {
  goalkeeper: "Gardien",
  defender: "Défenseur",
  midfielder: "Milieu",
  forward: "Attaquant",
  attacker: "Attaquant",
  "centre-forward": "Attaquant"
};
const teamNames = new Set(["dr congo", "congo dr", "democratic republic of the congo"]);

const playerAge = (birthDate) => {
  const birth = new Date(birthDate);
  if (!birthDate || Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  return today.getFullYear() - birth.getFullYear()
    - (today.getMonth() < birth.getMonth()
      || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate()) ? 1 : 0);
};

const isNationalTeamPlayer = (player, teamId) => (
  [player.idTeam, player.idTeam2, player.idTeamNational].some((id) => String(id || "") === String(teamId))
  || [player.strTeam, player.strTeam2].some((name) => teamNames.has(String(name || "").toLowerCase()))
);

const normalizeSquadPlayer = (player) => ({
  id: player.idPlayer,
  thesportsdb_player_id: player.idPlayer,
  api_player_id: numeric(player.idAPIfootball),
  nom: player.strPlayer || "Joueur",
  poste: positionLabels[String(player.strPosition || "").toLowerCase()] || player.strPosition || "",
  numero: numeric(player.strNumber),
  age: playerAge(player.dateBorn),
  date_naissance: player.dateBorn || null,
  photo_url: player.strThumb || player.strCutout || "",
  club: teamNames.has(String(player.strTeam || "").toLowerCase()) ? player.strTeam2 || "" : player.strTeam || "",
  championnat: "",
  source: "thesportsdb"
});

const statValue = (row, aliases) => {
  for (const alias of aliases) {
    const value = numeric(row[alias]);
    if (value !== null) return value;
  }
  return null;
};

const normalizePlayerStats = (rows) => {
  const groups = new Map();
  const statAliases = {
    matchs: ["appearances", "appearance", "apps", "matches played", "games played"],
    minutes: ["minutes", "minutes played", "mins played"],
    buts: ["goals", "goal"],
    passes: ["assists", "assist"],
    note: ["rating", "average rating"]
  };
  const directAliases = {
    matchs: ["intAppearances", "intApps", "intGames"],
    minutes: ["intMinutes"],
    buts: ["intGoals"],
    passes: ["intAssists"],
    note: ["intRating", "strRating"]
  };

  rows.forEach((row) => {
    const season = row.strSeason || "";
    const club = row.strTeam || "";
    const competition = row.strLeague || "";
    const key = `${season}|${club}|${competition}`;
    if (!groups.has(key)) {
      groups.set(key, {
        saison: season,
        club,
        competition,
        matchs: null,
        minutes: null,
        buts: null,
        passes: null,
        note: null
      });
    }
    const group = groups.get(key);
    const statName = String(row.strStatistic || row.strStat || row.strName || "").toLowerCase();
    const value = numeric(row.strValue ?? row.intValue);
    Object.entries(statAliases).forEach(([field, names]) => {
      if (value !== null && names.some((name) => statName.includes(name))) group[field] = value;
      const directValue = statValue(row, directAliases[field]);
      if (directValue !== null) group[field] = directValue;
    });
  });

  return [...groups.values()].filter((row) => (
    row.matchs !== null || row.minutes !== null || row.buts !== null || row.passes !== null || row.note !== null
  ));
};

const normalizeDetails = (entry, statsPayload) => {
  const player = entry.player || {};
  const club = teamNames.has(String(player.strTeam || "").toLowerCase())
    ? player.strTeam2 || ""
    : player.strTeam || player.strTeam2 || "";
  const stats = normalizePlayerStats(list(statsPayload, "playerstats"))
    .filter((row) => row.club && row.club.toLowerCase() === club.toLowerCase());
  const mainClub = stats[0] || {};
  const dateBorn = player.dateBorn || null;

  return {
    player: {
      thesportsdb_player_id: player.idPlayer,
      api_player_id: numeric(player.idAPIfootball),
      nom: player.strPlayer || "",
      age: playerAge(dateBorn),
      date_naissance: dateBorn,
      photo_url: player.strThumb || player.strCutout || "",
      poste: positionLabels[String(player.strPosition || "").toLowerCase()] || player.strPosition || ""
    },
    season: mainClub.saison || null,
    selection: {
      selections: null,
      buts_selection: null,
      passes_selection: null,
      minutes_selection: null,
      cartons_jaunes: null,
      cartons_rouges: null
    },
    club_stats: stats,
    club: mainClub.club || club,
    championnat: mainClub.competition || "",
    source: "thesportsdb",
    stats_available: stats.length > 0
  };
};

// ---- Sauvegarde Supabase (facultative, via l'API REST et la clé service_role) ----
const supabaseUrl = () => (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://cisgavepcswtgnpomlyg.supabase.co").replace(/\/$/, "");

const upsert = async (table, rows, onConflict, returnRows = false) => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !rows.length) return [];
  const result = await fetch(`${supabaseUrl()}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: `resolution=merge-duplicates,return=${returnRows ? "representation" : "minimal"}`
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(4000)
  });
  if (!result.ok) throw new Error(`Supabase ${table} a répondu HTTP ${result.status}.`);
  return returnRows ? result.json() : [];
};

const backupSafely = async (task) => {
  try {
    await task();
  } catch (error) {
    console.error("Sauvegarde Supabase impossible.", error);
  }
};

const backupSquad = (players) => upsert("joueurs_leopards", players
  .filter((player) => player.api_player_id !== null)
  .map((player) => ({
    api_player_id: player.api_player_id,
    nom: player.nom,
    poste: player.poste || null,
    numero: player.numero,
    photo_url: player.photo_url || null,
    actif: true
  })), "api_player_id");

const backupDetails = async (details) => {
  if (details.player.api_player_id === null) return;
  const [row] = await upsert("joueurs_leopards", [{
    api_player_id: details.player.api_player_id,
    nom: details.player.nom,
    poste: details.player.poste || null,
    date_naissance: details.player.date_naissance,
    photo_url: details.player.photo_url || null,
    club: details.club || null,
    championnat: details.championnat || null,
    actif: true
  }], "api_player_id", true);
  if (!row?.id) return;
  await upsert("stats_club_joueurs", details.club_stats.map((stat) => ({
    joueur_id: row.id,
    saison: stat.saison,
    club: stat.club,
    competition: stat.competition,
    matchs: stat.matchs,
    minutes: stat.minutes,
    buts: stat.buts,
    passes: stat.passes,
    note: stat.note
  })), "joueur_id,saison,club,competition");
};

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  const teamId = Number(process.env.THESPORTSDB_LEOPARDS_TEAM_ID || NATIONAL_TEAM_ID);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return response.status(500).json({ error: "THESPORTSDB_LEOPARDS_TEAM_ID doit être un identifiant TheSportsDB valide." });
  }

  const playerId = request.query?.id;
  try {
    if (playerId === undefined) {
      const payload = await requestTheSportsDB("lookup_all_players.php", { id: teamId });
      const players = list(payload, "player")
        .filter((player) => isNationalTeamPlayer(player, teamId))
        .map(normalizeSquadPlayer);
      if (!players.length) return response.status(502).json({ error: "L'effectif des Léopards est vide chez le fournisseur." });
      await backupSafely(() => backupSquad(players));
      response.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=3600");
      return response.status(200).json({ players, source: "thesportsdb", updated_at: new Date().toISOString() });
    }

    if (!/^\d{1,10}$/.test(String(playerId))) {
      return response.status(400).json({ error: "Identifiant de joueur invalide." });
    }
    const entryPayload = await requestTheSportsDB("lookupplayer.php", { id: playerId });
    const [entry] = listFirst(entryPayload, ["players", "player"]);
    if (!entry) return response.status(404).json({ error: "Joueur introuvable chez TheSportsDB." });
    const warnings = [];
    let statsPayload = {};
    try {
      statsPayload = await requestTheSportsDB("lookupplayerstats.php", { id: playerId });
    } catch (error) {
      console.error("TheSportsDB player statistics request failed.", error);
      warnings.push("player-stats");
    }
    const details = normalizeDetails(entry, statsPayload);
    if (details.stats_available) await backupSafely(() => backupDetails(details));
    response.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=3600");
    return response.status(200).json({ ...details, warnings, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error("Requête joueurs TheSportsDB échouée.", error);
    return response.status(502).json({ error: "Impossible de joindre TheSportsDB pour les joueurs des Léopards." });
  }
};
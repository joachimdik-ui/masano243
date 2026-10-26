// Fonction serverless Vercel (à placer à côté de leopards-matches.js, dans le dossier api/).
//   GET /api/leopards-players            -> effectif des Léopards
//   GET /api/leopards-players?id=<api>   -> statistiques d'un joueur (sélection + clubs)
// Source : API-Football. Chaque réponse réussie est sauvegardée dans Supabase (sauvegarde de secours),
// à condition que SUPABASE_SERVICE_ROLE_KEY soit défini côté Vercel.

const API_BASE = "https://v3.football.api-sports.io";
const POSITIONS = { Goalkeeper: "Gardien", Defender: "Défenseur", Midfielder: "Milieu", Attacker: "Attaquant" };

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const currentSeason = () => {
  const forced = Number(process.env.API_FOOTBALL_SEASON);
  if (Number.isInteger(forced) && forced > 2000) return forced;
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
};

const apiGet = async (path, params, apiKey) => {
  const upstream = await fetch(`${API_BASE}${path}?${new URLSearchParams(params)}`, {
    headers: { "x-apisports-key": apiKey }
  });
  if (!upstream.ok) throw new Error(`API-Football a répondu HTTP ${upstream.status}.`);
  const payload = await upstream.json();
  if (payload.errors && Object.keys(payload.errors).length > 0) {
    throw new Error(`API-Football a signalé une erreur : ${JSON.stringify(payload.errors)}`);
  }
  if (!Array.isArray(payload.response)) throw new Error("Réponse invalide d'API-Football.");
  return payload.response;
};

const normalizeSquadPlayer = (player) => ({
  id: player.id,
  api_player_id: player.id,
  nom: player.name || "Joueur",
  poste: POSITIONS[player.position] || player.position || "",
  numero: player.number ?? null,
  age: player.age ?? null,
  photo_url: player.photo || "",
  club: "",
  source: "api"
});

const normalizeDetails = (entry, teamId, season) => {
  const statistics = Array.isArray(entry.statistics) ? entry.statistics : [];
  const national = statistics.filter((item) => item.team?.id === teamId);
  const clubs = statistics.filter((item) => item.team?.id !== teamId && number(item.games?.appearences) > 0);
  const sum = (items, read) => items.reduce((total, item) => total + number(read(item)), 0);
  const mainClub = [...clubs].sort((a, b) => number(b.games?.minutes) - number(a.games?.minutes))[0];
  const rawPosition = (mainClub || national[0] || statistics[0])?.games?.position;

  return {
    player: {
      api_player_id: entry.player?.id,
      nom: entry.player?.name || "",
      age: entry.player?.age ?? null,
      date_naissance: entry.player?.birth?.date || null,
      photo_url: entry.player?.photo || "",
      poste: POSITIONS[rawPosition] || rawPosition || ""
    },
    season,
    selection: {
      selections: sum(national, (item) => item.games?.appearences),
      buts_selection: sum(national, (item) => item.goals?.total),
      passes_selection: sum(national, (item) => item.goals?.assists),
      minutes_selection: sum(national, (item) => item.games?.minutes),
      cartons_jaunes: sum(national, (item) => item.cards?.yellow),
      cartons_rouges: sum(national, (item) => item.cards?.red)
    },
    club_stats: clubs.map((item) => ({
      saison: String(season),
      club: item.team?.name || "",
      club_logo: item.team?.logo || "",
      competition: item.league?.name || "",
      matchs: number(item.games?.appearences),
      minutes: number(item.games?.minutes),
      buts: number(item.goals?.total),
      passes: number(item.goals?.assists),
      note: item.games?.rating ? Number(Number.parseFloat(item.games.rating).toFixed(1)) : null
    })),
    club: mainClub?.team?.name || "",
    championnat: mainClub?.league?.name || "",
    source: "api"
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

const backupSquad = (players) => upsert("joueurs_leopards", players.map((player) => ({
  api_player_id: player.api_player_id,
  nom: player.nom,
  poste: player.poste || null,
  numero: player.numero,
  photo_url: player.photo_url || null,
  actif: true
})), "api_player_id");

const backupDetails = async (details) => {
  const [row] = await upsert("joueurs_leopards", [{
    api_player_id: details.player.api_player_id,
    nom: details.player.nom,
    poste: details.player.poste || null,
    date_naissance: details.player.date_naissance,
    photo_url: details.player.photo_url || null,
    club: details.club || null,
    championnat: details.championnat || null,
    ...details.selection,
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
  const apiKey = process.env.API_FOOTBALL_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "Configurez API_FOOTBALL_API_KEY dans les variables d’environnement Vercel." });
  }
  const teamId = Number(process.env.API_FOOTBALL_TEAM_ID || 12);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return response.status(500).json({ error: "API_FOOTBALL_TEAM_ID doit être un identifiant d’équipe valide." });
  }

  const playerId = request.query?.id;
  try {
    if (playerId === undefined) {
      const [squad] = await apiGet("/players/squads", { team: String(teamId) }, apiKey);
      const players = (squad?.players || []).map(normalizeSquadPlayer);
      if (!players.length) return response.status(502).json({ error: "L'effectif des Léopards est vide chez le fournisseur." });
      await backupSafely(() => backupSquad(players));
      response.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=3600");
      return response.status(200).json({ players, source: "api", updated_at: new Date().toISOString() });
    }

    if (!/^\d{1,10}$/.test(String(playerId))) {
      return response.status(400).json({ error: "Identifiant de joueur invalide." });
    }
    let season = currentSeason();
    let [entry] = await apiGet("/players", { id: String(playerId), season: String(season) }, apiKey);
    if (!entry?.statistics?.length) {
      season -= 1;
      [entry] = await apiGet("/players", { id: String(playerId), season: String(season) }, apiKey);
    }
    if (!entry) return response.status(404).json({ error: "Joueur introuvable chez le fournisseur." });
    const details = normalizeDetails(entry, teamId, season);
    await backupSafely(() => backupDetails(details));
    response.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=3600");
    return response.status(200).json({ ...details, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error("Requête joueurs des Léopards échouée.", error);
    return response.status(502).json({ error: "Impossible de joindre le fournisseur des joueurs des Léopards." });
  }
};
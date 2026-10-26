import { supabase } from "../supabaseClient.js";

// Source principale : API-Football via la fonction Vercel /api/leopards-players.
// Secours : tables Supabase (joueurs_leopards, stats_club_joueurs), alimentées automatiquement par la fonction.
const PLAYERS_ENDPOINT = "/api/leopards-players";

const requireClient = () => {
  if (!supabase) throw new Error("Supabase n'est pas configuré.");
  return supabase;
};

const requestJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Le service des joueurs a répondu HTTP ${response.status}.`);
  return response.json();
};

const fetchPlayersFromDatabase = async () => {
  const { data, error } = await requireClient()
    .from("joueurs_leopards")
    .select("*")
    .eq("actif", true)
    .order("nom", { ascending: true });
  if (error) throw error;
  return (data || []).map((row) => ({ ...row, source: "database" }));
};

export const fetchLeopardsPlayers = async () => {
  try {
    const payload = await requestJson(PLAYERS_ENDPOINT);
    if (!Array.isArray(payload.players) || !payload.players.length) throw new Error("Effectif vide.");
    return payload.players;
  } catch (error) {
    console.warn("API des joueurs indisponible, utilisation de la sauvegarde Supabase.", error);
    return fetchPlayersFromDatabase();
  }
};

const fetchDetailsFromDatabase = async (player) => {
  const client = requireClient();
  const query = client.from("joueurs_leopards").select("*");
  const { data: row, error } = await (player.source === "database"
    ? query.eq("id", player.id)
    : query.eq("api_player_id", player.api_player_id)).maybeSingle();
  if (error) throw error;
  if (!row) {
    return { player: {}, season: null, selection: {}, club_stats: [], club: "", championnat: "", source: "database" };
  }
  const { data: stats, error: statsError } = await client
    .from("stats_club_joueurs")
    .select("*")
    .eq("joueur_id", row.id)
    .order("saison", { ascending: false })
    .order("minutes", { ascending: false });
  if (statsError) throw statsError;
  return {
    player: { age: null, date_naissance: row.date_naissance, poste: row.poste },
    season: stats?.[0]?.saison ?? null,
    selection: {
      selections: row.selections,
      buts_selection: row.buts_selection,
      passes_selection: row.passes_selection,
      minutes_selection: row.minutes_selection,
      cartons_jaunes: row.cartons_jaunes,
      cartons_rouges: row.cartons_rouges
    },
    club_stats: stats || [],
    club: row.club || "",
    championnat: row.championnat || "",
    source: "database"
  };
};

const hasData = (details) => Boolean(details.club_stats?.length || details.selection?.selections);

// Statistiques d'un joueur : API d'abord, sauvegarde Supabase si l'API échoue ou ne renvoie rien.
export const fetchPlayerDetails = async (player) => {
  let apiDetails = null;
  if (player.api_player_id) {
    try {
      apiDetails = await requestJson(`${PLAYERS_ENDPOINT}?id=${encodeURIComponent(player.api_player_id)}`);
      if (hasData(apiDetails)) return apiDetails;
    } catch (error) {
      console.warn("API des statistiques indisponible, utilisation de la sauvegarde Supabase.", error);
    }
  }
  try {
    const stored = await fetchDetailsFromDatabase(player);
    if (hasData(stored) || !apiDetails) return stored;
  } catch (error) {
    if (!apiDetails) throw error;
  }
  return apiDetails;
};
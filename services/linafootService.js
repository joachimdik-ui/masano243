import { supabase } from "../supabaseClient.js";

const requireSupabase = () => {
  if (!supabase) throw new Error("Client Supabase non configuré.");
  return supabase;
};

export const getMatchsByLigueAndGroupe = async (ligue, groupe) => {
  if (!["L1", "L2"].includes(ligue)) throw new Error("Ligue invalide : sélectionnez L1 ou L2.");
  if (!["A", "B", "C"].includes(groupe) || (groupe === "C" && ligue !== "L2")) {
    throw new Error("Groupe invalide pour la ligue sélectionnée.");
  }

  const { data, error } = await requireSupabase()
    .from("matchs")
    .select(`
      id, created_at, ligue, groupe, journee, stade, date_match,
      club_domicile_id, club_visiteur_id, score_domicile, score_visiteur, statut,
      club_domicile:clubs!matchs_club_domicile_id_fkey(id, nom, sigle, logo_url),
      club_visiteur:clubs!matchs_club_visiteur_id_fkey(id, nom, sigle, logo_url)
    `)
    .eq("ligue", ligue)
    .eq("groupe", groupe)
    .order("date_match", { ascending: false });

  if (error) throw error;
  return data || [];
};

const sortStandingsRows = (first, second) => {
  const firstPosition = Number(first.position ?? Number.NaN);
  const secondPosition = Number(second.position ?? Number.NaN);
  if (Number.isFinite(firstPosition) && Number.isFinite(secondPosition) && firstPosition !== secondPosition) {
    return firstPosition - secondPosition;
  }
  const firstPoints = Number(first.points ?? 0);
  const secondPoints = Number(second.points ?? 0);
  if (firstPoints !== secondPoints) return secondPoints - firstPoints;
  const firstDiff = Number(first.difference_buts ?? 0);
  const secondDiff = Number(second.difference_buts ?? 0);
  if (firstDiff !== secondDiff) return secondDiff - firstDiff;
  const firstGoalsFor = Number(first.buts_pour ?? 0);
  const secondGoalsFor = Number(second.buts_pour ?? 0);
  if (firstGoalsFor !== secondGoalsFor) return secondGoalsFor - firstGoalsFor;
  return 0;
};

export const getClassement = async (ligue, groupe) => {
  if (!["L1", "L2"].includes(ligue)) throw new Error("Ligue invalide : sélectionnez L1 ou L2.");
  if (!["A", "B", "C"].includes(groupe) || (groupe === "C" && ligue !== "L2")) {
    throw new Error("Groupe invalide pour la ligue sélectionnée.");
  }

  const { data, error } = await requireSupabase()
    .from("classements")
    .select(`
      id, club_id, ligue, groupe, competition, equipe, position,
      joues, gagnes, victoires, nuls, defaites,
      buts_pour, buts_contre, difference_buts, points,
      club:clubs!classements_club_id_fkey(id, nom, sigle, logo_url)
    `)
    .eq("ligue", ligue)
    .eq("groupe", groupe)
    .order("points", { ascending: false })
    .order("difference_buts", { ascending: false })
    .order("buts_pour", { ascending: false });

  if (error) throw error;
  return (data || []).sort(sortStandingsRows);
};

export const fetchTopButeurs = async (ligue, limit = 20) => {
  if (!["L1", "L2"].includes(ligue)) throw new Error("Ligue invalide : sélectionnez L1 ou L2.");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("La limite du classement des buteurs doit être un entier positif.");

  const { data, error } = await requireSupabase()
    .from("buteurs")
    .select(`
      id, nom, club_id, ligue, buts, penaltys, matches_joues,
      club:clubs!buteurs_club_id_fkey(nom, sigle, logo_url)
    `)
    .eq("ligue", ligue)
    .order("buts", { ascending: false })
    .order("penaltys", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
};

export const subscribeButeurs = (callback) => {
  return requireSupabase()
    .channel("public:buteurs")
    .on("postgres_changes", { event: "*", schema: "public", table: "buteurs" }, callback)
    .subscribe();
};

export const unsubscribeButeurs = (channel) => requireSupabase().removeChannel(channel);

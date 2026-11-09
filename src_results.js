import {
  fetchClassement,
  fetchEpfKinStandings,
  fetchEpfKinTopScorers,
  fetchLocalMatchDetails,
  fetchMatchDetails,
  fetchMatchsEpfKin,
  fetchMatchsInternationaux,
  fetchMatchsLeopards,
  fetchMatchsLocaux,
  normalizeCompetition,
  subscribeClassementsLocaux,
  subscribeMatchsLocaux,
  unsubscribeMatchsLocaux
} from "./services/sportsService.js";
import {
  fetchTopButeurs,
  getClassement,
  subscribeButeurs,
  unsubscribeButeurs
} from "./services/linafootService.js";
import { supabase } from "./supabaseClient.js";
// Chargé à la demande (import dynamique) : si ce fichier manque ou échoue, seul l'onglet « Joueurs »
// est touché, jamais le reste du site (articles, scores, boutons).
const loadPlayersService = () => import("./services/leopardsPlayersService.js");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[character]));

const formatKickoff = (date) => {
  if (!date) return "Heure à confirmer";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? escapeHtml(date)
    : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(parsed);
};

const formatKickoffParts = (date) => {
  const parsed = date ? new Date(date) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return {
    time: new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(parsed),
    day: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(parsed).replace(".", "")
  };
};

const formatMatchDate = (date) => {
  if (!date) return "Date à confirmer";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? String(date)
    : new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parsed);
};

const matchStatusLabel = (match) => {
  if (match.statut === "live") return match.minute ? `${match.minute}'` : "En cours";
  if (match.statut === "finished") return "Terminé";
  return formatKickoff(match.date_match);
};

const renderTeamMark = (team, logo, clickable = false) => {
  const initials = escapeHtml(team.slice(0, 1).toUpperCase());
  const attributes = clickable
    ? ` role="button" tabindex="0" data-club-filter="${escapeHtml(team)}" aria-label="Voir les matchs de ${escapeHtml(team)}" title="Voir les matchs de ${escapeHtml(team)}"`
    : ' aria-hidden="true"';
  return `<span class="team-mark"${attributes}><span class="team-mark-fallback"${logo ? " hidden" : ""}>${initials}</span>${logo ? `<img class="club-logo" src="${escapeHtml(logo)}" alt="" loading="lazy">` : ""}</span>`;
};

// Attributs d'un nom de club cliquable (classements, buteurs) : ouvre ses matchs.
const clubLinkAttrs = (team) => ` role="button" tabindex="0" data-club-open="${escapeHtml(team)}" aria-label="Voir les matchs de ${escapeHtml(team)}" title="Voir les matchs de ${escapeHtml(team)}"`;

const renderClubLogo = (team, logo) => {
  const initials = escapeHtml(team.slice(0, 1).toUpperCase());
  return `<span class="club-logo-slot" aria-hidden="true"><span class="club-logo-placeholder"${logo ? " hidden" : ""}>${initials}</span>${logo ? `<img class="club-logo" src="${escapeHtml(logo)}" alt="" loading="lazy">` : ""}</span>`;
};

const renderMatch = (match, { clubFilter = false } = {}) => {
  const sourceLabel = match.source === "local"
    ? (match.competition_category === "linafoot_l2" ? "Linafoot L2" : "Linafoot L1")
    : match.source === "epf_kin"
      ? `EPF-KIN · Série ${match.serie}`
      : ({
        leopards: "Léopards",
        interclubs: "Interclubs (CAF)",
        basketball: "Basketball",
        judo: "Judo",
        omnisports: "Omnisports"
      }[match.competition_category] || "International");
  const isLive = match.statut === "live";
  const hasScore = match.score_domicile !== null && match.score_visiteur !== null;
  const score = hasScore
    ? `<strong class="match-score">${match.score_domicile}<span>–</span>${match.score_visiteur}</strong>`
    : (() => {
      const parts = formatKickoffParts(match.date_match);
      return parts
        ? `<strong class="match-kickoff"><span class="ko-time">${parts.time}</span><small class="ko-date">${escapeHtml(parts.day)}</small></strong>`
        : `<strong class="match-kickoff">${formatKickoff(match.date_match)}</strong>`;
    })();

  return `<article class="match-card${isLive ? " is-live" : ""}" data-match-id="${escapeHtml(match.id)}" data-match-detail="${escapeHtml(match.id)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Détails du match : ${escapeHtml(match.equipe_domicile)} contre ${escapeHtml(match.equipe_visiteur)}">
    <div class="match-card-top">
      <span class="source-badge ${match.source === "local" || match.source === "epf_kin" ? "source-local" : "source-international"}">${sourceLabel}</span>
      <span class="match-competition">${escapeHtml(match.competition)}</span>
      ${isLive ? `<span class="live-match-badge"><span class="live-pulse" aria-hidden="true"></span>${escapeHtml(matchStatusLabel(match))}</span>` : `<span class="match-status">${escapeHtml(matchStatusLabel(match))}</span>`}
    </div>
    <div class="match-teams">
      <div class="match-team home-team">${renderTeamMark(match.equipe_domicile, match.logo_domicile, clubFilter)}<strong>${escapeHtml(match.equipe_domicile)}</strong></div>
      <div class="match-result">${score}</div>
      <div class="match-team away-team">${renderTeamMark(match.equipe_visiteur, match.logo_visiteur, clubFilter)}<strong>${escapeHtml(match.equipe_visiteur)}</strong></div>
    </div>
  </article>`;
};

const EMPTY_EVENTS_MESSAGE = "Aucun événement n'est disponible pour le moment.";
const EMPTY_DATA_MESSAGE = "Aucune donnée n'est disponible pour le moment.";
const EMPTY_PLAYERS_MESSAGE = "Aucun joueur n'est disponible pour le moment.";

const normalizeSearch = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim();

const formatStat = (value) => {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? "—" : String(number);
};

const playerAge = (birthDate) => {
  const birth = new Date(birthDate);
  if (!birthDate || Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthGap = now.getMonth() - birth.getMonth();
  if (monthGap < 0 || (monthGap === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
};

const PLAYER_POSITIONS = [
  ["gardien", "Gardiens"],
  ["defenseur", "Défenseurs"],
  ["milieu", "Milieux"],
  ["attaquant", "Attaquants"]
];

const playerPositionKey = (position) => {
  const normalized = normalizeSearch(position);
  return PLAYER_POSITIONS.find(([key]) => normalized.startsWith(key))?.[0] || "autre";
};

const renderPlayerAvatar = (player, extraClass = "") => {
  const name = player.nom || "Joueur";
  const initials = escapeHtml(name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase());
  return `<span class="player-avatar ${extraClass}" aria-hidden="true"><span class="player-avatar-fallback"${player.photo_url ? " hidden" : ""}>${initials}</span>${player.photo_url ? `<img class="player-avatar-img" src="${escapeHtml(player.photo_url)}" alt="" loading="lazy">` : ""}</span>`;
};

const FOOTBALL_CATEGORIES = ["linafoot_l1", "linafoot_l2", "epf_kin", "leopards", "interclubs", "international"];
const FOOTBALL_SCOPES = [
  ["all", "Tout le football"],
  ["linafoot_l1", "Linafoot L1"],
  ["linafoot_l2", "Linafoot L2"],
  ["epf_kin", "EPF-KIN"],
  ["leopards", "Léopards"],
  ["interclubs", "Interclubs"],
  ["international", "International"]
];
const SPORT_CHIPS = [
  ["football", "Football"],
  ["basketball", "Basketball"],
  ["judo", "Judo"],
  ["omnisports", "Omnisports"]
];

const MATCH_SKELETONS = '<div class="match-skeleton"></div><div class="match-skeleton"></div><div class="match-skeleton"></div>';

// Derniers matchs chargés : réaffichés instantanément quand on change de page (L1 → L2…), puis actualisés en arrière-plan.
let matchesCache = null;

const scoreOf = (match) => `${match.score_domicile ?? ""}:${match.score_visiteur ?? ""}`;

// ===== Journées (Linafoot, EPF-KIN) =====
// Si la base fournit un numéro de journée, on l'utilise ; sinon on reconstitue les journées par date :
// une nouvelle journée commence quand une équipe rejoue ou après un trou de plus de 4 jours.
const ROUND_FIELDS = ["journee", "numero_journee", "journee_numero", "matchday", "round"];
const ROUND_GAP_MS = 4 * 24 * 60 * 60 * 1000;
const PENDING_GRACE_MS = 36 * 60 * 60 * 1000;
const teamKey = (name) => normalizeSearch(name);
const matchTime = (match) => {
  if (!match.date_match) return null;
  const time = new Date(match.date_match).getTime();
  return Number.isFinite(time) ? time : null;
};
const roundNumberOf = (match) => {
  for (const field of ROUND_FIELDS) {
    const raw = match[field];
    if (raw === null || raw === undefined || raw === "") continue;
    const parsed = Number.parseInt(String(raw).replace(/\D+/g, ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
};
const byDateAsc = (a, b) => (matchTime(a) ?? Infinity) - (matchTime(b) ?? Infinity);

// Rencontres : clé locale "YYYY-MM-DD" d'un timestamp + libellé français du jour.
const DAY_MS = 24 * 60 * 60 * 1000;
const dayKeyOf = (time) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const formatDayKey = (key) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${key}T12:00:00`));
const activeDayKey = () => selectedDayKey || dayKeyOf(Date.now() + selectedDayOffset * DAY_MS);

const buildRounds = (items) => {
  if (!items.length) return [];
  let rounds;
  if (items.every((match) => roundNumberOf(match) !== null)) {
    const byNumber = new Map();
    items.forEach((match) => {
      const number = roundNumberOf(match);
      if (!byNumber.has(number)) byNumber.set(number, { number, matches: [] });
      byNumber.get(number).matches.push(match);
    });
    rounds = [...byNumber.values()].sort((a, b) => a.number - b.number);
  } else {
    rounds = [];
    let current = null;
    let seen = new Set();
    let lastTime = 0;
    items.filter((match) => matchTime(match) !== null).sort(byDateAsc).forEach((match) => {
      const time = matchTime(match);
      const home = teamKey(match.equipe_domicile);
      const away = teamKey(match.equipe_visiteur);
      if (!current || seen.has(home) || seen.has(away) || time - lastTime > ROUND_GAP_MS) {
        current = { number: null, matches: [] };
        rounds.push(current);
        seen = new Set();
      }
      current.matches.push(match);
      seen.add(home);
      seen.add(away);
      lastTime = time;
    });
  }
  rounds.forEach((round) => {
    const times = round.matches.map(matchTime).filter((time) => time !== null);
    round.start = times.length ? Math.min(...times) : null;
    round.end = times.length ? Math.max(...times) : null;
  });
  return rounds;
};

// La « journée suivante » est la première qui contient encore un match à jouer ou en direct ;
// la « journée précédente » est celle qui la précède. Un match en retard jamais mis à jour n'empêche pas d'avancer.
const pickRoundWindow = (rounds, now = Date.now()) => {
  if (!rounds.length) return [];
  const isPending = (match) => match.statut === "live"
    || (match.statut !== "finished" && (matchTime(match) ?? -Infinity) >= now - PENDING_GRACE_MS);
  const pivot = rounds.findIndex((round) => round.matches.some(isPending));
  if (pivot === -1) return [{ round: rounds[rounds.length - 1], role: "previous" }];
  const picked = [];
  if (pivot > 0) picked.push({ round: rounds[pivot - 1], role: "previous" });
  picked.push({ round: rounds[pivot], role: rounds[pivot].matches.some((match) => match.statut === "finished") ? "current" : "next" });
  return picked;
};

const formatRoundRange = (round) => {
  if (round.start === null) return "";
  const day = (time) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(time));
  const first = day(round.start);
  const last = day(round.end);
  return first === last ? first : `${first} – ${last}`;
};

const roundTitle = ({ round, role }) => {
  const label = { previous: "Journée précédente", current: "Journée en cours", next: "Journée suivante" }[role];
  const parts = [label];
  if (round.number) parts.push(`J${round.number}`);
  const range = formatRoundRange(round);
  if (range) parts.push(range);
  return parts.join(" · ");
};

export const mountResults = (root, competitionPage = null) => {
  if (!root) return () => {};
  root.dataset.initialized = "true";

  const controller = new AbortController();
  const { signal } = controller;
  root.addEventListener("error", (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && (image.classList.contains("club-logo") || image.classList.contains("player-avatar-img"))) {
      image.hidden = true;
      const fallback = image.previousElementSibling;
      if (fallback) fallback.hidden = false;
    }
  }, { capture: true, signal });
  const list = root.querySelector("#matchList");
  const notice = root.querySelector("#resultsNotice");
  const count = root.querySelector("#liveMatchCount");
  const resultsTitle = root.querySelector("#resultsTitle");
  const resultsSubtitle = root.querySelector(".live-center-subtitle");
  const detailPage = document.getElementById("matchDetailPage");
  const detailPageContent = detailPage?.querySelector(".match-detail-page-content");
  const detailModal = detailPage;
  const detailDialog = detailPageContent;
  const matchesTab = root.querySelector("#matchesTab");
  const standingsTab = root.querySelector("#standingsTab");
  const matchesPanel = root.querySelector("#matchesPanel");
  const standingsPanel = root.querySelector("#standingsPanel");
  const topScorersView = root.querySelector("#topScorersView");
  const standingsCompetition = root.querySelector("#standingsCompetition");
  const standingsGroup = root.querySelector("#standingsGroup");
  const standingsContainer = root.querySelector("#standingsContainer");
  const topScorersContainer = root.querySelector("#topScorersContainer");
  const standingsToolbar = root.querySelector(".standings-toolbar");
  const linafootLeague = root.querySelector("#linafootLeague");
  const linafootLeagueLabel = root.querySelector('label[for="linafootLeague"]');
  const linafootGroup = root.querySelector("#linafootGroup");
  const linafootControls = root.querySelector(".linafoot-controls");
  const epfKinControls = root.querySelector("#epfKinControls");
  const epfKinSeries = root.querySelector("#epfKinSeries");
  const disciplineCompetitionControls = root.querySelector("#disciplineCompetitionControls");
  const playersTab = root.querySelector("#playersTab");
  const playersPanel = root.querySelector("#playersPanel");
  const playersContainer = root.querySelector("#playersContainer");
  const playersSearch = root.querySelector("#playersSearch");
  const playersPosition = root.querySelector("#playersPosition");
  const statusFilters = root.querySelector(".match-status-filters");
  const liveFilterButton = root.querySelector('[data-status="live"]');
  const playerModal = document.getElementById("playerModal");
  const playerModalBody = document.getElementById("playerModalBody");
  // live = Live Center ; league / leopards / interclubs / international / events = pages de rubrique
  const layout = competitionPage?.layout || (competitionPage ? "events" : "live");
  const isLiveCenter = layout === "live";
  // « Rencontres » : toutes les rencontres, sport par sport (football = toutes compétitions réunies).
  const isAllLayout = layout === "rencontres";
  root.classList.toggle("is-rencontres", isAllLayout);
  root.classList.toggle("is-live-center", isLiveCenter);
  root.classList.toggle("is-compact", !isLiveCenter);
  const allTabs = [matchesTab, standingsTab, topScorersView, playersTab];
  const markTab = (active) => allTabs.forEach((tab) => {
    const isActive = tab === active;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  const showPanel = (panel) => [matchesPanel, standingsPanel, playersPanel].forEach((item) => { item.hidden = item !== panel; });
  let players = [];
  let playersLoaded = false;
  let playerReturnFocus;
  let activePlayerId;
  let matches = [];
  let standings = [];
  let standingsMode = "teams";
  let competitionFilter = competitionPage?.competition || "linafoot_l1";
  let selectedDisciplineCompetition = "";
  let sportFilter = "football";
  let footballScope = "all";
  let sportSwitchEl = null;
  let dateNavEl = null;
  let standingsSourceSelect = null;
  let statusFilter = "all";
  let clubFilter = null;
  // Rencontres : jour sélectionné (offset -1/0/+1 ou date exacte YYYY-MM-DD)
  let selectedDayOffset = 0;
  let selectedDayKey = null;
  let standingsSource = "l1a";
  // Journées + filtre par club : championnats (Linafoot L1/L2, EPF-KIN) uniquement.
  const roundMode = layout === "league";
  let activeView = "matches";
  let realtimeChannel;
  let standingsChannel;
  let buteursChannel;
  let refreshTimer;
  let stopped = false;
  const previousLocalScores = new Map();
  const recentGoalIds = new Set();
  const matchDetailsCache = new Map();
  let matchDetailReturnFocus;
  let previousPageScrollY = 0;
  let activeDetailMatchId;

  const setDetailRank = (element, position, total) => {
    if (!Number.isFinite(position) || position < 1) {
      element.textContent = "Rang indisponible";
      element.className = "match-rank-badge";
      return;
    }
    element.textContent = `${position}${position === 1 ? "er" : "e"}`;
    const rankClass = position <= 4 ? "is-positive" : total >= 4 && position >= total - 3 ? "is-negative" : "";
    element.className = `match-rank-badge ${rankClass}`;
  };

  const normalizeDetailStandings = (rows) => rows.map((row) => ({
    team_id: row.club?.id ?? row.club_id ?? row.equipe_id ?? null,
    team: row.club?.nom || row.equipe || row.equipe_nom || row.team || row.nom || "",
    logo: row.club?.logo_url || row.logo_url || "",
    group: row.groupe || row.serie || "",
    position: row.position ?? row.rang ?? null,
    played: row.joues ?? row.matches_played ?? null,
    won: row.gagnes ?? row.victoires ?? row.wins ?? null,
    draw: row.nuls ?? row.draws ?? null,
    lost: row.defaites ?? row.losses ?? null,
    goal_difference: row.difference_buts ?? row.goal_difference ?? null,
    points: row.points ?? row.pts ?? null
  }));

  const fetchSupabaseMatchStandings = async (match) => {
    const rows = match.source === "epf_kin"
      ? await fetchEpfKinStandings("2026-2027", match.serie)
      : ["linafoot_l1", "linafoot_l2"].includes(match.competition_category)
        ? await getClassement(match.ligue || (match.competition_category === "linafoot_l2" ? "L2" : "L1"), match.groupe || linafootGroup.value)
        : await fetchClassement(match.competition, match.groupe || "");
    return normalizeDetailStandings(rows);
  };

  const addSupabaseMatchStandings = async (match, details) => {
    try {
      return { ...details, rankings: await fetchSupabaseMatchStandings(match) };
    } catch (error) {
      console.error("Impossible de charger le classement associé au match.", error);
      return { ...details, rankings: [], warnings: [...(details.warnings || []), "standings"] };
    }
  };

  const loadMatchDetails = (match) => {
    if (!matchDetailsCache.has(match.id)) {
      const detailsRequest = match.source === "local"
        ? fetchLocalMatchDetails(match).then((details) => addSupabaseMatchStandings(match, details))
        : match.source === "epf_kin"
          ? addSupabaseMatchStandings(match, {
            venue: match.stade || "",
            referee: "",
            events: [],
            scorers: [],
            scorers_status: "pending",
            lineups: { home: null, away: null },
            history: [],
            rankings: [],
            highlights_url: "",
            highlights_thumbnail_url: "",
            warnings: []
          })
          : fetchMatchDetails(match.id);
      matchDetailsCache.set(match.id, detailsRequest);
    }
    return matchDetailsCache.get(match.id);
  };

  const eventMinuteLabel = (event) => {
    if (!Number.isFinite(event.elapsed)) return "";
    return `${event.elapsed}${Number.isFinite(event.extra) && event.extra > 0 ? `+${event.extra}` : ""}'`;
  };

  const normalizeTeamName = (name) => String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|ac)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .sort()
    .join(" ");

  const renderScorers = (match, scorers, status, loading = false) => {
    const homeElement = detailModal.querySelector("#matchDetailHomeScorers");
    const awayElement = detailModal.querySelector("#matchDetailAwayScorers");
    const statusElement = detailModal.querySelector("#matchDetailScorerText");
    const homeName = normalizeTeamName(match.equipe_domicile);
    const awayName = normalizeTeamName(match.equipe_visiteur);
    const homeScorers = [];
    const awayScorers = [];
    for (const scorer of scorers) {
      const team = normalizeTeamName(scorer.team || scorer.equipe);
      const label = `${scorer.joueur || scorer.player || "Buteur"}${eventMinuteLabel(scorer) ? ` ${eventMinuteLabel(scorer)}` : ""}`;
      if (team && team === homeName) homeScorers.push(label);
      else if (team && team === awayName) awayScorers.push(label);
    }
    homeElement.innerHTML = homeScorers.map((scorer) => `<span>${escapeHtml(scorer)}</span>`).join("");
    awayElement.innerHTML = awayScorers.map((scorer) => `<span>${escapeHtml(scorer)}</span>`).join("");
    const hasScorers = homeScorers.length > 0 || awayScorers.length > 0;
    statusElement.hidden = hasScorers;
    statusElement.textContent = hasScorers
      ? ""
      : loading
        ? "Chargement des buteurs…"
        : status === "none"
          ? "Aucun but inscrit dans ce match."
          : status === "unavailable"
            ? "Le fournisseur n’a pas transmis les noms des buteurs."
            : status === "pending"
              ? "Les buteurs ne sont pas encore disponibles."
              : "Buteurs non renseignés par le fournisseur pour ce match.";
  };

  const renderMatchEvent = (event) => {
    const minute = eventMinuteLabel(event);
    const labels = {
      goal: "But",
      Goal: "But",
      booking: "Carton",
      Card: "Carton",
      substitution: "Remplacement",
      subst: "Remplacement"
    };
    const description = [
      labels[event.type] || event.type || "Événement",
      event.player,
      event.detail,
      event.assist ? `Passe décisive : ${event.assist}` : ""
    ].filter(Boolean).join(" · ");
    return `<li>${minute ? `<strong>${escapeHtml(minute)}</strong> ` : ""}${escapeHtml(description)}${event.team ? ` <span>— ${escapeHtml(event.team)}</span>` : ""}</li>`;
  };

  const renderLineup = (lineup) => {
    if (!lineup) return `<p class="match-detail-empty">Composition non fourni</p>`;
    const players = Array.isArray(lineup.players) ? lineup.players : [];
    return `${lineup.formation ? `<p class="match-detail-formation">Formation : <strong>${escapeHtml(lineup.formation)}</strong></p>` : ""}
      ${lineup.coach ? `<p class="match-detail-coach">Entraîneur : ${escapeHtml(lineup.coach)}</p>` : ""}
      ${players.length ? `<ul class="match-detail-player-list">${players.map((player) => `<li>${player.number === null || player.number === undefined ? "" : `<span>${escapeHtml(player.number)}</span>`}${escapeHtml(player.name || "Joueur")}${player.position ? ` <small>${escapeHtml(player.position)}</small>` : ""}${player.substitute ? ` <small>Remplaçant</small>` : ""}</li>`).join("")}</ul>` : `<p class="match-detail-empty">Aucun joueur communiqué par le fournisseur.</p>`}`;
  };

  const normalizeHistoryTeam = (team) => {
    const normalized = String(team || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return ["congo dr", "congo dem rep", "congo democratic republic", "democratic republic of congo", "democratic republic of the congo", "congo kinshasa", "drc", "zaire"].includes(normalized)
      ? "dr congo"
      : normalized;
  };

  const renderHistory = (history, match) => history.length
    ? history.map((item) => {
      const date = item.date ? formatMatchDate(item.date) : "Date non renseignée";
      const hasScore = item.home_score !== null && item.home_score !== undefined
        && item.away_score !== null && item.away_score !== undefined;
      const isDraw = hasScore && Number(item.home_score) === Number(item.away_score);
      const selectedHome = normalizeHistoryTeam(match.equipe_domicile);
      const recordHome = normalizeHistoryTeam(item.home);
      const recordAway = normalizeHistoryTeam(item.away);
      const selectedHomeWon = hasScore && !isDraw && (
        (recordHome === selectedHome && Number(item.home_score) > Number(item.away_score))
        || (recordAway === selectedHome && Number(item.away_score) > Number(item.home_score))
      );
      const resultClass = !hasScore ? "" : isDraw ? "is-draw" : selectedHomeWon ? "is-home-win" : "is-away-win";
      const resultLabel = !hasScore ? "Score indisponible" : isDraw ? "Match nul" : selectedHomeWon
        ? `Victoire ${match.equipe_domicile}`
        : `Victoire ${match.equipe_visiteur}`;
      return `<li class="match-history-card ${resultClass}">
        <div class="match-history-meta"><time>${escapeHtml(date)}</time>${item.competition ? `<span>${escapeHtml(item.competition)}</span>` : ""}</div>
        <div class="match-history-scoreline"><strong>${escapeHtml(item.home || "Équipe à confirmer")}</strong><span class="match-history-score">${hasScore ? `${escapeHtml(item.home_score)} <i>–</i> ${escapeHtml(item.away_score)}` : "– : –"}</span><strong>${escapeHtml(item.away || "Équipe à confirmer")}</strong></div>
        <span class="match-history-outcome">${escapeHtml(resultLabel)}</span>
      </li>`;
    }).join("")
    : `<li class="match-detail-empty match-history-empty">Aucune confrontation antérieure n’est recensée dans les archives pour ces équipes.</li>`;

  const renderHistorySummary = (summary, match, details) => {
    const played = Number(summary?.played);
    if (!Number.isFinite(played) || played <= 0) {
      return `<div class="match-history-overview is-empty">
        <div><span class="match-history-kicker">HISTORIQUE INTERNATIONAL · MASCULIN</span><h4>Bilan face-à-face</h4>
        <p>Aucune rencontre antérieure entre ces sélections n’est recensée dans l’archive.</p></div>
        <small>Source : ${escapeHtml(details.history_source || "Open Football")} · données jusqu’au ${escapeHtml(details.history_updated_through || "date non renseignée")}.</small>
      </div>`;
    }
    const plural = (count, singular, pluralForm) => `${count} ${count === 1 ? singular : pluralForm}`;
    const toCount = (value) => {
      const count = Number(value);
      return Number.isFinite(count) ? Math.max(0, count) : 0;
    };
    const metrics = [
      { label: `Victoires ${match.equipe_domicile}`, count: toCount(summary.home_wins), className: "is-home" },
      { label: "Matchs nuls", count: toCount(summary.draws), className: "is-draw" },
      { label: `Victoires ${match.equipe_visiteur}`, count: toCount(summary.away_wins), className: "is-away" }
    ];
    return `<div class="match-history-overview">
      <div class="match-history-overview-heading"><div><span class="match-history-kicker">HISTORIQUE INTERNATIONAL · MASCULIN</span><h4>Bilan face-à-face</h4></div><div class="match-history-total"><strong>${played}</strong><span>${plural(played, "match recensé", "matchs recensés")}</span></div></div>
      <div class="match-history-chart" aria-label="Répartition des résultats sur ${played} confrontations">
        ${metrics.map(({ label, count, className }) => {
          const percentage = Math.round(Math.max(0, Math.min(played, count)) / played * 100);
          return `<div class="match-history-meter ${className}">
            <div class="match-history-meter-label"><span>${escapeHtml(label)}</span><strong>${count} <small>${percentage}%</small></strong></div>
            <div class="match-history-meter-track" aria-hidden="true"><span style="width:${percentage}%"></span></div>
          </div>`;
        }).join("")}
      </div>
      <p class="match-history-source">Les ${details.history.length} confrontations les plus récentes sont affichées. Source : ${escapeHtml(details.history_source || "Open Football")} · données jusqu’au ${escapeHtml(details.history_updated_through || "date non renseignée")}.</p>
    </div>`;
  };

  const renderCompetitionStandings = (rankings, match) => {
    if (!rankings.length) {
      return `<p class="match-detail-empty">Le classement de cette compétition n’est pas disponible auprès de l’API pour le moment.</p>`;
    }
    const grouped = rankings.some((row) => row.group);
    const normalizeName = (value) => String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\b(fc|cf|afc|sc|ac)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .sort()
      .join(" ");
    const sortedRankings = [...rankings].sort((first, second) => {
      const groupOrder = String(first.group || "").localeCompare(String(second.group || ""));
      if (groupOrder) return groupOrder;
      const firstPosition = Number(first.position);
      const secondPosition = Number(second.position);
      if (Number.isFinite(firstPosition) && Number.isFinite(secondPosition)) return firstPosition - secondPosition;
      if (Number.isFinite(firstPosition)) return -1;
      if (Number.isFinite(secondPosition)) return 1;
      return String(first.team || "").localeCompare(String(second.team || ""));
    });
    const isMatchTeam = (row, side) => (
      (row.team_id !== null && row.team_id !== undefined
        && String(row.team_id) === String(match[`${side}_team_id`]))
      || normalizeName(row.team) === normalizeName(match[side === "home" ? "equipe_domicile" : "equipe_visiteur"])
    );
    return `<div class="match-detail-standings-scroll"><table class="match-detail-standings">
      <thead><tr><th>#</th>${grouped ? "<th>Groupe</th>" : ""}<th>Équipe</th><th>MJ</th><th>V</th><th>N</th><th>D</th><th>Diff.</th><th>Pts</th></tr></thead>
      <tbody>${sortedRankings.map((row, index) => {
        const team = row.team || "Équipe";
        const position = Number(row.position);
        const rank = Number.isFinite(position) && position > 0 ? position : index + 1;
        const initials = escapeHtml(team.slice(0, 1).toUpperCase());
        const logo = `<span class="match-detail-standings-logo-slot"><span class="match-detail-standings-logo-fallback"${row.logo ? " hidden" : ""}>${initials}</span>${row.logo ? `<img class="club-logo match-detail-standings-logo" src="${escapeHtml(row.logo)}" alt="" loading="lazy">` : ""}</span>`;
        const rowClass = isMatchTeam(row, "home") || isMatchTeam(row, "away") ? "match-detail-standings-match-team" : "";
        return `<tr class="${rowClass}">
          <td><span class="match-detail-standings-position">${rank}</span></td>
          ${grouped ? `<td>${escapeHtml(row.group || "—")}</td>` : ""}
          <th scope="row"><span class="match-detail-standings-team club-link"${clubLinkAttrs(team)}>${logo}<span>${escapeHtml(team)}</span></span></th>
          <td>${formatStandingNumber(row.played)}</td>
          <td>${formatStandingNumber(row.won)}</td>
          <td>${formatStandingNumber(row.draw)}</td>
          <td>${formatStandingNumber(row.lost)}</td>
          <td>${formatStandingNumber(row.goal_difference)}</td>
          <td><strong>${formatStandingNumber(row.points)}</strong></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  };

  const formatStandingNumber = (value) => {
    const number = Number(value);
    return value === null || value === undefined || value === "" || !Number.isFinite(number)
      ? "—"
      : String(number);
  };

  const safeHttpUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, window.location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };

  const videoThumbnailFromUrl = (value) => {
    const safeUrl = safeHttpUrl(value);
    if (!safeUrl) return "";
    try {
      const url = new URL(safeUrl);
      let videoId = "";
      if (url.hostname === "youtu.be" || url.hostname.endsWith(".youtu.be")) {
        videoId = url.pathname.split("/").filter(Boolean)[0] || "";
      } else if (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) {
        videoId = url.searchParams.get("v")
          || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]
          || "";
      }
      return /^[A-Za-z0-9_-]{11}$/.test(videoId)
        ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
        : "";
    } catch {
      return "";
    }
  };

  let matchVideoRequestId = 0;
  const renderMatchHighlights = async (match, details = {}) => {
    const requestId = ++matchVideoRequestId;
    const highlightLink = detailModal.querySelector("#matchDetailHighlightLink");
    const highlightImage = detailModal.querySelector("#matchDetailHighlightImage");
    const fallback = detailModal.querySelector("#matchDetailHighlightFallback");
    const videoUrl = safeHttpUrl(details.highlights_url || match.resume_video_url);
    const action = detailModal.querySelector("#matchDetailHighlightAction");
    highlightLink.hidden = true;
    highlightLink.removeAttribute("href");
    highlightLink.removeAttribute("target");
    delete highlightLink.dataset.tvLiveId;
    highlightImage.hidden = true;
    highlightImage.removeAttribute("src");
    fallback.hidden = true;

    let liveContent = null;
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("tv_contenus")
          .select("id,miniature_url")
          .eq("match_id", String(match.id))
          .eq("type", "direct")
          .eq("statut", "en_direct")
          .eq("publie", true)
          .order("debut", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) console.error("Impossible de vérifier le direct Masano TV lié au match.", error);
        else liveContent = data?.[0] || null;
      } catch (error) {
        console.error("Impossible de vérifier le direct Masano TV lié au match.", error);
      }
    }
    if (requestId !== matchVideoRequestId || activeDetailMatchId !== match.id || detailModal.hidden) return;

    const isLive = Boolean(liveContent);
    const thumbnailUrl = isLive
      ? safeHttpUrl(liveContent.miniature_url)
      : safeHttpUrl(details.highlights_thumbnail_url || details.thumbnail_url || match.resume_video_thumbnail)
        || videoThumbnailFromUrl(videoUrl);
    const displayUrl = isLive ? "#tv" : videoUrl;
    if (!displayUrl) return;

    highlightLink.href = displayUrl;
    if (isLive) {
      highlightLink.dataset.tvLiveId = String(liveContent.id);
      highlightLink.setAttribute("aria-label", `Regarder le match : ${match.equipe_domicile} contre ${match.equipe_visiteur}`);
      action.textContent = "Regarder le match";
    } else {
      highlightLink.target = "_blank";
      highlightLink.setAttribute("rel", "noopener noreferrer");
      highlightLink.setAttribute("aria-label", "Ouvrir le résumé du match");
      action.textContent = "Voir le résumé du match";
    }
    highlightImage.hidden = !thumbnailUrl;
    if (thumbnailUrl) highlightImage.src = thumbnailUrl;
    fallback.hidden = Boolean(thumbnailUrl);
    fallback.textContent = `${match.equipe_domicile} · ${match.equipe_visiteur}`;
    highlightLink.hidden = false;
  };

  const renderMatchDetails = (match, details) => {
    const venue = details.venue || match.stade;
    detailModal.querySelector("#matchDetailVenue").textContent = venue || "Lieu non renseigné";
    const events = details.events;
    detailModal.querySelector("#matchDetailTimeline").innerHTML = events.length
      ? events.map(renderMatchEvent).join("")
      : `<li class="match-detail-empty">${match.statut === "upcoming" ? "Le match n’a pas encore commencé." : "Les événements chronologiques ne sont pas disponibles pour ce match."}</li>`;
    const scorers = details.scorers.length ? details.scorers : match.buteurs;
    renderScorers(match, scorers, details.scorers_status);
    detailModal.querySelector("#matchDetailHomeLineup").innerHTML = renderLineup(details.lineups?.home);
    detailModal.querySelector("#matchDetailAwayLineup").innerHTML = renderLineup(details.lineups?.away);
    detailModal.querySelector("#matchDetailHistorySummary").innerHTML = renderHistorySummary(details.history_summary, match, details);
    detailModal.querySelector("#matchDetailHistory").innerHTML = renderHistory(details.history, match);
    const standingsPanel = detailModal.querySelector("#matchDetailStandings");
    const standings = Array.isArray(details.rankings) ? details.rankings : [];
    standingsPanel.innerHTML = renderCompetitionStandings(standings, match);
    detailModal.querySelector("#matchDetailStandingsTitle").textContent = `Classement · ${match.competition}`;
    void renderMatchHighlights(match, details);
    const homeRank = detailModal.querySelector("#matchDetailHomeRank");
    const awayRank = detailModal.querySelector("#matchDetailAwayRank");
    const rankings = details.rankings || [];
    const normalizeTeam = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(fc|cf|afc|sc|ac)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).sort().join(" ");
    const homeRanking = rankings.find((row) => row.team_id === match.home_team_id)
      || rankings.find((row) => normalizeTeam(row.team) === normalizeTeam(match.equipe_domicile));
    const awayRanking = rankings.find((row) => row.team_id === match.away_team_id)
      || rankings.find((row) => normalizeTeam(row.team) === normalizeTeam(match.equipe_visiteur));
    if (rankings.length) {
      const total = rankings.length;
      setDetailRank(homeRank, Number(homeRanking?.position), total);
      setDetailRank(awayRank, Number(awayRanking?.position), total);
    } else if (["international", "leopards", "interclubs"].includes(match.competition_category)) {
      setDetailRank(homeRank, null, 0);
      setDetailRank(awayRank, null, 0);
    }
    const warning = detailModal.querySelector("#matchDetailApiNotice");
    warning.hidden = !details.warnings?.length;
    warning.textContent = details.warnings?.length
      ? `Informations indisponibles auprès du fournisseur : ${details.warnings.map((key) => ({
        events: "événements",
        lineups: "compositions",
        "head-to-head": "confrontations",
        standings: "classement",
        "api-football-key-required": "buteurs (clé API-Football à configurer dans Vercel)",
        "api-football-fallback": "buteurs (correspondance API-Football impossible)",
        "goal-scorers": "noms des buteurs",
        "thesportsdb-fallback": "détails TheSportsDB",
        "lookuplineup.php": "compositions (TheSportsDB)",
        "lookuptimeline.php": "chronologie (TheSportsDB)",
        "lookupeventstats.php": "statistiques du match (TheSportsDB)"
      })[key] || key).join(", ")}.`
      : "";
  };

  const openMatchDetail = (match, trigger) => {
    if (!detailModal || !detailDialog) return;
    if (detailModal.hidden) matchDetailReturnFocus = trigger;
    activeDetailMatchId = match.id;
    const standingsTab = detailModal.querySelector("#matchTabStandings");
    standingsTab.hidden = false;
    detailModal.querySelector("#matchDetailStandings").innerHTML = `<p class="match-detail-empty">Chargement du classement…</p>`;
    const homeLogo = detailModal.querySelector("#matchDetailHomeLogo");
    const awayLogo = detailModal.querySelector("#matchDetailAwayLogo");
    const logoMarkup = (name, url) => {
      const initials = escapeHtml(name.slice(0, 1).toUpperCase());
      return `<span aria-hidden="true"${url ? " hidden" : ""}>${initials}</span>${url ? `<img class="match-detail-club-logo" src="${escapeHtml(url)}" alt="" decoding="async" />` : ""}`;
    };
    detailModal.querySelector("#matchDetailTitle").textContent = match.competition;
    detailModal.querySelector("#matchDetailHomeName").textContent = match.equipe_domicile;
    detailModal.querySelector("#matchDetailAwayName").textContent = match.equipe_visiteur;
    homeLogo.innerHTML = logoMarkup(match.equipe_domicile, match.logo_domicile);
    awayLogo.innerHTML = logoMarkup(match.equipe_visiteur, match.logo_visiteur);
    [[homeLogo, match.equipe_domicile], [awayLogo, match.equipe_visiteur]].forEach(([element, name]) => {
      element.classList.add("club-link-logo");
      element.setAttribute("role", "button");
      element.tabIndex = 0;
      element.dataset.clubOpen = name;
      element.setAttribute("aria-label", `Voir les matchs de ${name}`);
      element.title = `Voir les matchs de ${name}`;
    });
    const hasScore = match.score_domicile !== null && match.score_visiteur !== null;
    detailModal.querySelector("#matchDetailScore").textContent = hasScore ? `${match.score_domicile} – ${match.score_visiteur}` : "– : –";
    detailModal.querySelector("#matchDetailStatus").textContent = match.statut === "finished"
      ? "Terminé"
      : match.statut === "live"
        ? (match.minute ? `En cours ${match.minute}'` : "En cours")
        : "À venir";
    detailModal.querySelector("#matchDetailStatus").classList.toggle("is-live", match.statut === "live");
    detailModal.querySelector("#matchDetailDate").textContent = formatMatchDate(match.date_match);
    if (match.source === "epf_kin") {
      setDetailRank(detailModal.querySelector("#matchDetailHomeRank"), null, 0);
      setDetailRank(detailModal.querySelector("#matchDetailAwayRank"), null, 0);
    }
    renderScorers(match, match.buteurs, "unknown", match.source !== "local");
    detailModal.querySelector("#matchDetailTimeline").innerHTML = `<li class="match-detail-empty">${match.statut === "upcoming" ? "Le match n’a pas encore commencé." : "Les événements chronologiques ne sont pas disponibles pour ce match."}</li>`;
    detailModal.querySelector("#matchDetailVenue").textContent = match.stade || "Chargement…";
    detailModal.querySelector("#matchDetailHomeLineupName").textContent = match.equipe_domicile;
    detailModal.querySelector("#matchDetailAwayLineupName").textContent = match.equipe_visiteur;
    detailModal.querySelector("#matchDetailHomeLineup").innerHTML = `<p class="match-detail-empty">Chargement de la composition…</p>`;
    detailModal.querySelector("#matchDetailAwayLineup").innerHTML = `<p class="match-detail-empty">Chargement de la composition…</p>`;
    detailModal.querySelector("#matchDetailHistorySummary").innerHTML = "";
    detailModal.querySelector("#matchDetailHistory").innerHTML = `<li class="match-detail-empty">Chargement des confrontations…</li>`;
    const apiNotice = detailModal.querySelector("#matchDetailApiNotice");
    apiNotice.hidden = true;
    void renderMatchHighlights(match);
    detailModal.querySelectorAll("[data-match-tab]").forEach((tab) => {
      const active = tab.dataset.matchTab === "lineup";
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    detailModal.querySelectorAll("[data-match-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.matchPanel !== "lineup";
    });
    if (detailModal.hidden) previousPageScrollY = window.scrollY;
    document.body.classList.add("has-match-detail-page");
    detailModal.hidden = false;
    detailModal.scrollTop = 0;
    detailDialog.focus();
    void loadMatchDetails(match).then((details) => {
      if (activeDetailMatchId === match.id && !detailModal.hidden) renderMatchDetails(match, details);
    }).catch((error) => {
        matchDetailsCache.delete(match.id);
        if (activeDetailMatchId !== match.id || detailModal.hidden) return;
        console.error("Impossible de charger les détails du match.", error);
        renderScorers(match, [], "unknown");
        detailModal.querySelector("#matchDetailScorerText").textContent = "Détails indisponibles : le fournisseur n’a pas répondu.";
        detailModal.querySelector("#matchDetailHomeRank").textContent = "Classement indisponible";
        detailModal.querySelector("#matchDetailAwayRank").textContent = "Classement indisponible";
        detailModal.querySelector("#matchDetailTimeline").innerHTML = `<li class="match-detail-empty">Impossible de charger les événements du match.</li>`;
        detailModal.querySelector("#matchDetailVenue").textContent = match.stade || "Lieu indisponible";
        detailModal.querySelector("#matchDetailHomeLineup").innerHTML = `<p class="match-detail-empty">Impossible de charger la composition.</p>`;
        detailModal.querySelector("#matchDetailAwayLineup").innerHTML = `<p class="match-detail-empty">Impossible de charger la composition.</p>`;
        detailModal.querySelector("#matchDetailHistorySummary").innerHTML = "";
        detailModal.querySelector("#matchDetailHistory").innerHTML = `<li class="match-detail-empty">Impossible de charger les confrontations.</li>`;
        detailModal.querySelector("#matchDetailStandings").innerHTML = `<p class="match-detail-empty">Impossible de charger le classement de la compétition.</p>`;
        const warning = detailModal.querySelector("#matchDetailApiNotice");
        warning.hidden = false;
        warning.textContent = match.source === "local"
          ? `Détails locaux indisponibles : ${error.message}. Vérifiez que supabase_match_details.sql a été exécuté dans Supabase.`
          : error.message;
      });
  };

  const closeMatchDetail = () => {
    if (!detailModal || detailModal.hidden) return;
    detailModal.hidden = true;
    activeDetailMatchId = null;
    document.body.classList.remove("has-match-detail-page");
    window.scrollTo(0, previousPageScrollY);
    matchDetailReturnFocus?.focus();
  };

  // Les messages techniques ne sont plus affichés aux visiteurs : ils restent dans la console.
  const displayNotice = (messages) => {
    notice.hidden = true;
    notice.textContent = "";
    if (messages.length) console.warn("Live Center :", ...messages);
  };

  const sourceErrorMessage = (source, error) => {
    if (source === "local" && error.code === "PGRST205") {
      return "La table public.matchs n’existe pas encore. Exécutez schema.sql dans le SQL Editor du projet Supabase du site.";
    }
    if (source === "epf_kin" && error.code === "PGRST205") {
      return "Les tables EPF-KIN ne sont pas encore créées. Exécutez supabase_epf_kin.sql dans le SQL Editor Supabase.";
    }
    if (source === "international" && error.message?.includes("API_FOOTBALL_API_KEY")) {
      return "Le flux international n’est pas configuré. Ajoutez API_FOOTBALL_API_KEY dans Vercel → Settings → Environment Variables.";
    }
    if (source === "leopards" && error.message?.includes("API_FOOTBALL_API_KEY")) {
      return "Le flux des Léopards n’est pas configuré. Ajoutez API_FOOTBALL_API_KEY dans Vercel → Settings → Environment Variables.";
    }
    const sourceLabel = { local: "Matchs locaux", international: "Matchs internationaux", leopards: "Matchs des Léopards" }[source];
    return `${sourceLabel} : ${error.message}`;
  };

  const inScope = (match) => {
    const category = match.competition_category;
    if (!isAllLayout) return category === competitionFilter;
    if (sportFilter !== "football") return category === sportFilter;
    return FOOTBALL_CATEGORIES.includes(category) && (footballScope === "all" || category === footballScope);
  };

  function updateSportCounts() {
    if (!sportSwitchEl) return;
    const counts = {
      football: matches.filter((match) => FOOTBALL_CATEGORIES.includes(match.competition_category)).length
    };
    ["basketball", "judo", "omnisports"].forEach((key) => {
      counts[key] = matches.filter((match) => match.competition_category === key).length;
    });
    sportSwitchEl.querySelectorAll("[data-sport-count]").forEach((badge) => {
      const total = counts[badge.dataset.sportCount];
      badge.textContent = total ? String(total) : "";
      badge.hidden = !total;
    });
  }

  function renderScopePills() {
    let buttons;
    if (sportFilter === "football") {
      buttons = FOOTBALL_SCOPES.map(([value, label]) => {
        const selected = value === footballScope;
        const total = matches.filter((match) => (value === "all"
          ? FOOTBALL_CATEGORIES.includes(match.competition_category)
          : match.competition_category === value)).length;
        return `<button type="button" class="competition-filter${selected ? " is-active" : ""}" role="tab" aria-selected="${selected}" data-football-scope="${value}">${label}${total ? `<span class="pill-count">${total}</span>` : ""}</button>`;
      });
    } else {
      const competitions = [...new Set(matches
        .filter((match) => match.competition_category === sportFilter)
        .map((match) => match.competition)
        .filter(Boolean))].sort();
      if (!competitions.includes(selectedDisciplineCompetition)) selectedDisciplineCompetition = "";
      if (!competitions.length) {
        disciplineCompetitionControls.innerHTML = "";
        disciplineCompetitionControls.hidden = true;
        return;
      }
      buttons = ["", ...competitions].map((competition) => {
        const selected = competition === selectedDisciplineCompetition;
        const label = competition || "Toutes les compétitions";
        return `<button type="button" class="competition-filter${selected ? " is-active" : ""}" role="tab" aria-selected="${selected}" data-discipline-competition="${escapeHtml(competition)}">${escapeHtml(label)}</button>`;
      });
    }
    disciplineCompetitionControls.innerHTML = buttons.join("");
    disciplineCompetitionControls.hidden = false;
  }

  const matchesStatusFilter = (match) => (isLiveCenter
    ? match.statut === "live"
    : statusFilter === "all" || match.statut === statusFilter);

  // Page « Rencontres » : pour Linafoot L1/L2 et EPF-KIN, seulement la journée précédente
  // (matchs joués récemment) et la journée suivante, calculées par compétition / groupe / série.
  const LEAGUE_CATEGORIES = ["linafoot_l1", "linafoot_l2", "epf_kin"];
  const leagueWindowIds = () => {
    const groups = new Map();
    matches.forEach((match) => {
      if (!LEAGUE_CATEGORIES.includes(match.competition_category)) return;
      const key = `${match.competition_category}|${match.ligue || ""}|${match.groupe || match.serie || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(match);
    });
    const ids = new Set();
    groups.forEach((items) => {
      const picks = pickRoundWindow(buildRounds(items));
      if (!picks.length) items.forEach((match) => ids.add(match.id));
      picks.forEach(({ round }) => round.matches.forEach((match) => ids.add(match.id)));
    });
    return ids;
  };

  const scopedMatches = () => {
    // Rencontres : seulement les matchs du jour sélectionné.
    const dayKey = isAllLayout ? activeDayKey() : null;
    return matches.filter((match) => {
    if (dayKey) {
      const time = matchTime(match);
      if (time === null || dayKeyOf(time) !== dayKey) return false;
    }
    const matchesCompetition = isLiveCenter || inScope(match);
    const matchesNamedCompetition = !selectedDisciplineCompetition || match.competition === selectedDisciplineCompetition;
    const matchesLeague = isLiveCenter || isAllLayout || match.source !== "local"
      || !match.ligue
      || match.ligue === linafootLeague.value;
    const matchesGroup = isLiveCenter || isAllLayout || match.source !== "local"
      || !match.groupe
      || match.groupe === linafootGroup.value;
    const matchesEpfSeries = isLiveCenter || isAllLayout || match.source !== "epf_kin"
      || match.serie === epfKinSeries.value;
    return matchesCompetition && matchesNamedCompetition && matchesLeague && matchesGroup
      && matchesEpfSeries;
    });
  };

  // Live Center : uniquement les matchs en direct / en cours.
  const filteredMatches = () => scopedMatches().filter(matchesStatusFilter);

  const decorateMatch = (match) => renderMatch(match, { clubFilter: true }).replace(
    `class="match-card${match.statut === "live" ? " is-live" : ""}"`,
    `class="match-card${match.statut === "live" ? " is-live" : ""}${recentGoalIds.has(match.id) ? " goal-flash" : ""}"`
  );

  // Deux journées seulement : la précédente et la suivante (ou en cours).
  const renderRoundView = () => {
    const picks = pickRoundWindow(buildRounds(scopedMatches()));
    if (!picks.length) return null;
    return picks.map((pick) => {
      const items = pick.round.matches.filter(matchesStatusFilter).sort(byDateAsc);
      return items.length
        ? `<h3 class="match-round-title">${escapeHtml(roundTitle(pick))}</h3>${items.map(decorateMatch).join("")}`
        : "";
    }).join("");
  };

  // Périmètre des matchs d'un club selon la page : championnat = sa compétition/ligue ;
  // Rencontres = tout le sport affiché ; Live Center = tous les matchs.
  const clubScope = (match) => {
    if (isLiveCenter) return true;
    if (isAllLayout) {
      return sportFilter === "football"
        ? FOOTBALL_CATEGORIES.includes(match.competition_category)
        : match.competition_category === sportFilter;
    }
    if (!inScope(match)) return false;
    return !roundMode || match.source !== "local" || !match.ligue || match.ligue === linafootLeague.value;
  };

  // Fenêtre (modale) d'un club : matchs suivants et précédents, sans toucher à la liste ni au détail ouvert.
  const ensureClubModal = () => {
    let modal = document.getElementById("clubModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "clubModal";
    modal.className = "club-modal";
    modal.hidden = true;
    modal.innerHTML = `<div class="club-modal-backdrop" data-club-close></div>
      <section class="club-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="clubModalName" tabindex="-1">
        <button type="button" class="club-modal-close" data-club-close aria-label="Fermer">&times;</button>
        <div id="clubModalBody"></div>
      </section>`;
    document.body.appendChild(modal);
    return modal;
  };
  const clubModal = ensureClubModal();
  const clubModalBody = clubModal.querySelector("#clubModalBody");
  let clubModalReturnFocus = null;

  const renderClubModal = (name) => {
    const key = teamKey(name);
    const own = matches.filter((match) => clubScope(match)
      && (teamKey(match.equipe_domicile) === key || teamKey(match.equipe_visiteur) === key));
    const logo = own.map((match) => (teamKey(match.equipe_domicile) === key ? match.logo_domicile : match.logo_visiteur))
      .find(Boolean) || "";
    const upcoming = own.filter((match) => match.statut !== "finished").sort(byDateAsc);
    const played = own.filter((match) => match.statut === "finished").sort((a, b) => -byDateAsc(a, b));
    const summary = own.length
      ? `${played.length} match${played.length > 1 ? "s" : ""} joué${played.length > 1 ? "s" : ""} · ${upcoming.length} à venir`
      : "Aucun match enregistré";
    const section = (title, items) => (items.length
      ? `<h4 class="club-modal-title">${title}</h4><div class="match-list club-modal-list">${items.map((match) => renderMatch(match, { clubFilter: true })).join("")}</div>`
      : "");
    clubModalBody.innerHTML = `<header class="club-modal-header">${renderTeamMark(name, logo)}<div class="club-modal-heading"><h3 id="clubModalName">${escapeHtml(name)}</h3><p>${summary}</p></div></header><div class="club-modal-scroll">${section("Matchs suivants", upcoming)}${section("Matchs précédents", played)}${own.length ? "" : '<p class="results-empty">Aucun match n\u2019est disponible pour ce club pour le moment.</p>'}</div>`;
  };

  const openClubModal = (name, trigger) => {
    if (!name) return;
    if (clubModal.hidden) clubModalReturnFocus = trigger || document.activeElement;
    renderClubModal(name);
    clubModal.hidden = false;
    document.body.classList.add("has-club-modal");
    const dialog = clubModal.querySelector(".club-modal-dialog");
    const scroller = clubModal.querySelector(".club-modal-scroll");
    if (scroller) scroller.scrollTop = 0;
    dialog.focus();
  };

  const closeClubModal = ({ restoreFocus = true } = {}) => {
    if (clubModal.hidden) return;
    clubModal.hidden = true;
    document.body.classList.remove("has-club-modal");
    if (restoreFocus) clubModalReturnFocus?.focus?.();
  };

  clubModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-club-close]")) {
      closeClubModal();
      return;
    }
    const mark = event.target.closest("[data-club-filter]");
    if (mark) {
      event.preventDefault();
      openClubModal(mark.dataset.clubFilter, mark);
      return;
    }
    const trigger = event.target.closest("[data-match-detail]");
    const match = trigger && matches.find((item) => item.id === trigger.dataset.matchDetail);
    if (!match) return;
    const focusTarget = clubModalReturnFocus || trigger;
    closeClubModal({ restoreFocus: false });
    openMatchDetail(match, focusTarget);
  }, { signal });
  clubModal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeClubModal();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const mark = event.target.closest("[data-club-filter]");
    if (mark) {
      event.preventDefault();
      openClubModal(mark.dataset.clubFilter, mark);
      return;
    }
    const trigger = event.target.closest("[data-match-detail]");
    if (trigger && event.target === trigger) {
      event.preventDefault();
      trigger.click();
    }
  }, { signal });

  const renderDisciplineCompetitionTabs = () => {
    if (isAllLayout) {
      renderScopePills();
      return;
    }
    if (!competitionPage?.discipline) {
      disciplineCompetitionControls.hidden = true;
      return;
    }
    const competitions = [...new Set(matches
      .filter((match) => match.competition_category === competitionPage.discipline)
      .map((match) => match.competition)
      .filter(Boolean))].sort();
    if (!competitions.includes(selectedDisciplineCompetition)) selectedDisciplineCompetition = "";
    const options = ["", ...competitions];
    disciplineCompetitionControls.innerHTML = options.map((competition) => {
      const selected = competition === selectedDisciplineCompetition;
      const label = competition || "Toutes les compétitions";
      return `<button type="button" class="competition-filter${selected ? " is-active" : ""}" role="tab" aria-selected="${selected}" data-discipline-competition="${escapeHtml(competition)}">${escapeHtml(label)}</button>`;
    }).join("");
    disciplineCompetitionControls.hidden = false;
  };

  const renderMatches = () => {
    const liveCount = matches.filter((match) => match.statut === "live").length;
    count.textContent = String(liveCount);
    if (isAllLayout) updateSportCounts();
    if (liveFilterButton) {
      const scopeLive = isLiveCenter
        ? liveCount
        : matches.filter((match) => inScope(match) && match.statut === "live").length;
      liveFilterButton.textContent = scopeLive ? `🔴 En direct (${scopeLive})` : "🔴 En direct";
    }
    document.querySelectorAll(".nav-live").forEach((link) => {
      link.classList.toggle("is-live", liveCount > 0);
      link.setAttribute("aria-label", `Live Center, ${liveCount} match${liveCount === 1 ? "" : "s"} en direct`);
    });
    const filtered = filteredMatches();
    if (!filtered.length && loadingMatches) {
      list.innerHTML = MATCH_SKELETONS;
      return;
    }
    if (!filtered.length) {
      if (isAllLayout) {
        const dayLabel = formatDayKey(activeDayKey());
        const daySportSuffix = { football: "", basketball: " de basketball", judo: " de judo", omnisports: " d'omnisports" }[sportFilter] || "";
        list.innerHTML = `<h3 class="match-round-title match-day-title">${escapeHtml(dayLabel)}</h3><p class="results-empty">Aucun match${daySportSuffix} programmé le ${escapeHtml(dayLabel)}.</p>`;
        return;
      }
      const playoffPreview = competitionFilter === "linafoot_l1" && linafootGroup.value === "PO";
      const scopeHasMatches = isLiveCenter
        ? matches.length > 0
        : matches.some(inScope);
      const message = isLiveCenter
        ? "Aucun match ni événement en direct pour le moment."
        : playoffPreview
        ? "Aucun match de play-off programmé pour le moment. Consultez l’onglet Classements pour voir les équipes provisoirement qualifiées."
        : !scopeHasMatches
          ? EMPTY_EVENTS_MESSAGE
          : isLiveCenter && statusFilter === "live"
            ? "Aucun match en direct pour le moment."
            : "Aucun match ne correspond à ces filtres.";
      list.innerHTML = `<p class="results-empty">${message}</p>`;
      return;
    }
    if (roundMode) {
      const roundsHtml = renderRoundView();
      if (roundsHtml !== null) {
        list.innerHTML = roundsHtml || '<p class="results-empty">Aucun match ne correspond à ces filtres pour ces deux journées.</p>';
        openPendingHomeMatch();
        return;
      }
    }
    const dayHeading = isAllLayout ? `<h3 class="match-round-title match-day-title">${escapeHtml(formatDayKey(activeDayKey()))}</h3>` : "";
    list.innerHTML = dayHeading + filtered
      .sort((a, b) => {
        const statusOrder = { live: 0, upcoming: 1, finished: 2 };
        const statusDifference = statusOrder[a.statut] - statusOrder[b.statut];
        if (statusDifference) return statusDifference;
        const dateDifference = new Date(a.date_match || 0) - new Date(b.date_match || 0);
        return a.statut === "finished" ? -dateDifference : dateDifference;
      })
      .map(decorateMatch)
      .join("");
    openPendingHomeMatch();
  };

  // Un match cliqué sur l'accueil (bande « En direct ») s'ouvre directement dans le Live Center.
  const openPendingHomeMatch = () => {
    let pending = "";
    try {
      pending = sessionStorage.getItem("masano-open-match-id") || "";
    } catch (error) {
      console.error("Impossible de lire le match demandé depuis l’accueil.", error);
      return;
    }
    if (!pending) return;
    const [pendingId, requestedAt] = pending.split("|");
    if (!Number.isFinite(Number(requestedAt)) || Date.now() - Number(requestedAt) > 120000) {
      try { sessionStorage.removeItem("masano-open-match-id"); } catch { /* ignoré */ }
      return;
    }
    const pendingMatch = matches.find((item) => String(item.id) === pendingId);
    if (!pendingMatch) return;
    try { sessionStorage.removeItem("masano-open-match-id"); } catch { /* ignoré */ }
    const trigger = [...list.querySelectorAll("[data-match-detail]")]
      .find((element) => element.dataset.matchDetail === String(pendingMatch.id)) || null;
    openMatchDetail(pendingMatch, trigger);
  };

  // Clic (ou Entrée / Espace) sur le logo d'un club : fenêtre avec ses matchs précédents et suivants.
  {
    const handleClubTarget = (event) => {
      const mark = event.target.closest("[data-club-filter]");
      if (!mark) return false;
      event.preventDefault();
      event.stopPropagation();
      openClubModal(mark.dataset.clubFilter, mark);
      return true;
    };
    list.addEventListener("click", handleClubTarget, { capture: true, signal });
    list.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") handleClubTarget(event);
    }, { capture: true, signal });
  }

  if (detailPage && detailPageContent) {
    const highlightImage = detailPage.querySelector("#matchDetailHighlightImage");
    const highlightFallback = detailPage.querySelector("#matchDetailHighlightFallback");
    highlightImage.addEventListener("error", () => {
      highlightImage.hidden = true;
      highlightFallback.hidden = false;
    }, { signal });
    detailPage.addEventListener("error", (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.classList.contains("match-detail-club-logo")) return;
      image.hidden = true;
      if (image.previousElementSibling) image.previousElementSibling.hidden = false;
    }, { capture: true, signal });
    list.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-match-detail]");
      if (!trigger) return;
      const match = matches.find((item) => item.id === trigger.dataset.matchDetail);
      if (match) openMatchDetail(match, trigger);
    }, { signal });
    list.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = event.target.closest("[data-match-detail]");
      if (!trigger) return;
      event.preventDefault();
      const match = matches.find((item) => item.id === trigger.dataset.matchDetail);
      if (match) openMatchDetail(match, trigger);
    }, { signal });
    detailPage.addEventListener("click", (event) => {
      if (event.target.closest("[data-match-detail-close]")) closeMatchDetail();
      const liveLink = event.target.closest("[data-tv-live-id]");
      if (liveLink) {
        try {
          sessionStorage.setItem("masano-tv-pending-content-id", liveLink.dataset.tvLiveId);
        } catch (error) {
          console.error("Impossible de mémoriser le direct Masano TV à ouvrir.", error);
        }
      }
      const tab = event.target.closest("[data-match-tab]");
      if (!tab) return;
      detailPage.querySelectorAll("[data-match-tab]").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
      });
      detailPage.querySelectorAll("[data-match-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.matchPanel !== tab.dataset.matchTab;
      });
    }, { signal });
    detailPageContent.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMatchDetail();
      }
    }, { signal });
  }

  let loadingMatches = false;
  const refreshMatches = async (showSkeletons = false) => {
    if (showSkeletons) {
      loadingMatches = true;
      list.innerHTML = MATCH_SKELETONS;
    }
    // Premier chargement : chaque source s'affiche dès qu'elle répond, sans attendre la plus lente.
    const incremental = showSkeletons;
    const settled = {};
    const messages = [];
    const compose = (final = false) => {
      const next = [];
      if (settled.local?.status === "fulfilled") next.push(...settled.local.value);
      if (settled.epf?.status === "fulfilled") next.push(...settled.epf.value);
      if (settled.international?.status === "fulfilled") {
        next.push(...settled.international.value.filter((match) => (
          match.competition_category !== "leopards" || settled.leopards?.status === "rejected"
        )));
      }
      if (settled.leopards?.status === "fulfilled") next.push(...settled.leopards.value);
      matches = next;
      if (next.length) matchesCache = next;
      renderDisciplineCompetitionTabs();
      renderMatches();
      if (final && (activeView === "standings" || activeView === "scorers")) renderStandings();
    };
    const sources = [
      ["local", fetchMatchsLocaux, "local"],
      ["epf", fetchMatchsEpfKin, "epf"],
      ["international", fetchMatchsInternationaux, "international"],
      ["leopards", fetchMatchsLeopards, "leopards"]
    ];
    await Promise.all(sources.map(async ([key, fetcher, errorKey]) => {
      try {
        settled[key] = { status: "fulfilled", value: await fetcher() };
      } catch (reason) {
        settled[key] = { status: "rejected", reason };
      }
      if (stopped) return;
      const result = settled[key];
      if (result.status === "fulfilled") {
        if (key === "local") {
          for (const match of result.value) {
            const previous = previousLocalScores.get(match.id);
            if (previous && previous !== scoreOf(match) && match.statut === "live") {
              recentGoalIds.add(match.id);
              window.setTimeout(() => {
                recentGoalIds.delete(match.id);
                renderMatches();
              }, 1800);
            }
            previousLocalScores.set(match.id, scoreOf(match));
          }
        }
      } else {
        console.error(`Impossible de charger les matchs (${key}).`, result.reason);
        messages.push(key === "epf"
          ? `EPF-KIN : ${result.reason.message}`
          : sourceErrorMessage(errorKey, result.reason));
      }
      if (incremental) compose();
    }));
    if (stopped) return;
    loadingMatches = false;
    displayNotice(messages);
    compose(true);
  };

  const competitionOptions = (rows) => [...new Set(rows.map((row) => row.competition).filter(Boolean))].sort();
  const groupOptions = (rows) => [...new Set(rows.map((row) => row.groupe).filter(Boolean))].sort();

  const renderPlayoffPreview = async (requestId) => {
    standingsToolbar.hidden = true;
    standingsContainer.innerHTML = `<div class="match-skeleton"></div>`;
    try {
      const [groupA, groupB] = await Promise.all([
        getClassement("L1", "A"),
        getClassement("L1", "B")
      ]);
      if (stopped || requestId !== standingsRequestId || competitionFilter !== "linafoot_l1" || linafootLeague.value !== "L1" || linafootGroup.value !== "PO") return;
      const qualifiers = [
        ...groupA.slice(0, 4).map((row) => ({ ...row, playoffGroup: "A" })),
        ...groupB.slice(0, 4).map((row) => ({ ...row, playoffGroup: "B" }))
      ];
      if (!qualifiers.length) {
        standingsContainer.innerHTML = `<p class="results-empty">Aucun classement de groupe L1 disponible pour déterminer les équipes du Play Off.</p>`;
        return;
      }
      standingsContainer.innerHTML = `<p class="results-empty">Aperçu provisoire : les quatre premières équipes des groupes A et B sont affichées. Le calendrier des Play Off sera publié séparément.</p>
        <div class="standings-scroll"><table class="standings-table">
          <thead><tr><th>Place</th><th>Équipe</th><th>Groupe</th><th>Pts</th></tr></thead>
          <tbody>${qualifiers.map((row, index) => {
            const team = row.club?.nom || row.equipe || row.equipe_nom || row.team || "Équipe";
            return `<tr>
              <td><span class="standing-position">${index % 4 + 1}</span></td>
              <th scope="row"><span class="standing-team club-link"${clubLinkAttrs(team)}>${renderClubLogo(team, row.club?.logo_url)}<span>${escapeHtml(team)}</span></span></th>
              <td>Groupe ${row.playoffGroup}</td>
              <td><strong>${Number(row.points ?? row.pts ?? 0)}</strong></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>`;
    } catch (error) {
      if (stopped || requestId !== standingsRequestId) return;
      console.error("Impossible de calculer l’aperçu des équipes en course pour les Play Off.", error);
      standingsContainer.innerHTML = `<p class="results-empty">Aperçu des Play Off indisponible : ${escapeHtml(error.message)}</p>`;
    }
  };

  // Rencontres : classements et buteurs par ligue / groupe / série.
  const STANDING_SOURCES = {
    l1a: { label: "Linafoot L1 · Groupe A", fetch: () => getClassement("L1", "A") },
    l1b: { label: "Linafoot L1 · Groupe B", fetch: () => getClassement("L1", "B") },
    l2a: { label: "Linafoot L2 · Zone Est", fetch: () => getClassement("L2", "A") },
    l2b: { label: "Linafoot L2 · Zone Ouest", fetch: () => getClassement("L2", "B") },
    l2c: { label: "Linafoot L2 · Zone Centre-Sud", fetch: () => getClassement("L2", "C") },
    epfa: { label: "EPF-KIN · Série A", fetch: () => fetchEpfKinStandings("2026-2027", "A") },
    epfb: { label: "EPF-KIN · Série B", fetch: () => fetchEpfKinStandings("2026-2027", "B") },
    epfc: { label: "EPF-KIN · Série C", fetch: () => fetchEpfKinStandings("2026-2027", "C") }
  };

  const hideGenericStandingsControls = () => {
    if (standingsSourceSelect) standingsSourceSelect.hidden = false;
    standingsToolbar.querySelectorAll('label[for="standingsCompetition"], label[for="standingsGroup"]').forEach((label) => { label.hidden = true; });
    standingsCompetition.hidden = true;
    standingsGroup.hidden = true;
  };

  const renderRencontresStandings = async (requestId) => {
    standingsToolbar.hidden = false;
    hideGenericStandingsControls();
    const source = STANDING_SOURCES[standingsSource] || STANDING_SOURCES.l1a;
    try {
      const rows = await source.fetch();
      if (stopped || requestId !== standingsRequestId) return;
      if (!rows.length) {
        standingsContainer.innerHTML = `<p class="results-empty">Aucun classement disponible pour ${escapeHtml(source.label)}.</p>`;
        return;
      }
      const visibleStandings = [...rows].sort((first, second) => {
        const firstPosition = Number(first.position ?? first.rang ?? Number.NaN);
        const secondPosition = Number(second.position ?? second.rang ?? Number.NaN);
        if (Number.isFinite(firstPosition) && Number.isFinite(secondPosition) && firstPosition !== secondPosition) return firstPosition - secondPosition;
        return Number(second.points ?? second.pts ?? 0) - Number(first.points ?? first.pts ?? 0);
      });
      standingsContainer.innerHTML = `<div class="standings-scroll"><table class="standings-table">
        <thead><tr><th>#</th><th>Équipe</th><th>MJ</th><th>V</th><th>N</th><th>D</th><th>Diff</th><th>Pts</th></tr></thead>
        <tbody>${visibleStandings.map((row, index) => {
          const position = Number(row.position ?? row.rang ?? index + 1);
          const team = row.club?.nom || row.equipe || row.equipe_nom || row.nom || row.team || "Équipe";
          const logo = renderClubLogo(team, row.club?.logo_url || row.logo_url);
          const isTopFour = position <= 4;
          const isBottomFour = visibleStandings.length >= 4 && position >= visibleStandings.length - 3;
          return `<tr class="${isTopFour ? "qualification-place" : isBottomFour ? "relegation-place" : ""}">
            <td><span class="standing-position">${position}</span></td>
            <th scope="row"><span class="standing-team club-link"${clubLinkAttrs(team)}>${logo}<span>${escapeHtml(team)}</span></span></th>
            <td>${Number(row.joues ?? row.matches_played ?? row.played ?? 0)}</td>
            <td>${Number(row.gagnes ?? row.victoires ?? row.wins ?? row.won ?? 0)}</td>
            <td>${Number(row.nuls ?? row.draws ?? row.draw ?? 0)}</td>
            <td>${Number(row.defaites ?? row.losses ?? row.lost ?? 0)}</td>
            <td>${Number(row.difference_buts ?? row.goal_difference ?? 0)}</td>
            <td><strong>${Number(row.points ?? row.pts ?? 0)}</strong></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`;
    } catch (error) {
      if (stopped || requestId !== standingsRequestId) return;
      console.error("Impossible de charger le classement (page Rencontres).", error);
      standingsContainer.innerHTML = `<p class="results-empty">Classement indisponible : ${escapeHtml(error.message)}</p>`;
    }
  };

  let standingsRequestId = 0;
  const renderStandings = async () => {
    const requestId = ++standingsRequestId;
    if (standingsMode === "scorers") {
      await renderTopScorers();
      return;
    }
    if (isAllLayout) {
      await renderRencontresStandings(requestId);
      return;
    }
    if (competitionFilter === "linafoot_l1" && linafootGroup.value === "PO") {
      await renderPlayoffPreview(requestId);
      return;
    }
    standingsContainer.innerHTML = `<div class="match-skeleton"></div>`;
    try {
      const linafootSelected = ["linafoot_l1", "linafoot_l2"].includes(competitionFilter);
      const epfKinSelected = competitionFilter === "epf_kin";
      const leopardsSelected = competitionFilter === "leopards";
      standingsToolbar.hidden = linafootSelected || epfKinSelected || leopardsSelected;
      if (leopardsSelected) {
        const match = matches.find((item) => item.competition_category === "leopards");
        if (!match) {
          standingsContainer.innerHTML = `<p class="results-empty">Aucun classement disponible tant qu’un match des Léopards n’est pas fourni par l’API.</p>`;
          return;
        }
        const details = await fetchMatchDetails(match.id);
        standings = details.rankings || [];
      } else if (epfKinSelected) {
        standings = await fetchEpfKinStandings("2026-2027", epfKinSeries.value);
      } else {
        standings = linafootSelected
          ? await getClassement(linafootLeague.value, linafootGroup.value)
          : await fetchClassement(standingsCompetition.value, standingsGroup.value);
      }
      if (stopped || requestId !== standingsRequestId) return;
      if (!linafootSelected && !epfKinSelected && !leopardsSelected) {
        const comps = competitionOptions(standings);
        const currentCompetition = standingsCompetition.value;
        if (!currentCompetition && comps.length) {
          standingsCompetition.innerHTML = `<option value="">Toutes les compétitions</option>${comps.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
        }
        const groups = groupOptions(standings);
        const currentGroup = standingsGroup.value;
        standingsGroup.innerHTML = `<option value="">Tous les groupes</option>${groups.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
        standingsCompetition.value = currentCompetition;
        standingsGroup.value = groups.includes(currentGroup) ? currentGroup : "";
      }
      const visibleStandings = [...(epfKinSelected || leopardsSelected
        ? standings
        : standings.filter((row) => {
          const category = normalizeCompetition(row.competition).category;
          return category === competitionFilter;
        }))].sort((first, second) => {
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
        return 0;
      });
      if (!visibleStandings.length) {
        standingsContainer.innerHTML = `<p class="results-empty">Aucun classement disponible dans Supabase.</p>`;
        return;
      }
      const topFourVisible = visibleStandings.some((row) => Number(row.position ?? row.rang ?? 0) <= 4);
      const bottomFourVisible = visibleStandings.length >= 4 && visibleStandings.some((row) => {
        const position = Number(row.position ?? row.rang ?? 0);
        return position >= visibleStandings.length - 3;
      });
      standingsContainer.innerHTML = `<div class="standings-scroll"><table class="standings-table">
        <thead><tr><th>#</th><th>Équipe</th><th>MJ</th><th>V</th><th>N</th><th>D</th><th>Diff</th><th>Pts</th></tr></thead>
        <tbody>${visibleStandings.map((row, index) => {
          const position = Number(row.position ?? row.rang ?? index + 1);
          const team = row.club?.nom || row.equipe || row.equipe_nom || row.team || "Équipe";
          const logo = renderClubLogo(team, row.club?.logo_url);
          const isTopFour = position <= 4;
          const isBottomFour = visibleStandings.length >= 4 && position >= visibleStandings.length - 3;
          return `<tr class="${isTopFour ? "qualification-place" : isBottomFour ? "relegation-place" : ""}">
            <td><span class="standing-position">${position}</span></td>
            <th scope="row"><span class="standing-team club-link"${clubLinkAttrs(team)}>${logo}<span>${escapeHtml(team)}</span></span></th>
            <td>${Number(row.joues ?? row.matches_played ?? row.played ?? 0)}</td>
            <td>${Number(row.gagnes ?? row.victoires ?? row.wins ?? row.won ?? 0)}</td>
            <td>${Number(row.nuls ?? row.draws ?? row.draw ?? 0)}</td>
            <td>${Number(row.defaites ?? row.losses ?? row.lost ?? 0)}</td>
            <td>${Number(row.difference_buts ?? row.goal_difference ?? 0)}</td>
            <td><strong>${Number(row.points ?? row.pts ?? 0)}</strong></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>${topFourVisible || bottomFourVisible ? `<p class="standings-legend">${topFourVisible ? '<span class="legend-green" aria-hidden="true"></span> Top 4' : ""}${topFourVisible && bottomFourVisible ? " &nbsp; " : ""}${bottomFourVisible ? '<span class="legend-red" aria-hidden="true"></span> Bottom 4' : ""}</p>` : ""}`;
    } catch (error) {
      if (stopped || requestId !== standingsRequestId) return;
      console.error("Impossible de charger le classement Supabase.", error);
      standingsContainer.innerHTML = `<p class="results-empty">Classement indisponible : ${escapeHtml(error.message)}</p>`;
    }
  };

  const renderRencontresScorers = async (requestId) => {
    const source = STANDING_SOURCES[standingsSource] || STANDING_SOURCES.l1a;
    const isEpf = standingsSource.startsWith("epf");
    const serie = standingsSource.slice(3);
    topScorersContainer.innerHTML = `<div class="match-skeleton"></div>`;
    hideGenericStandingsControls();
    try {
      const allScorers = isEpf
        ? await fetchEpfKinTopScorers("2026-2027")
        : await fetchTopButeurs(standingsSource.startsWith("l2") ? "L2" : "L1");
      if (stopped || requestId !== topScorersRequestId) return;
      const scorers = isEpf
        ? (allScorers || []).filter((scorer) => !scorer.serie || scorer.serie === serie)
        : (allScorers || []);
      if (!scorers.length) {
        topScorersContainer.innerHTML = `<p class="results-empty">Aucun buteur disponible pour ${escapeHtml(source.label)}.</p>`;
        return;
      }
      topScorersContainer.innerHTML = `<div class="standings-scroll"><table class="standings-table">
        <thead><tr><th>#</th><th>Joueur</th><th>Équipe</th>${isEpf ? "<th>Série</th>" : ""}<th>MJ</th><th>Buts</th></tr></thead>
        <tbody>${scorers.map((scorer, index) => {
          const clubName = scorer.club?.nom || scorer.club?.sigle || scorer.club_nom || "Club à confirmer";
          const clubLogo = renderClubLogo(clubName, scorer.club?.logo_url);
          return `<tr>
            <td><span class="standing-position">${index + 1}</span></td>
            <th scope="row">${escapeHtml(scorer.nom || "Joueur à confirmer")}</th>
            <td><span class="scorer-club club-link"${clubLinkAttrs(clubName)}>${clubLogo}<span>${escapeHtml(clubName)}</span></span></td>
            ${isEpf ? `<td>Série ${escapeHtml(scorer.serie || "—")}</td>` : ""}
            <td>${Number(scorer.matches_joues ?? 0)}</td>
            <td><strong class="scorer-goals">${Number(scorer.buts ?? 0)}</strong></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`;
    } catch (error) {
      if (stopped || requestId !== topScorersRequestId) return;
      console.error("Impossible de charger les buteurs (page Rencontres).", error);
      topScorersContainer.innerHTML = `<p class="results-empty">Classement des buteurs indisponible : ${escapeHtml(error.message)}</p>`;
    }
  };

  let topScorersRequestId = 0;
  const renderTopScorers = async () => {
    const requestId = ++topScorersRequestId;
    if (isAllLayout) {
      await renderRencontresScorers(requestId);
      return;
    }
    const ligue = linafootLeague.value;
    const isEpfKin = competitionFilter === "epf_kin";
    const isLeopards = competitionFilter === "leopards";
    const leopardsMatch = isLeopards && matches.find((match) => match.competition_category === "leopards" && match.league_id && match.season);
    topScorersContainer.innerHTML = `<div class="match-skeleton"></div>`;
    if (isLeopards && !leopardsMatch) {
      topScorersContainer.innerHTML = `<p class="results-empty">Aucune compétition des Léopards n’est actuellement fournie par l’API.</p>`;
      return;
    }
    try {
      const scorers = isEpfKin
        ? await fetchEpfKinTopScorers("2026-2027")
        : isLeopards
          ? (await loadMatchDetails(leopardsMatch)).top_scorers || []
          : await fetchTopButeurs(ligue);
      if (stopped || requestId !== topScorersRequestId) return;
      if (!scorers.length) {
        const rankingLabel = isEpfKin ? "EPF-KIN, toutes séries" : isLeopards ? "Léopards" : `Linafoot ${ligue}`;
        topScorersContainer.innerHTML = `<p class="results-empty">Aucun buteur ${escapeHtml(rankingLabel)} disponible pour le moment.</p>`;
        return;
      }
      topScorersContainer.innerHTML = `<div class="standings-scroll"><table class="standings-table">
        <thead><tr><th>#</th><th>Joueur</th><th>Équipe</th>${isEpfKin ? "<th>Série</th>" : ""}<th>MJ</th><th>Buts</th></tr></thead>
        <tbody>${scorers.map((scorer, index) => {
          const clubName = scorer.club?.nom || scorer.club?.sigle || "Club à confirmer";
          const clubLogo = renderClubLogo(clubName, scorer.club?.logo_url);
          return `<tr>
            <td><span class="standing-position">${index + 1}</span></td>
            <th scope="row">${escapeHtml(scorer.nom || "Joueur à confirmer")}</th>
            <td><span class="scorer-club club-link"${clubLinkAttrs(clubName)}>${clubLogo}<span>${escapeHtml(clubName)}</span></span></td>
            ${isEpfKin ? `<td>Série ${escapeHtml(scorer.serie || "—")}</td>` : ""}
            <td>${Number(scorer.matches_joues ?? 0)}</td>
            <td><strong class="scorer-goals">${Number(scorer.buts ?? 0)}</strong></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`;
    } catch (error) {
      if (stopped || requestId !== topScorersRequestId) return;
      console.error(`Impossible de charger le classement des buteurs ${isEpfKin ? "EPF-KIN" : isLeopards ? "Léopards" : ligue}.`, error);
      topScorersContainer.innerHTML = `<p class="results-empty">Classement des buteurs indisponible : ${escapeHtml(error.message)}</p>`;
    }
  };

  const setStandingsMode = (mode) => {
    standingsMode = mode;
    const showScorers = mode === "scorers";
    activeView = showScorers ? "scorers" : "standings";
    showPanel(standingsPanel);
    markTab(showScorers ? topScorersView : standingsTab);
    standingsContainer.hidden = showScorers;
    topScorersContainer.hidden = !showScorers;
    standingsToolbar.hidden = isAllLayout ? false : showScorers || ["linafoot_l1", "linafoot_l2", "epf_kin"].includes(competitionFilter);
    if (activeView === "standings" || activeView === "scorers") renderStandings();
  };

  const updateTopScorersLabel = () => {
    topScorersView.textContent = competitionFilter === "epf_kin"
      ? "Buteurs EPF-KIN"
      : competitionFilter === "leopards"
        ? "Buteurs Léopards"
        : `Buteurs Linafoot ${linafootLeague.value}`;
  };

  const updateLinafootGroupOptions = () => {
    const isL1 = linafootLeague.value === "L1";
    const options = isL1
      ? [["A", "Groupe A"], ["B", "Groupe B"], ["PO", "Play Off (aperçu)"]]
      : [["A", "Zone Est"], ["B", "Zone Ouest"], ["C", "Zone Centre-Sud"]];
    const current = linafootGroup.value;
    linafootGroup.innerHTML = options
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");
    linafootGroup.value = options.some(([value]) => value === current)
      ? current
      : "A";
  };

  updateLinafootGroupOptions();

  const updateCompetitionTabs = () => {
    const supportsStandings = ["linafoot_l1", "linafoot_l2", "epf_kin"].includes(competitionFilter);
    const supportsScorers = ["linafoot_l1", "linafoot_l2", "epf_kin"].includes(competitionFilter);
    standingsTab.hidden = !supportsStandings;
    topScorersView.hidden = !supportsScorers;
    if (!supportsStandings && activeView !== "matches") matchesTab.click();
  };

  // La vue est réutilisée d'une page à l'autre : on efface tout ce qui vient de la page précédente.
  const resetView = () => {
    list.innerHTML = MATCH_SKELETONS;
    standingsContainer.innerHTML = "";
    topScorersContainer.innerHTML = "";
    playersContainer.innerHTML = "";
    playersSearch.value = "";
    playersPosition.value = "";
    disciplineCompetitionControls.innerHTML = "";
    disciplineCompetitionControls.hidden = true;
    standingsToolbar.hidden = false;
    matchesTab.hidden = false;
    matchesTab.textContent = "Calendrier & résultats";
    standingsTab.hidden = false;
    topScorersView.hidden = false;
    playersTab.hidden = true;
    root.querySelector(".competition-filters").hidden = false;
    linafootLeague.hidden = false;
    linafootLeagueLabel.hidden = false;
    linafootGroup.value = "A";
    epfKinSeries.value = "A";
    clubFilter = null;
    standingsCompetition.value = "";
    standingsGroup.value = "";
    root.querySelectorAll("[data-status]").forEach((item) => {
      const active = item.dataset.status === "all";
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    showPanel(matchesPanel);
    markTab(matchesTab);
  };
  resetView();

  if (competitionPage) {
    resultsTitle.textContent = competitionPage.title;
    resultsSubtitle.textContent = isAllLayout ? "Tous les résultats, calendriers et directs, sport par sport." : "";
    root.querySelector(".competition-filters").hidden = true;
    linafootControls.hidden = !["linafoot_l1", "linafoot_l2"].includes(competitionFilter);
    if (["linafoot_l1", "linafoot_l2"].includes(competitionFilter)) {
      linafootLeague.hidden = true;
      linafootLeagueLabel.hidden = true;
    }
    epfKinControls.hidden = competitionFilter !== "epf_kin";
    if (competitionFilter === "linafoot_l2") linafootLeague.value = "L2";
    if (competitionFilter === "linafoot_l1") linafootLeague.value = "L1";
    updateLinafootGroupOptions();
    updateCompetitionTabs();
    renderDisciplineCompetitionTabs();
  }

  // Organisation des onglets selon la rubrique.
  const configureLayout = () => {
    const tabsBar = root.querySelector(".results-view-tabs");
    const setTab = (tab, visible, label) => {
      tab.hidden = !visible;
      if (label) tab.textContent = label;
    };
    if (layout === "leopards") {
      setTab(matchesTab, true, "Calendrier et résultats");
      setTab(standingsTab, false);
      setTab(topScorersView, false);
      setTab(playersTab, true);
    } else if (layout === "rencontres") {
      // Rencontres : matchs du jour, classements et buteurs par ligue / groupe / série.
      setTab(matchesTab, true, "Matchs du jour");
      setTab(standingsTab, true, "Classements");
      setTab(topScorersView, true, "Buteurs");
    } else if (layout === "interclubs" || layout === "international" || layout === "events") {
      // Pages d'événements : les rencontres s'affichent directement sur la page.
      setTab(standingsTab, false);
      setTab(topScorersView, false);
    }
    // Filtre par statut : uniquement pour le Live Center et les championnats (Linafoot, EPF-KIN).
    // Le Live Center n'affiche que les matchs en direct : pas de filtre de statut.
    statusFilters.hidden = layout !== "league";
    const visibleTabs = [...tabsBar.querySelectorAll(".results-tab")].filter((tab) => !tab.hidden);
    tabsBar.hidden = isLiveCenter || visibleTabs.length < 2;
  };
  configureLayout();

  // Sélecteur de sport (page Rencontres) : Football · Basketball · Judo · Omnisports.
  root.querySelector("#sportSwitch")?.remove();
  root.querySelector(".date-nav")?.remove();
  root.querySelector("#standingsSource")?.remove();
  sportSwitchEl = null;
  dateNavEl = null;
  standingsSourceSelect = null;
  if (isAllLayout) {
    sportSwitchEl = document.createElement("div");
    sportSwitchEl.id = "sportSwitch";
    sportSwitchEl.className = "sport-switch";
    sportSwitchEl.setAttribute("role", "tablist");
    sportSwitchEl.setAttribute("aria-label", "Choisir un sport");
    sportSwitchEl.innerHTML = SPORT_CHIPS.map(([key, label]) => `<button type="button" class="sport-chip${key === sportFilter ? " is-active" : ""}" role="tab" aria-selected="${key === sportFilter}" data-sport="${key}"><span class="sport-chip-label">${label}</span><b class="sport-chip-count" data-sport-count="${key}" hidden></b></button>`).join("");
    root.querySelector(".results-toolbar").prepend(sportSwitchEl);
    sportSwitchEl.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-sport]");
      if (!chip) return;
      clubFilter = null;
      sportFilter = chip.dataset.sport;
      footballScope = "all";
      selectedDisciplineCompetition = "";
      sportSwitchEl.querySelectorAll("[data-sport]").forEach((item) => {
        const active = item === chip;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      renderScopePills();
      renderMatches();
    }, { signal });
    disciplineCompetitionControls.addEventListener("click", (event) => {
      const button = event.target.closest("[data-football-scope]");
      if (!button) return;
      clubFilter = null;
      footballScope = button.dataset.footballScope;
      renderScopePills();
      renderMatches();
    }, { signal });

    // Navigation par date : hier / aujourd'hui / demain + date libre.
    dateNavEl = document.createElement("div");
    dateNavEl.className = "date-nav";
    dateNavEl.setAttribute("role", "group");
    dateNavEl.setAttribute("aria-label", "Filtrer les rencontres par date");
    dateNavEl.innerHTML = [
      `<button type="button" class="date-nav-btn" data-day-offset="-1">Hier</button>`,
      `<button type="button" class="date-nav-btn is-active" data-day-offset="0">Aujourd'hui</button>`,
      `<button type="button" class="date-nav-btn" data-day-offset="1">Demain</button>`,
      `<label class="date-nav-picker"><span>Date</span><input type="date" id="dateNavInput" aria-label="Choisir une date"></label>`
    ].join("");
    root.querySelector(".results-toolbar").prepend(dateNavEl);
    dateNavEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-day-offset]");
      if (!button) return;
      selectedDayOffset = Number(button.dataset.dayOffset) || 0;
      selectedDayKey = null;
      const input = dateNavEl.querySelector("#dateNavInput");
      if (input) input.value = "";
      dateNavEl.querySelectorAll(".date-nav-btn").forEach((item) => item.classList.toggle("is-active", item === button));
      renderMatches();
    });
    dateNavEl.querySelector("#dateNavInput").addEventListener("change", (event) => {
      const value = event.target.value;
      if (!value) return;
      selectedDayKey = value;
      selectedDayOffset = 0;
      dateNavEl.querySelectorAll(".date-nav-btn").forEach((item) => item.classList.remove("is-active"));
      renderMatches();
    });

    // Sélecteur de ligue / groupe / série pour les classements et les buteurs.
    standingsSourceSelect = document.createElement("select");
    standingsSourceSelect.id = "standingsSource";
    standingsSourceSelect.setAttribute("aria-label", "Choisir une ligue, un groupe ou une série");
    standingsSourceSelect.innerHTML = [
      ["l1a", "Linafoot L1 · Groupe A"],
      ["l1b", "Linafoot L1 · Groupe B"],
      ["l2a", "Linafoot L2 · Zone Est"],
      ["l2b", "Linafoot L2 · Zone Ouest"],
      ["l2c", "Linafoot L2 · Zone Centre-Sud"],
      ["epfa", "EPF-KIN · Série A"],
      ["epfb", "EPF-KIN · Série B"],
      ["epfc", "EPF-KIN · Série C"]
    ].map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    standingsToolbar.append(standingsSourceSelect);
    standingsSourceSelect.addEventListener("change", () => {
      standingsSource = standingsSourceSelect.value;
      if (activeView === "standings" || activeView === "scorers") renderStandings();
    });

    renderScopePills();
    updateSportCounts();
  }

  // Clic sur un club dans les classements / buteurs / détail du match : fenêtre du club.
  const openClubFromTable = (event) => {
    const target = event.target.closest("[data-club-open]");
    if (!target) return;
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openClubModal(target.dataset.clubOpen, target);
  };
  [standingsContainer, topScorersContainer, detailPage].filter(Boolean).forEach((container) => {
    container.addEventListener("click", openClubFromTable, { signal });
    container.addEventListener("keydown", openClubFromTable, { signal });
  });

  matchesTab.addEventListener("click", () => {
    activeView = "matches";
    if (!competitionPage) root.querySelectorAll("[data-competition]").forEach((button) => { button.hidden = false; });
    showPanel(matchesPanel);
    markTab(matchesTab);
  }, { signal });
  standingsTab.addEventListener("click", () => {
    setStandingsMode("teams");
  }, { signal });
  topScorersView.addEventListener("click", () => setStandingsMode("scorers"), { signal });
  disciplineCompetitionControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-discipline-competition]");
    if (!button) return;
    clubFilter = null;
    selectedDisciplineCompetition = button.dataset.disciplineCompetition;
    renderDisciplineCompetitionTabs();
    renderMatches();
  }, { signal });
  root.querySelectorAll("[data-competition]").forEach((button) => button.addEventListener("click", () => {
    clubFilter = null;
    competitionFilter = button.dataset.competition;
    linafootControls.hidden = !["linafoot_l1", "linafoot_l2"].includes(competitionFilter);
    epfKinControls.hidden = competitionFilter !== "epf_kin";
    topScorersView.hidden = !["linafoot_l1", "linafoot_l2", "epf_kin", "leopards"].includes(competitionFilter);
    if (topScorersView.hidden && standingsMode === "scorers") setStandingsMode("teams");
    if (competitionFilter === "linafoot_l1") linafootLeague.value = "L1";
    if (competitionFilter === "linafoot_l2") linafootLeague.value = "L2";
    if (["linafoot_l1", "linafoot_l2"].includes(competitionFilter)) updateLinafootGroupOptions();
    updateTopScorersLabel();
    updateCompetitionTabs();
    root.querySelectorAll("[data-competition]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    if (activeView === "standings") {
      root.querySelectorAll('[data-competition="leopards"], [data-competition="international"]')
        .forEach((item) => { item.hidden = true; });
    }
    renderMatches();
    if (activeView === "standings") renderStandings();
  }, { signal }));
  root.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => {
    clubFilter = null;
    statusFilter = button.dataset.status;
    root.querySelectorAll("[data-status]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderMatches();
  }, { signal }));
  standingsCompetition.addEventListener("change", renderStandings, { signal });
  standingsGroup.addEventListener("change", renderStandings, { signal });
  linafootLeague.addEventListener("change", () => {
    clubFilter = null;
    competitionFilter = linafootLeague.value === "L2" ? "linafoot_l2" : "linafoot_l1";
    updateLinafootGroupOptions();
    topScorersView.hidden = false;
    updateTopScorersLabel();
    root.querySelectorAll("[data-competition]").forEach((button) => {
      const active = button.dataset.competition === competitionFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderMatches();
    if (activeView === "standings") renderStandings();
  }, { signal });
  linafootGroup.addEventListener("change", () => {
    clubFilter = null;
    renderMatches();
    if (activeView === "standings") renderStandings();
  }, { signal });
  epfKinSeries.addEventListener("change", () => {
    clubFilter = null;
    renderMatches();
    updateTopScorersLabel();
    if (activeView === "standings") renderStandings();
  }, { signal });
  // ---- Léopards : liste des joueurs + fiche individuelle ----
  const renderPlayers = () => {
    const query = normalizeSearch(playersSearch.value);
    const position = playersPosition.value;
    const visible = players.filter((player) => (
      (!query || normalizeSearch(`${player.nom} ${player.club}`).includes(query))
      && (!position || playerPositionKey(player.poste) === position)
    ));
    if (!players.length) {
      playersContainer.innerHTML = `<p class="results-empty">${EMPTY_PLAYERS_MESSAGE}</p>`;
      return;
    }
    if (!visible.length) {
      playersContainer.innerHTML = `<p class="results-empty">Aucun joueur ne correspond à cette recherche.</p>`;
      return;
    }
    const groups = [...PLAYER_POSITIONS, ["autre", "Autres joueurs"]];
    playersContainer.innerHTML = groups.map(([key, label]) => {
      const group = visible.filter((player) => playerPositionKey(player.poste) === key);
      if (!group.length) return "";
      return `<section class="players-group" aria-label="${label}">
        <h3 class="players-group-title">${label} <span>${group.length}</span></h3>
        <div class="players-grid">${group.map((player) => `<button type="button" class="player-card" data-player-id="${escapeHtml(player.id)}" aria-haspopup="dialog">
          ${renderPlayerAvatar(player)}
          <span class="player-card-body">
            <strong>${escapeHtml(player.nom || "Joueur")}</strong>
            <span>${escapeHtml(player.club || player.poste || "Club à confirmer")}</span>
          </span>
          ${player.numero ? `<span class="player-card-number">${escapeHtml(player.numero)}</span>` : ""}
        </button>`).join("")}</div>
      </section>`;
    }).join("");
  };

  const loadPlayers = async () => {
    if (playersLoaded) {
      renderPlayers();
      return;
    }
    playersContainer.innerHTML = `<div class="match-skeleton" aria-hidden="true"></div>`;
    try {
      const { fetchLeopardsPlayers } = await loadPlayersService();
      players = await fetchLeopardsPlayers();
      if (stopped) return;
      playersLoaded = true;
      renderPlayers();
    } catch (error) {
      if (stopped) return;
      console.error("Impossible de charger les joueurs des Léopards.", error);
      playersContainer.innerHTML = `<p class="results-empty">${EMPTY_PLAYERS_MESSAGE}</p>`;
    }
  };

  const renderSelectionStats = (details) => {
    const selection = details.selection || {};
    return `${details.season ? `<p class="player-season-label">Saison ${escapeHtml(details.season)}</p>` : ""}
      <div class="player-stats-grid">
        <div class="player-stat"><strong>${formatStat(selection.selections)}</strong><span>Sélections</span></div>
        <div class="player-stat"><strong>${formatStat(selection.buts_selection)}</strong><span>Buts</span></div>
        <div class="player-stat"><strong>${formatStat(selection.passes_selection)}</strong><span>Passes déc.</span></div>
        <div class="player-stat"><strong>${formatStat(selection.minutes_selection)}</strong><span>Minutes</span></div>
        <div class="player-stat"><strong>${formatStat(selection.cartons_jaunes)}</strong><span>Cartons jaunes</span></div>
        <div class="player-stat"><strong>${formatStat(selection.cartons_rouges)}</strong><span>Cartons rouges</span></div>
      </div>`;
  };

  const renderClubPerformances = (rows) => {
    if (!rows.length) {
      return `<p class="match-detail-empty">Aucune performance en club n'est disponible pour le moment.</p>`;
    }
    const sum = (key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
    const ratings = rows.map((row) => Number(row.note)).filter((note) => Number.isFinite(note) && note > 0);
    const average = ratings.length ? (ratings.reduce((total, note) => total + note, 0) / ratings.length).toFixed(1) : "—";
    return `<div class="player-stats-grid">
        <div class="player-stat"><strong>${sum("matchs")}</strong><span>Matchs</span></div>
        <div class="player-stat"><strong>${sum("minutes")}</strong><span>Minutes</span></div>
        <div class="player-stat"><strong>${sum("buts")}</strong><span>Buts</span></div>
        <div class="player-stat"><strong>${sum("passes")}</strong><span>Passes déc.</span></div>
        <div class="player-stat"><strong>${average}</strong><span>Note moy.</span></div>
      </div>
      <div class="standings-scroll"><table class="standings-table player-performance-table">
        <thead><tr><th>Club</th><th>Compétition</th><th>MJ</th><th>Min</th><th>B</th><th>PD</th><th>Note</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <th scope="row">${escapeHtml(row.club || "—")}${row.saison ? ` <small>${escapeHtml(row.saison)}</small>` : ""}</th>
          <td>${escapeHtml(row.competition || "—")}</td>
          <td>${formatStat(row.matchs)}</td>
          <td>${formatStat(row.minutes)}</td>
          <td>${formatStat(row.buts)}</td>
          <td>${formatStat(row.passes)}</td>
          <td>${formatStat(row.note)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  };

  const playerIdentityLine = (player, details = {}) => {
    const age = details.player?.age ?? player.age ?? playerAge(details.player?.date_naissance || player.date_naissance);
    const poste = details.player?.poste || player.poste;
    return [poste, age !== null && age !== undefined ? `${age} ans` : "", details.club || player.club, details.championnat || player.championnat]
      .filter(Boolean).map(escapeHtml).join(" · ");
  };

  const openPlayerModal = (player, trigger) => {
    if (!playerModal || !playerModalBody) return;
    playerReturnFocus = trigger;
    activePlayerId = player.id;
    playerModalBody.innerHTML = `<header class="player-modal-header">
        ${renderPlayerAvatar(player, "is-large")}
        <div>
          <h3 id="playerModalName">${escapeHtml(player.nom || "Joueur")}${player.numero ? ` <span class="player-modal-number">#${escapeHtml(player.numero)}</span>` : ""}</h3>
          <p id="playerIdentity">${playerIdentityLine(player) || "Informations à confirmer"}</p>
        </div>
      </header>
      <section class="player-modal-section">
        <h4>Statistiques individuelles · sélection</h4>
        <div id="playerSelectionStats"><div class="match-skeleton" aria-hidden="true"></div></div>
      </section>
      <section class="player-modal-section">
        <h4>Suivi en club</h4>
        <div id="playerPerformances"><div class="match-skeleton" aria-hidden="true"></div></div>
      </section>`;
    document.body.classList.add("has-player-modal");
    playerModal.hidden = false;
    playerModal.querySelector(".player-modal-dialog").scrollTop = 0;
    playerModal.querySelector(".player-modal-dialog").focus();
    loadPlayersService().then(({ fetchPlayerDetails }) => fetchPlayerDetails(player)).then((details) => {
      if (activePlayerId !== player.id || playerModal.hidden) return;
      playerModalBody.querySelector("#playerIdentity").innerHTML = playerIdentityLine(player, details) || "Informations à confirmer";
      playerModalBody.querySelector("#playerSelectionStats").innerHTML = renderSelectionStats(details);
      playerModalBody.querySelector("#playerPerformances").innerHTML = renderClubPerformances(details.club_stats || []);
    }).catch((error) => {
      if (activePlayerId !== player.id || playerModal.hidden) return;
      console.error("Impossible de charger les statistiques du joueur.", error);
      const empty = `<p class="match-detail-empty">${EMPTY_DATA_MESSAGE}</p>`;
      playerModalBody.querySelector("#playerSelectionStats").innerHTML = empty;
      playerModalBody.querySelector("#playerPerformances").innerHTML = empty;
    });
  };

  const closePlayerModal = () => {
    if (!playerModal || playerModal.hidden) return;
    playerModal.hidden = true;
    activePlayerId = null;
    document.body.classList.remove("has-player-modal");
    playerReturnFocus?.focus();
  };

  playersTab.addEventListener("click", () => {
    activeView = "players";
    showPanel(playersPanel);
    markTab(playersTab);
    loadPlayers();
  }, { signal });
  playersSearch.addEventListener("input", renderPlayers, { signal });
  playersPosition.addEventListener("change", renderPlayers, { signal });
  playersContainer.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-player-id]");
    if (!trigger) return;
    const player = players.find((item) => String(item.id) === trigger.dataset.playerId);
    if (player) openPlayerModal(player, trigger);
  }, { signal });
  if (playerModal) {
    playerModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-player-close]")) closePlayerModal();
    }, { signal });
    playerModal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePlayerModal();
      }
    }, { signal });
    playerModal.addEventListener("error", (event) => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.classList.contains("player-avatar-img")) {
        image.hidden = true;
        if (image.previousElementSibling) image.previousElementSibling.hidden = false;
      }
    }, { capture: true, signal });
  }

  if (matchesCache) {
    matches = matchesCache;
    renderDisciplineCompetitionTabs();
    renderMatches();
    refreshMatches(false);
  } else {
    refreshMatches(true);
  }
  try {
    realtimeChannel = subscribeMatchsLocaux(() => refreshMatches());
    standingsChannel = subscribeClassementsLocaux(() => {
      if (activeView === "standings" && standingsMode === "teams") renderStandings();
    });
    refreshTimer = window.setInterval(() => refreshMatches(), 60000);
  } catch (error) {
    console.error("Impossible d’activer Supabase Realtime pour les matchs.", error);
    displayNotice([`Mise à jour en direct indisponible : ${error.message}`]);
  }
  try {
    buteursChannel = subscribeButeurs(() => {
      if (activeView === "scorers" && standingsMode === "scorers") renderTopScorers();
    });
  } catch (error) {
    console.error("Impossible d’activer Supabase Realtime pour les buteurs L1.", error);
    displayNotice([`Mise à jour en direct des buteurs indisponible : ${error.message}`]);
  }
  return () => {
    stopped = true;
    controller.abort();
    closeClubModal({ restoreFocus: false });
    if (playerModal && !playerModal.hidden) {
      playerModal.hidden = true;
      document.body.classList.remove("has-player-modal");
    }
    window.clearInterval(refreshTimer);
    if (detailPage && !detailPage.hidden) {
      detailPage.hidden = true;
      document.body.classList.remove("has-match-detail-page");
      window.scrollTo(0, previousPageScrollY);
    }
    if (realtimeChannel) unsubscribeMatchsLocaux(realtimeChannel);
    if (standingsChannel) unsubscribeMatchsLocaux(standingsChannel);
    if (buteursChannel) unsubscribeButeurs(buteursChannel);
    document.querySelectorAll(".nav-live").forEach((link) => {
      link.classList.remove("is-live");
      link.setAttribute("aria-label", "Live Center, aucun match en direct");
    });
    root.dataset.initialized = "false";
  };
};
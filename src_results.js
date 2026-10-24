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

const renderTeamMark = (team, logo) => {
  const initials = escapeHtml(team.slice(0, 1).toUpperCase());
  return `<span class="team-mark" aria-hidden="true"><span class="team-mark-fallback"${logo ? " hidden" : ""}>${initials}</span>${logo ? `<img class="club-logo" src="${escapeHtml(logo)}" alt="" loading="lazy">` : ""}</span>`;
};

const renderClubLogo = (team, logo) => {
  const initials = escapeHtml(team.slice(0, 1).toUpperCase());
  return `<span class="club-logo-slot" aria-hidden="true"><span class="club-logo-placeholder"${logo ? " hidden" : ""}>${initials}</span>${logo ? `<img class="club-logo" src="${escapeHtml(logo)}" alt="" loading="lazy">` : ""}</span>`;
};

const renderMatch = (match) => {
  const sourceLabel = match.source === "local"
    ? (match.competition_category === "linafoot_l2" ? "Linafoot L2" : "Linafoot L1")
    : match.source === "epf_kin"
      ? `EPF-KIN · Série ${match.serie}`
      : (match.competition_category === "leopards" ? "Léopards" : "International");
  const isLive = match.statut === "live";
  const hasScore = match.score_domicile !== null && match.score_visiteur !== null;
  const score = hasScore
    ? `<strong class="match-score">${match.score_domicile}<span>–</span>${match.score_visiteur}</strong>`
    : `<strong class="match-kickoff">${formatKickoff(match.date_match)}</strong>`;

  return `<article class="match-card${isLive ? " is-live" : ""}" data-match-id="${escapeHtml(match.id)}" data-match-detail="${escapeHtml(match.id)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Détails du match : ${escapeHtml(match.equipe_domicile)} contre ${escapeHtml(match.equipe_visiteur)}">
    <div class="match-card-top">
      <span class="source-badge ${match.source === "local" || match.source === "epf_kin" ? "source-local" : "source-international"}">${sourceLabel}</span>
      <span class="match-competition">${escapeHtml(match.competition)}</span>
      ${isLive ? `<span class="live-match-badge"><span class="live-pulse" aria-hidden="true"></span>${escapeHtml(matchStatusLabel(match))}</span>` : `<span class="match-status">${escapeHtml(matchStatusLabel(match))}</span>`}
    </div>
    <div class="match-teams">
      <div class="match-team home-team">${renderTeamMark(match.equipe_domicile, match.logo_domicile)}<strong>${escapeHtml(match.equipe_domicile)}</strong></div>
      <div class="match-result">${score}</div>
      <div class="match-team away-team">${renderTeamMark(match.equipe_visiteur, match.logo_visiteur)}<strong>${escapeHtml(match.equipe_visiteur)}</strong></div>
    </div>
  </article>`;
};

const scoreOf = (match) => `${match.score_domicile ?? ""}:${match.score_visiteur ?? ""}`;

export const mountResults = (root) => {
  if (!root) return () => {};
  root.dataset.initialized = "true";

  const controller = new AbortController();
  const { signal } = controller;
  root.addEventListener("error", (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.classList.contains("club-logo")) {
      image.hidden = true;
      const fallback = image.previousElementSibling;
      if (fallback) fallback.hidden = false;
    }
  }, { capture: true, signal });
  const list = root.querySelector("#matchList");
  const notice = root.querySelector("#resultsNotice");
  const count = root.querySelector("#liveMatchCount");
  const detailPage = document.getElementById("matchDetailPage");
  const detailPageContent = detailPage?.querySelector(".match-detail-page-content");
  const detailModal = detailPage;
  const detailDialog = detailPageContent;
  const matchesTab = root.querySelector("#matchesTab");
  const standingsTab = root.querySelector("#standingsTab");
  const matchesPanel = root.querySelector("#matchesPanel");
  const standingsPanel = root.querySelector("#standingsPanel");
  const teamStandingsView = root.querySelector("#teamStandingsView");
  const topScorersView = root.querySelector("#topScorersView");
  const standingsCompetition = root.querySelector("#standingsCompetition");
  const standingsGroup = root.querySelector("#standingsGroup");
  const standingsContainer = root.querySelector("#standingsContainer");
  const topScorersContainer = root.querySelector("#topScorersContainer");
  const standingsToolbar = root.querySelector(".standings-toolbar");
  const linafootLeague = root.querySelector("#linafootLeague");
  const linafootGroup = root.querySelector("#linafootGroup");
  const linafootControls = root.querySelector(".linafoot-controls");
  const epfKinControls = root.querySelector("#epfKinControls");
  const epfKinSeries = root.querySelector("#epfKinSeries");
  let matches = [];
  let standings = [];
  let standingsMode = "teams";
  let competitionFilter = "linafoot_l1";
  let statusFilter = "all";
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

  const teamPosition = (rows, team) => {
    const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const row = rows.find((item) => normalize(item.club?.nom || item.equipe || item.equipe_nom || item.team) === normalize(team));
    const position = Number(row?.position ?? row?.rang);
    return Number.isFinite(position) ? position : null;
  };

  const loadMatchDetails = (match) => {
    if (!matchDetailsCache.has(match.id)) {
      const detailsRequest = match.source === "local"
        ? fetchLocalMatchDetails(match)
        : match.source === "epf_kin"
          ? Promise.resolve({
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

  const renderHistory = (history) => history.length
    ? history.map((item) => {
      const date = item.date ? formatMatchDate(item.date) : "Date non renseignée";
      const hasScore = item.home_score !== null && item.home_score !== undefined
        && item.away_score !== null && item.away_score !== undefined;
      return `<li><time>${escapeHtml(date)}</time><strong>${escapeHtml(item.home || "Équipe à confirmer")} ${hasScore ? `${escapeHtml(item.home_score)} – ${escapeHtml(item.away_score)}` : "– : –"} ${escapeHtml(item.away || "Équipe à confirmer")}</strong>${item.competition ? `<span>${escapeHtml(item.competition)}</span>` : ""}</li>`;
    }).join("")
    : `<li class="match-detail-empty">L’historique des confrontations n’est pas disponible pour ces équipes.</li>`;

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
          <th scope="row"><span class="match-detail-standings-team">${logo}<span>${escapeHtml(team)}</span></span></th>
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

  const renderMatchHighlights = (match, details = {}) => {
    const highlightLink = detailModal.querySelector("#matchDetailHighlightLink");
    const highlightMessage = detailModal.querySelector("#matchDetailHighlightMessage");
    const highlightImage = detailModal.querySelector("#matchDetailHighlightImage");
    const fallback = detailModal.querySelector("#matchDetailHighlightFallback");
    const videoUrl = safeHttpUrl(details.highlights_url || match.resume_video_url);
    const thumbnailUrl = safeHttpUrl(
      details.highlights_thumbnail_url
      || details.thumbnail_url
      || match.resume_video_thumbnail
    ) || videoThumbnailFromUrl(videoUrl);
    if (!videoUrl) {
      highlightLink.hidden = true;
      highlightImage.hidden = true;
      highlightImage.removeAttribute("src");
      fallback.hidden = true;
      highlightMessage.textContent = "Vidéo non fournie.";
      highlightMessage.hidden = false;
      return;
    }
    highlightLink.href = videoUrl;
    highlightLink.hidden = false;
    highlightImage.hidden = !thumbnailUrl;
    if (thumbnailUrl) highlightImage.src = thumbnailUrl;
    else highlightImage.removeAttribute("src");
    fallback.hidden = Boolean(thumbnailUrl);
    fallback.textContent = `${match.equipe_domicile} · ${match.equipe_visiteur}`;
    highlightMessage.hidden = true;
  };

  const renderMatchDetails = (match, details) => {
    const venue = details.venue || match.stade;
    const referee = details.referee || match.arbitre;
    detailModal.querySelector("#matchDetailVenue").textContent = venue || "Lieu non renseigné";
    detailModal.querySelector("#matchDetailReferee").textContent = referee || "Arbitre non renseigné";
    const events = details.events;
    detailModal.querySelector("#matchDetailTimeline").innerHTML = events.length
      ? events.map(renderMatchEvent).join("")
      : `<li class="match-detail-empty">${match.statut === "upcoming" ? "Le match n’a pas encore commencé." : "Les événements chronologiques ne sont pas disponibles pour ce match."}</li>`;
    const scorers = details.scorers.length ? details.scorers : match.buteurs;
    renderScorers(match, scorers, details.scorers_status);
    detailModal.querySelector("#matchDetailHomeLineup").innerHTML = renderLineup(details.lineups?.home);
    detailModal.querySelector("#matchDetailAwayLineup").innerHTML = renderLineup(details.lineups?.away);
    detailModal.querySelector("#matchDetailHistory").innerHTML = renderHistory(details.history);
    const standingsPanel = detailModal.querySelector("#matchDetailStandings");
    const standings = Array.isArray(details.rankings) ? details.rankings : [];
    standingsPanel.innerHTML = renderCompetitionStandings(standings, match);
    detailModal.querySelector("#matchDetailStandingsTitle").textContent = `Classement · ${match.competition}`;
    renderMatchHighlights(match, details);
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
    } else if (["international", "leopards"].includes(match.competition_category)) {
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
        "goal-scorers": "noms des buteurs"
      })[key] || key).join(", ")}.`
      : "";
  };

  const loadMatchRanks = async (match) => {
    const homeRank = detailModal.querySelector("#matchDetailHomeRank");
    const awayRank = detailModal.querySelector("#matchDetailAwayRank");
    if (match.source !== "local") {
      homeRank.textContent = "Chargement…";
      awayRank.textContent = "Chargement…";
      return;
    }
    homeRank.textContent = "Chargement…";
    awayRank.textContent = "Chargement…";
    try {
      const rows = match.source === "local" && ["linafoot_l1", "linafoot_l2"].includes(match.competition_category)
        ? await getClassement(match.ligue || (match.competition_category === "linafoot_l2" ? "L2" : "L1"), match.groupe || linafootGroup.value)
        : await fetchClassement(match.competition, match.groupe || "");
      if (activeDetailMatchId !== match.id || detailModal.hidden) return;
      setDetailRank(homeRank, teamPosition(rows, match.equipe_domicile), rows.length);
      setDetailRank(awayRank, teamPosition(rows, match.equipe_visiteur), rows.length);
    } catch (error) {
      if (activeDetailMatchId !== match.id || detailModal.hidden) return;
      console.error("Impossible de charger le classement associé au détail du match.", error);
      homeRank.textContent = "Classement indisponible";
      awayRank.textContent = "Classement indisponible";
      homeRank.className = "match-rank-badge";
      awayRank.className = "match-rank-badge";
    }
  };

  const openMatchDetail = (match, trigger) => {
    if (!detailModal || !detailDialog) return;
    matchDetailReturnFocus = trigger;
    activeDetailMatchId = match.id;
    const hasApiCompetitionStandings = ["international", "leopards"].includes(match.competition_category);
    const standingsTab = detailModal.querySelector("#matchTabStandings");
    standingsTab.hidden = !hasApiCompetitionStandings;
    detailModal.querySelector("#matchDetailStandings").innerHTML = `<p class="match-detail-empty">Chargement du classement…</p>`;
    const homeLogo = detailModal.querySelector("#matchDetailHomeLogo");
    const awayLogo = detailModal.querySelector("#matchDetailAwayLogo");
    const logoMarkup = (name, url) => url
      ? `<img src="${escapeHtml(url)}" alt="" />`
      : `<span aria-hidden="true">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
    detailModal.querySelector("#matchDetailTitle").textContent = match.competition;
    detailModal.querySelector("#matchDetailHomeName").textContent = match.equipe_domicile;
    detailModal.querySelector("#matchDetailAwayName").textContent = match.equipe_visiteur;
    homeLogo.innerHTML = logoMarkup(match.equipe_domicile, match.logo_domicile);
    awayLogo.innerHTML = logoMarkup(match.equipe_visiteur, match.logo_visiteur);
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
    detailModal.querySelector("#matchDetailReferee").textContent = match.arbitre || "Chargement…";
    detailModal.querySelector("#matchDetailHomeLineupName").textContent = match.equipe_domicile;
    detailModal.querySelector("#matchDetailAwayLineupName").textContent = match.equipe_visiteur;
    detailModal.querySelector("#matchDetailHomeLineup").innerHTML = `<p class="match-detail-empty">Chargement de la composition…</p>`;
    detailModal.querySelector("#matchDetailAwayLineup").innerHTML = `<p class="match-detail-empty">Chargement de la composition…</p>`;
    detailModal.querySelector("#matchDetailHistory").innerHTML = `<li class="match-detail-empty">Chargement des confrontations…</li>`;
    const apiNotice = detailModal.querySelector("#matchDetailApiNotice");
    apiNotice.hidden = true;
    renderMatchHighlights(match);
    detailModal.querySelectorAll("[data-match-tab]").forEach((tab) => {
      const active = tab.dataset.matchTab === "lineup";
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    detailModal.querySelectorAll("[data-match-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.matchPanel !== "lineup";
    });
    previousPageScrollY = window.scrollY;
    document.body.classList.add("has-match-detail-page");
    detailModal.hidden = false;
    detailModal.scrollTop = 0;
    detailDialog.focus();
    if (match.source === "local") void loadMatchRanks(match);
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
        detailModal.querySelector("#matchDetailReferee").textContent = match.arbitre || "Arbitre indisponible";
        detailModal.querySelector("#matchDetailHomeLineup").innerHTML = `<p class="match-detail-empty">Impossible de charger la composition.</p>`;
        detailModal.querySelector("#matchDetailAwayLineup").innerHTML = `<p class="match-detail-empty">Impossible de charger la composition.</p>`;
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

  const displayNotice = (messages) => {
    notice.hidden = messages.length === 0;
    notice.textContent = messages.join(" ");
  };

  const sourceErrorMessage = (source, error) => {
    if (source === "local" && error.code === "PGRST205") {
      return "La table public.matchs n’existe pas encore. Exécutez schema.sql dans le SQL Editor du projet Supabase du site.";
    }
    if (source === "epf_kin" && error.code === "PGRST205") {
      return "Les tables EPF-KIN ne sont pas encore créées. Exécutez supabase_epf_kin.sql dans le SQL Editor Supabase.";
    }
    if (source === "international" && error.message?.includes("FOOTBALL_DATA_API_KEY")) {
      return "Le flux international n’est pas configuré. Ajoutez FOOTBALL_DATA_API_KEY dans Vercel → Settings → Environment Variables.";
    }
    if (source === "leopards" && error.message?.includes("API_FOOTBALL_API_KEY")) {
      return "Le flux des Léopards n’est pas configuré. Ajoutez API_FOOTBALL_API_KEY dans Vercel → Settings → Environment Variables.";
    }
    const sourceLabel = { local: "Matchs locaux", international: "Matchs internationaux", leopards: "Matchs des Léopards" }[source];
    return `${sourceLabel} : ${error.message}`;
  };

  const filteredMatches = () => matches.filter((match) => {
    const matchesCompetition = match.competition_category === competitionFilter;
    const matchesLeague = match.source !== "local"
      || !match.ligue
      || match.ligue === linafootLeague.value;
    const matchesGroup = match.source !== "local"
      || !match.groupe
      || match.groupe === linafootGroup.value;
    const matchesEpfSeries = match.source !== "epf_kin"
      || match.serie === epfKinSeries.value;
    return matchesCompetition && matchesLeague && matchesGroup
      && matchesEpfSeries
      && (statusFilter === "all" || match.statut === statusFilter);
  });

  const renderMatches = () => {
    count.textContent = String(matches.filter((match) => match.statut === "live").length);
    const filtered = filteredMatches();
    if (!filtered.length) {
      const playoffPreview = competitionFilter === "linafoot_l1" && linafootGroup.value === "PO";
      list.innerHTML = `<p class="results-empty">${playoffPreview
        ? "Aucun match de play-off programmé pour le moment. Consultez l’onglet Classements pour voir les équipes provisoirement qualifiées."
        : matches.length ? "Aucun match ne correspond à ces filtres." : "Aucun match disponible pour le moment."}</p>`;
      return;
    }
    list.innerHTML = filtered
      .sort((a, b) => {
        const statusOrder = { live: 0, upcoming: 1, finished: 2 };
        const statusDifference = statusOrder[a.statut] - statusOrder[b.statut];
        if (statusDifference) return statusDifference;
        const dateDifference = new Date(a.date_match || 0) - new Date(b.date_match || 0);
        return a.statut === "finished" ? -dateDifference : dateDifference;
      })
      .map((match) => renderMatch(match).replace(
        `class="match-card${match.statut === "live" ? " is-live" : ""}"`,
        `class="match-card${match.statut === "live" ? " is-live" : ""}${recentGoalIds.has(match.id) ? " goal-flash" : ""}"`
      ))
      .join("");
  };

  if (detailPage && detailPageContent) {
    const highlightImage = detailPage.querySelector("#matchDetailHighlightImage");
    const highlightFallback = detailPage.querySelector("#matchDetailHighlightFallback");
    highlightImage.addEventListener("error", () => {
      highlightImage.hidden = true;
      highlightFallback.hidden = false;
    }, { signal });
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

  const refreshMatches = async (showSkeletons = false) => {
    if (showSkeletons) {
      list.innerHTML = `<div class="match-skeleton"></div><div class="match-skeleton"></div><div class="match-skeleton"></div>`;
    }
    const results = await Promise.allSettled([
      fetchMatchsLocaux(),
      fetchMatchsEpfKin(),
      fetchMatchsInternationaux(),
      fetchMatchsLeopards()
    ]);
    if (stopped) return;

    const messages = [];
    const nextMatches = [];
    const localResult = results[0];
    const epfKinResult = results[1];
    const internationalResult = results[2];
    const leopardsResult = results[3];
    if (localResult.status === "fulfilled") {
      for (const match of localResult.value) {
        const previous = previousLocalScores.get(match.id);
        if (previous && previous !== scoreOf(match) && match.statut === "live") {
          recentGoalIds.add(match.id);
          window.setTimeout(() => {
            recentGoalIds.delete(match.id);
            renderMatches();
          }, 1800);
        }
        previousLocalScores.set(match.id, scoreOf(match));
        nextMatches.push(match);
      }
    } else {
      console.error("Impossible de charger les matchs locaux.", localResult.reason);
      messages.push(sourceErrorMessage("local", localResult.reason));
    }
    if (epfKinResult.status === "fulfilled") {
      nextMatches.push(...epfKinResult.value);
    } else {
      console.error("Impossible de charger les matchs EPF-KIN.", epfKinResult.reason);
      messages.push(`EPF-KIN : ${epfKinResult.reason.message}`);
    }
    if (internationalResult.status === "fulfilled") {
      nextMatches.push(...internationalResult.value.filter((match) => (
        leopardsResult.status !== "fulfilled" || match.competition_category !== "leopards"
      )));
    } else {
      console.error("Impossible de charger les matchs internationaux.", internationalResult.reason);
      messages.push(sourceErrorMessage("international", internationalResult.reason));
    }
    if (leopardsResult.status === "fulfilled") {
      nextMatches.push(...leopardsResult.value);
    } else {
      console.error("Impossible de charger les matchs des Léopards.", leopardsResult.reason);
      messages.push(sourceErrorMessage("leopards", leopardsResult.reason));
    }
    matches = nextMatches;
    displayNotice(messages);
    renderMatches();
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
              <th scope="row"><span class="standing-team">${renderClubLogo(team, row.club?.logo_url)}<span>${escapeHtml(team)}</span></span></th>
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

  let standingsRequestId = 0;
  const renderStandings = async () => {
    const requestId = ++standingsRequestId;
    if (standingsMode === "scorers") {
      await renderTopScorers();
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
      standingsToolbar.hidden = linafootSelected || epfKinSelected;
      if (epfKinSelected) {
        standings = await fetchEpfKinStandings("2026-2027", epfKinSeries.value);
      } else {
        standings = linafootSelected
          ? await getClassement(linafootLeague.value, linafootGroup.value)
          : await fetchClassement(standingsCompetition.value, standingsGroup.value);
      }
      if (stopped || requestId !== standingsRequestId) return;
      if (!linafootSelected && !epfKinSelected) {
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
      const visibleStandings = [...(epfKinSelected
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
            <th scope="row"><span class="standing-team">${logo}<span>${escapeHtml(team)}</span></span></th>
            <td>${Number(row.joues ?? row.matches_played ?? 0)}</td>
            <td>${Number(row.gagnes ?? row.victoires ?? row.wins ?? 0)}</td>
            <td>${Number(row.nuls ?? row.draws ?? 0)}</td>
            <td>${Number(row.defaites ?? row.losses ?? 0)}</td>
            <td>${Number(row.difference_buts ?? 0)}</td>
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

  let topScorersRequestId = 0;
  const renderTopScorers = async () => {
    const requestId = ++topScorersRequestId;
    const ligue = linafootLeague.value;
    const isEpfKin = competitionFilter === "epf_kin";
    topScorersContainer.innerHTML = `<div class="match-skeleton"></div>`;
    try {
      const scorers = isEpfKin
        ? await fetchEpfKinTopScorers("2026-2027")
        : await fetchTopButeurs(ligue);
      if (stopped || requestId !== topScorersRequestId) return;
      if (!scorers.length) {
        const rankingLabel = isEpfKin ? "EPF-KIN, toutes séries" : `Linafoot ${ligue}`;
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
            <td><span class="scorer-club">${clubLogo}<span>${escapeHtml(clubName)}</span></span></td>
            ${isEpfKin ? `<td>Série ${escapeHtml(scorer.serie || "—")}</td>` : ""}
            <td>${Number(scorer.matches_joues ?? 0)}</td>
            <td><strong class="scorer-goals">${Number(scorer.buts ?? 0)}</strong></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`;
    } catch (error) {
      if (stopped || requestId !== topScorersRequestId) return;
      console.error(`Impossible de charger le classement des buteurs ${isEpfKin ? "EPF-KIN" : ligue}.`, error);
      topScorersContainer.innerHTML = `<p class="results-empty">Classement des buteurs indisponible : ${escapeHtml(error.message)}</p>`;
    }
  };

  const setStandingsMode = (mode) => {
    standingsMode = mode;
    const showScorers = mode === "scorers";
    teamStandingsView.classList.toggle("is-active", !showScorers);
    teamStandingsView.setAttribute("aria-pressed", String(!showScorers));
    topScorersView.classList.toggle("is-active", showScorers);
    topScorersView.setAttribute("aria-pressed", String(showScorers));
    standingsContainer.hidden = showScorers;
    topScorersContainer.hidden = !showScorers;
    standingsToolbar.hidden = showScorers || ["linafoot_l1", "linafoot_l2", "epf_kin"].includes(competitionFilter);
    if (activeView === "standings") renderStandings();
  };

  const updateTopScorersLabel = () => {
    topScorersView.textContent = competitionFilter === "epf_kin"
      ? "Meilleur buteur (EPF-KIN, toutes séries)"
      : `Meilleur buteur (${linafootLeague.value})`;
  };

  const updateLinafootGroupOptions = () => {
    const isL1 = linafootLeague.value === "L1";
    const options = isL1
      ? [["A", "Groupe A"], ["B", "Groupe B"], ["PO", "Play Off (aperçu)"]]
      : [["A", "Zone Ouest"], ["B", "Zone Centre-Sud"], ["C", "Zone Est"]];
    const current = linafootGroup.value;
    linafootGroup.innerHTML = options
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");
    linafootGroup.value = options.some(([value]) => value === current)
      ? current
      : "A";
  };

  updateLinafootGroupOptions();

  matchesTab.addEventListener("click", () => {
    activeView = "matches";
    root.querySelectorAll('[data-competition="leopards"], [data-competition="international"]')
      .forEach((button) => { button.hidden = false; });
    matchesPanel.hidden = false;
    standingsPanel.hidden = true;
    matchesTab.classList.add("is-active");
    matchesTab.setAttribute("aria-selected", "true");
    standingsTab.classList.remove("is-active");
    standingsTab.setAttribute("aria-selected", "false");
  }, { signal });
  standingsTab.addEventListener("click", () => {
    activeView = "standings";
    root.querySelectorAll('[data-competition="leopards"], [data-competition="international"]')
      .forEach((button) => { button.hidden = true; });
    if (["leopards", "international"].includes(competitionFilter)) {
      competitionFilter = "linafoot_l1";
      linafootLeague.value = "L1";
      updateLinafootGroupOptions();
      linafootControls.hidden = false;
      epfKinControls.hidden = true;
      topScorersView.hidden = false;
      updateTopScorersLabel();
      root.querySelectorAll("[data-competition]").forEach((button) => {
        const active = button.dataset.competition === competitionFilter;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }
    matchesPanel.hidden = true;
    standingsPanel.hidden = false;
    standingsTab.classList.add("is-active");
    standingsTab.setAttribute("aria-selected", "true");
    matchesTab.classList.remove("is-active");
    matchesTab.setAttribute("aria-selected", "false");
    renderStandings();
  }, { signal });
  teamStandingsView.addEventListener("click", () => setStandingsMode("teams"), { signal });
  topScorersView.addEventListener("click", () => setStandingsMode("scorers"), { signal });
  root.querySelectorAll("[data-competition]").forEach((button) => button.addEventListener("click", () => {
    competitionFilter = button.dataset.competition;
    linafootControls.hidden = !["linafoot_l1", "linafoot_l2"].includes(competitionFilter);
    epfKinControls.hidden = competitionFilter !== "epf_kin";
    topScorersView.hidden = !["linafoot_l1", "linafoot_l2", "epf_kin"].includes(competitionFilter);
    if (topScorersView.hidden && standingsMode === "scorers") setStandingsMode("teams");
    if (competitionFilter === "linafoot_l1") linafootLeague.value = "L1";
    if (competitionFilter === "linafoot_l2") linafootLeague.value = "L2";
    if (["linafoot_l1", "linafoot_l2"].includes(competitionFilter)) updateLinafootGroupOptions();
    updateTopScorersLabel();
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
    renderMatches();
    if (activeView === "standings") renderStandings();
  }, { signal });
  epfKinSeries.addEventListener("change", () => {
    renderMatches();
    updateTopScorersLabel();
    if (activeView === "standings") renderStandings();
  }, { signal });
  refreshMatches(true);
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
      if (activeView === "standings" && standingsMode === "scorers") renderTopScorers();
    });
  } catch (error) {
    console.error("Impossible d’activer Supabase Realtime pour les buteurs L1.", error);
    displayNotice([`Mise à jour en direct des buteurs indisponible : ${error.message}`]);
  }
  return () => {
    stopped = true;
    controller.abort();
    window.clearInterval(refreshTimer);
    if (detailPage && !detailPage.hidden) {
      detailPage.hidden = true;
      document.body.classList.remove("has-match-detail-page");
      window.scrollTo(0, previousPageScrollY);
    }
    if (realtimeChannel) unsubscribeMatchsLocaux(realtimeChannel);
    if (standingsChannel) unsubscribeMatchsLocaux(standingsChannel);
    if (buteursChannel) unsubscribeButeurs(buteursChannel);
    root.dataset.initialized = "false";
  };
};

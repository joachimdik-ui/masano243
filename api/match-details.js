const {
  list: sportsDbList,
  listFirst: sportsDbListFirst,
  numeric: sportsDbNumber,
  request: requestSportsDb
} = require("../lib/thesportsdb");

const isValidId = (value) => /^\d{1,12}$/.test(String(value || ""));

const hasApiErrors = (errors) => {
  if (!errors) return false;
  return Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0;
};

const requestJson = async (url, headers, provider) => {
  const upstream = await fetch(url, { headers });
  if (!upstream.ok) {
    throw new Error(`${provider} returned HTTP ${upstream.status}.`);
  }
  const payload = await upstream.json();
  if (hasApiErrors(payload.errors)) {
    throw new Error(`${provider} reported an API error.`);
  }
  return payload;
};

const eventMinute = (minute, extra) => {
  const elapsed = minute === null || minute === undefined || minute === "" ? Number.NaN : Number(minute);
  const additional = extra === null || extra === undefined || extra === "" ? Number.NaN : Number(extra);
  return {
    elapsed: Number.isFinite(elapsed) ? elapsed : null,
    extra: Number.isFinite(additional) ? additional : null
  };
};

const footballDataEvent = (item, type) => ({
  ...eventMinute(item.minute, item.injuryTime),
  type,
  team: item.team?.name || "",
  player: item.scorer?.name || item.player?.name || item.playerIn?.name || "",
  assist: item.assist?.name || item.playerOut?.name || "",
  detail: item.card || (item.playerOut?.name && item.playerIn?.name ? `${item.playerOut.name} remplacé par ${item.playerIn.name}` : item.type || "")
});

const sportsDbEventType = (item) => {
  const label = `${item.strTimeline || ""} ${item.strEvent || ""} ${item.strDetail || ""}`.toLowerCase();
  if (label.includes("goal")) return "goal";
  if (label.includes("card") || label.includes("booking")) return "booking";
  if (label.includes("substitution") || label.includes("sub ")) return "substitution";
  return item.strTimeline || item.strEvent || "";
};

const sportsDbTimelineEvent = (item) => {
  const time = String(item.strTime || item.intTime || "");
  const parsedTime = time.match(/(\d+)(?:\+(\d+))?/);
  return {
    ...eventMinute(parsedTime?.[1], parsedTime?.[2]),
    type: sportsDbEventType(item),
    team: item.strTeam || "",
    player: item.strPlayer || item.strPlayer1 || "",
    assist: item.strAssist || item.strPlayer2 || "",
    detail: item.strDetail || item.strEvent || ""
  };
};

const sportsDbDetails = async (eventId) => {
  const eventPayload = await requestSportsDb("lookupevent.php", { id: eventId });
  const [event] = sportsDbListFirst(eventPayload, ["events", "event"]);
  if (!event) throw new Error("TheSportsDB n'a pas trouvé ce match.");

  const warnings = [];
  const optionalList = async (endpoint, key) => {
    try {
      return sportsDbList(await requestSportsDb(endpoint, { id: eventId }), key);
    } catch (error) {
      console.error(`TheSportsDB ${endpoint} request failed.`, error);
      warnings.push(endpoint);
      return [];
    }
  };
  const [lineupRows, timelineRows, statistics] = await Promise.all([
    optionalList("lookuplineup.php", "lineup"),
    optionalList("lookuptimeline.php", "timeline"),
    optionalList("lookupeventstats.php", "eventstats")
  ]);
  const homeName = String(event.strHomeTeam || "").toLowerCase();
  const awayName = String(event.strAwayTeam || "").toLowerCase();
  const lineups = { home: [], away: [] };
  lineupRows.forEach((item) => {
    const team = String(item.strTeam || "").toLowerCase();
    const target = team === homeName || String(item.idTeam || "") === String(event.idHomeTeam)
      ? "home"
      : team === awayName || String(item.idTeam || "") === String(event.idAwayTeam)
        ? "away"
        : null;
    if (!target) return;
    lineups[target].push({
      name: item.strPlayer || item.strPlayer1 || "",
      number: sportsDbNumber(item.intLineupNumber ?? item.intNumber),
      position: item.strPosition || "",
      grid: item.strFormation || "",
      substitute: /sub/i.test(String(item.strSubstitute || item.strType || ""))
    });
  });
  const events = timelineRows.map(sportsDbTimelineEvent);
  const scorers = events.filter((item) => item.type === "goal");
  const homeScore = sportsDbNumber(event.intHomeScore);
  const awayScore = sportsDbNumber(event.intAwayScore);
  const hasFinalScore = homeScore !== null && awayScore !== null;
  const status = String(event.strStatus || "").toUpperCase();
  const isLive = /\b(1H|HT|2H|ET|BT|LIVE|IN PLAY|IN PROGRESS|HALF TIME)\b/.test(status);
  const isFinished = /\b(FT|AET|PEN|FINISHED|FULL TIME|MATCH FINISHED)\b/.test(status)
    || (hasFinalScore && !isLive
      && new Date(event.strTimestamp || event.dateEvent || "").getTime() < Date.now());

  return {
    venue: event.strVenue || "",
    referee: event.strOfficial || "",
    events,
    scorers,
    scorers_status: scorers.length
      ? "available"
      : hasFinalScore && homeScore + awayScore === 0 && isFinished
        ? "none"
        : hasFinalScore && isFinished
          ? "unavailable"
          : "pending",
    lineups: {
      home: lineups.home.length ? { formation: "", coach: "", players: lineups.home } : null,
      away: lineups.away.length ? { formation: "", coach: "", players: lineups.away } : null
    },
    history: [],
    rankings: [],
    top_scorers: [],
    statistics,
    highlights_url: event.strVideo || "",
    warnings
  };
};

const footballDataDetails = async (match, apiKey) => {
  const goals = Array.isArray(match.goals) ? match.goals : [];
  const events = [
    ...goals.map((item) => footballDataEvent(item, "goal")),
    ...(Array.isArray(match.bookings) ? match.bookings.map((item) => footballDataEvent(item, "booking")) : []),
    ...(Array.isArray(match.substitutions) ? match.substitutions.map((item) => footballDataEvent(item, "substitution")) : [])
  ].sort((first, second) => (first.elapsed ?? 999) - (second.elapsed ?? 999));
  const lineups = match.lineups && typeof match.lineups === "object" ? match.lineups : {};
  const warnings = [];
  let rankings = [];
  let history = [];
  const competitionId = match.competition?.id;
  const seasonYear = Number(match.season?.startDate?.slice(0, 4));
  const homeId = match.homeTeam?.id;
  const awayId = match.awayTeam?.id;
  if (Number.isInteger(competitionId) && Number.isInteger(seasonYear)) {
    const url = new URL(`https://api.football-data.org/v4/competitions/${competitionId}/standings`);
    url.searchParams.set("season", String(seasonYear));
    try {
      const payload = await requestJson(url, { "X-Auth-Token": apiKey }, "football-data.org");
      const standings = Array.isArray(payload.standings) ? payload.standings : [];
      const totalStanding = standings.find((standing) => standing.type === "TOTAL") || standings[0];
      rankings = (totalStanding?.table || []).map((row) => ({
        team_id: row.team?.id ?? null,
        team: row.team?.name || "",
        logo: row.team?.crest || "",
        group: row.group || "",
        position: row.position ?? null,
        played: row.playedGames ?? null,
        won: row.won ?? null,
        draw: row.draw ?? null,
        lost: row.lost ?? null,
        goals_for: row.goalsFor ?? null,
        goals_against: row.goalsAgainst ?? null,
        goal_difference: row.goalDifference ?? null,
        points: row.points ?? null
      }));
    } catch (error) {
      console.error("football-data.org standings request failed.", error);
      warnings.push("standings");
    }
  }
  if (Number.isInteger(homeId) && Number.isInteger(awayId)) {
    const url = new URL(`https://api.football-data.org/v4/teams/${homeId}/matches`);
    url.searchParams.set("status", "FINISHED");
    url.searchParams.set("limit", "100");
    try {
      const payload = await requestJson(url, { "X-Auth-Token": apiKey }, "football-data.org");
      history = (payload.matches || [])
        .filter((pastMatch) => (
          (pastMatch.homeTeam?.id === homeId && pastMatch.awayTeam?.id === awayId)
          || (pastMatch.homeTeam?.id === awayId && pastMatch.awayTeam?.id === homeId)
        ))
        .sort((first, second) => new Date(second.utcDate) - new Date(first.utcDate))
        .slice(0, 5)
        .map((pastMatch) => ({
          date: pastMatch.utcDate || "",
          competition: pastMatch.competition?.name || "",
          home: pastMatch.homeTeam?.name || "",
          away: pastMatch.awayTeam?.name || "",
          home_score: pastMatch.score?.fullTime?.home ?? null,
          away_score: pastMatch.score?.fullTime?.away ?? null
        }));
    } catch (error) {
      console.error("football-data.org head-to-head request failed.", error);
      warnings.push("head-to-head");
    }
  }
  const homeGoals = match.score?.fullTime?.home;
  const awayGoals = match.score?.fullTime?.away;
  const hasFinalScore = Number.isInteger(homeGoals) && Number.isInteger(awayGoals);
  const scorersStatus = goals.length
    ? "available"
    : hasFinalScore && homeGoals + awayGoals === 0
      ? "none"
      : hasFinalScore
        ? "unavailable"
        : "pending";
  return {
    venue: match.venue || "",
    referee: Array.isArray(match.referees)
      ? match.referees.map((referee) => referee.name).filter(Boolean).join(", ")
      : "",
    events,
    scorers: goals.map((item) => footballDataEvent(item, "goal")),
    scorers_status: scorersStatus,
    lineups: {
      home: lineups.home || null,
      away: lineups.away || null
    },
    history,
    rankings,
    highlights_url: "",
    warnings
  };
};

const normalizeTeamName = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\b(fc|cf|afc|sc|ac)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .split(/\s+/)
  .sort()
  .join(" ");

const apiFootballTeamId = async (teamName, apiKey) => {
  const url = new URL("https://v3.football.api-sports.io/teams");
  url.searchParams.set("search", teamName);
  const payload = await requestJson(url, { "x-apisports-key": apiKey }, "API-Football");
  const normalizedName = normalizeTeamName(teamName);
  const team = (payload.response || []).find((item) => normalizeTeamName(item.team?.name) === normalizedName);
  if (!Number.isInteger(team?.team?.id)) {
    throw new Error(`API-Football could not resolve team "${teamName}".`);
  }
  return team.team.id;
};

const findApiFootballFixture = async (match, apiKey) => {
  const [homeId, awayId] = await Promise.all([
    apiFootballTeamId(match.homeTeam?.name, apiKey),
    apiFootballTeamId(match.awayTeam?.name, apiKey)
  ]);
  const date = new Date(match.utcDate);
  if (Number.isNaN(date.getTime())) throw new Error("football-data.org returned an invalid match date.");
  const from = new Date(date);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(date);
  to.setUTCDate(to.getUTCDate() + 1);
  const params = new URLSearchParams({
    team: String(homeId),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    season: String(date.getUTCFullYear())
  });
  const payload = await requestJson(
    `https://v3.football.api-sports.io/fixtures?${params}`,
    { "x-apisports-key": apiKey },
    "API-Football"
  );
  const fixture = (payload.response || []).find((item) => (
    (item.teams?.home?.id === homeId && item.teams?.away?.id === awayId)
    || (item.teams?.home?.id === awayId && item.teams?.away?.id === homeId)
  ));
  if (!Number.isInteger(fixture?.fixture?.id)) {
    throw new Error("API-Football could not find the matching international fixture.");
  }
  return fixture.fixture.id;
};

const apiFootballFixture = async (fixtureId, apiKey) => {
  const url = new URL("https://v3.football.api-sports.io/fixtures");
  url.searchParams.set("id", fixtureId);
  const payload = await requestJson(url, { "x-apisports-key": apiKey }, "API-Football");
  const fixture = payload.response?.[0];
  if (!fixture) throw new Error("API-Football did not return the requested fixture.");
  return fixture;
};

const apiFootballDetails = async (fixtureId, apiKey) => {
  const fixture = await apiFootballFixture(fixtureId, apiKey);
  const homeId = fixture.teams?.home?.id;
  const awayId = fixture.teams?.away?.id;
  if (!Number.isInteger(homeId) || !Number.isInteger(awayId)) {
    throw new Error("API-Football returned invalid team IDs for the fixture.");
  }
  const headers = { "x-apisports-key": apiKey };
  const endpoint = (path, params) => {
    const url = new URL(`https://v3.football.api-sports.io/${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return requestJson(url, headers, "API-Football").then((payload) => payload.response || []);
  };
  const warnings = [];
  const load = async (key, request) => {
    try {
      return await request;
    } catch (error) {
      console.error(`API-Football ${key} request failed.`, error);
      warnings.push(key);
      return [];
    }
  };
  const standingsRequest = Number.isInteger(fixture.league?.id) && Number.isInteger(fixture.league?.season)
    ? endpoint("standings", { league: fixture.league.id, season: fixture.league.season })
    : Promise.resolve([]);
  const topScorersRequest = Number.isInteger(fixture.league?.id) && Number.isInteger(fixture.league?.season)
    ? endpoint("players/topscorers", { league: fixture.league.id, season: fixture.league.season })
    : Promise.resolve([]);
  const [events, lineups, history, standings, topScorers] = await Promise.all([
    load("events", endpoint("fixtures/events", { fixture: fixtureId })),
    load("lineups", endpoint("fixtures/lineups", { fixture: fixtureId })),
    load("head-to-head", endpoint("fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last: 5 })),
    load("standings", standingsRequest),
    load("top-scorers", topScorersRequest)
  ]);
  const lineupFor = (teamId) => {
    const lineup = lineups.find((item) => item.team?.id === teamId);
    if (!lineup) return null;
    return {
      formation: lineup.formation || "",
      coach: lineup.coach?.name || "",
      players: [...(lineup.startXI || []), ...(lineup.substitutes || [])].map(({ player }) => ({
        name: player?.name || "",
        number: player?.number ?? null,
        position: player?.pos || "",
        grid: player?.grid || "",
        substitute: (lineup.substitutes || []).some((item) => item.player?.id === player?.id)
      }))
    };
  };
  const rankingRows = standings.flatMap((item) => {
    const groups = Array.isArray(item.league?.standings) ? item.league.standings : [];
    return groups.flatMap((groupRows) => Array.isArray(groupRows) ? groupRows : []);
  });
  const homeGoals = fixture.goals?.home;
  const awayGoals = fixture.goals?.away;
  const hasFinalScore = Number.isInteger(homeGoals) && Number.isInteger(awayGoals);
  const scorers = events
    .filter((event) => event.type === "Goal")
    .map((event) => ({
      ...eventMinute(event.time?.elapsed, event.time?.extra),
      type: "goal",
      team: event.team?.name || "",
      player: event.player?.name || "",
      assist: event.assist?.name || "",
      detail: event.detail || ""
    }));
  return {
    venue: fixture.fixture?.venue?.name || "",
    referee: fixture.fixture?.referee || "",
    events: events.map((event) => ({
      ...eventMinute(event.time?.elapsed, event.time?.extra),
      type: event.type === "Goal" ? "goal" : event.type === "Card" ? "booking" : event.type === "subst" ? "substitution" : event.type || "",
      team: event.team?.name || "",
      player: event.player?.name || "",
      assist: event.assist?.name || "",
      detail: event.detail || ""
    })),
    scorers,
    scorers_status: scorers.length
      ? "available"
      : hasFinalScore && homeGoals + awayGoals === 0
        ? "none"
        : hasFinalScore
          ? "unavailable"
          : "pending",
    lineups: {
      home: lineupFor(homeId),
      away: lineupFor(awayId)
    },
    history: history.map((match) => ({
      date: match.fixture?.date || "",
      competition: match.league?.name || "",
      home: match.teams?.home?.name || "",
      away: match.teams?.away?.name || "",
      home_score: match.goals?.home ?? null,
      away_score: match.goals?.away ?? null
    })),
    rankings: rankingRows.map((row) => ({
      team_id: row.team?.id ?? null,
      team: row.team?.name || "",
      logo: row.team?.logo || "",
      group: row.group || "",
      position: row.rank ?? null,
      played: row.all?.played ?? null,
      won: row.all?.win ?? null,
      draw: row.all?.draw ?? null,
      lost: row.all?.lose ?? null,
      goals_for: row.all?.goals?.for ?? null,
      goals_against: row.all?.goals?.against ?? null,
      goal_difference: row.goalsDiff ?? null,
      points: row.points ?? null
    })),
    top_scorers: topScorers.map((item) => {
      const statistics = item.statistics?.find((entry) => entry.league?.id === fixture.league?.id) || item.statistics?.[0] || {};
      return {
        nom: item.player?.name || "Joueur à confirmer",
        club: {
          nom: statistics.team?.name || "Équipe à confirmer",
          logo_url: statistics.team?.logo || ""
        },
        matches_joues: statistics.games?.appearences ?? 0,
        buts: statistics.goals?.total ?? 0
      };
    }),
    highlights_url: "",
    warnings
  };
};

const findTheSportsDbEvent = async (match) => {
  const date = String(match.utcDate || "").slice(0, 10);
  if (!date || !match.homeTeam?.name || !match.awayTeam?.name) return null;
  const payload = await requestSportsDb("searchevents.php", {
    e: `${match.homeTeam.name}_vs_${match.awayTeam.name}`,
    d: date
  });
  const events = sportsDbListFirst(payload, ["events", "event"]);
  const namesMatch = (event) => {
    const home = normalizeTeamName(event.strHomeTeam);
    const away = normalizeTeamName(event.strAwayTeam);
    const expectedHome = normalizeTeamName(match.homeTeam.name);
    const expectedAway = normalizeTeamName(match.awayTeam.name);
    return (home === expectedHome && away === expectedAway)
      || (home === expectedAway && away === expectedHome);
  };
  return events.find((event) => event.dateEvent === date && namesMatch(event)) || null;
};

const enrichFromTheSportsDb = async (match, details) => {
  const hasLineups = details.lineups.home || details.lineups.away;
  const isFinished = ["FINISHED", "AET", "PEN"].includes(String(match.status || "").toUpperCase());
  if (!isFinished) return;
  if (details.scorers_status !== "unavailable" && hasLineups) return;
  try {
    const event = await findTheSportsDbEvent(match);
    if (!event?.idEvent) return;
    const additional = await sportsDbDetails(String(event.idEvent));
    if (additional.events.length) details.events = additional.events;
    if (additional.scorers.length) details.scorers = additional.scorers;
    if (additional.scorers_status !== "pending") details.scorers_status = additional.scorers_status;
    details.lineups.home ||= additional.lineups.home;
    details.lineups.away ||= additional.lineups.away;
    details.venue ||= additional.venue;
    details.referee ||= additional.referee;
    details.highlights_url ||= additional.highlights_url;
    details.warnings.push(...additional.warnings);
  } catch (error) {
    console.error("TheSportsDB fallback for international match failed.", error);
    details.warnings.push("thesportsdb-fallback");
  }
};

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  const matchId = String(request.query?.id || "");
  if (matchId.startsWith("thesportsdb-")) {
    const eventId = matchId.slice("thesportsdb-".length);
    if (!isValidId(eventId)) {
      return response.status(400).json({ error: "Identifiant de match TheSportsDB invalide." });
    }
    try {
      const details = await sportsDbDetails(eventId);
      response.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=3600");
      return response.status(200).json(details);
    } catch (error) {
      console.error("TheSportsDB match detail request failed.", error);
      return response.status(502).json({ error: "Impossible de charger les détails de ce match depuis TheSportsDB." });
    }
  }

  if (matchId.startsWith("api-football-")) {
    const fixtureId = matchId.slice("api-football-".length);
    if (!isValidId(fixtureId)) {
      return response.status(400).json({ error: "Identifiant de match API-Football invalide." });
    }
    const apiKey = process.env.API_FOOTBALL_API_KEY;
    if (!apiKey) {
      return response.status(503).json({ error: "Configurez API_FOOTBALL_API_KEY dans les variables d’environnement Vercel." });
    }
    try {
      const details = await apiFootballDetails(fixtureId, apiKey);
      response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      return response.status(200).json(details);
    } catch (error) {
      console.error("API-Football match detail request failed.", error);
      return response.status(502).json({ error: "Impossible de charger les détails de ce match depuis API-Football." });
    }
  }

  if (matchId.startsWith("international-")) {
    const providerId = matchId.slice("international-".length);
    if (!isValidId(providerId)) {
      return response.status(400).json({ error: "Identifiant de match international invalide." });
    }
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      return response.status(503).json({ error: "Configurez FOOTBALL_DATA_API_KEY dans les variables d’environnement Vercel." });
    }
    try {
      const payload = await requestJson(
        `https://api.football-data.org/v4/matches/${providerId}`,
        { "X-Auth-Token": apiKey },
        "football-data.org"
      );
      const match = payload.match || payload;
      const details = await footballDataDetails(match, apiKey);
      await enrichFromTheSportsDb(match, details);
      if (details.scorers_status === "unavailable") {
        const apiFootballKey = process.env.API_FOOTBALL_API_KEY;
        if (!apiFootballKey) {
          details.warnings.push("api-football-key-required");
        } else {
          try {
            const fixtureId = await findApiFootballFixture(match, apiFootballKey);
            const additionalDetails = await apiFootballDetails(String(fixtureId), apiFootballKey);
            details.venue ||= additionalDetails.venue;
            details.referee ||= additionalDetails.referee;
            details.events = additionalDetails.events.length ? additionalDetails.events : details.events;
            details.scorers = additionalDetails.scorers;
            details.scorers_status = additionalDetails.scorers_status;
            details.lineups.home ||= additionalDetails.lineups.home;
            details.lineups.away ||= additionalDetails.lineups.away;
            if (!details.history.length) details.history = additionalDetails.history;
            if (!details.rankings.length) details.rankings = additionalDetails.rankings;
            details.warnings.push(...additionalDetails.warnings);
            if (details.scorers_status === "unavailable") details.warnings.push("goal-scorers");
          } catch (error) {
            console.error("API-Football fallback for international match failed.", error);
            details.warnings.push("api-football-fallback");
          }
        }
      }
      response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      return response.status(200).json(details);
    } catch (error) {
      console.error("football-data.org match detail request failed.", error);
      return response.status(502).json({ error: "Impossible de charger les détails de ce match depuis football-data.org." });
    }
  }

  return response.status(400).json({ error: "Fournisseur ou identifiant de match invalide." });
};

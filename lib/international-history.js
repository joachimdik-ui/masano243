const archive = require("../data/international-results.json");

const normalizeTeam = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const aliases = new Map([
  ["congo dr", "dr congo"],
  ["congo democratic republic", "dr congo"],
  ["congo dem rep", "dr congo"],
  ["congo kinshasa", "dr congo"],
  ["democratic republic of congo", "dr congo"],
  ["democratic republic of the congo", "dr congo"],
  ["drc", "dr congo"],
  ["zaire", "dr congo"]
]);

const canonicalTeam = (value) => {
  const normalized = normalizeTeam(value);
  return aliases.get(normalized) || normalized;
};

const matchKey = (date, home, away, homeScore, awayScore) => [
  String(date || "").slice(0, 10),
  canonicalTeam(home),
  canonicalTeam(away),
  homeScore ?? "",
  awayScore ?? ""
].join("|");

const findInternationalHistory = (home, away, fixtureDate = "") => {
  const homeKey = canonicalTeam(home);
  const awayKey = canonicalTeam(away);
  if (!homeKey || !awayKey || homeKey === awayKey) {
    return { matches: [], summary: null, updated_through: archive.updated_through };
  }

  const selectedDate = String(fixtureDate || "").slice(0, 10);
  const records = archive.matches
    .map(([date, matchHome, homeScore, awayScore, matchAway, competition]) => ({
      date,
      home: matchHome,
      away: matchAway,
      home_score: homeScore,
      away_score: awayScore,
      competition
    }))
    .filter((match) => {
      const matchHome = canonicalTeam(match.home);
      const matchAway = canonicalTeam(match.away);
      const isSamePair = (matchHome === homeKey && matchAway === awayKey)
        || (matchHome === awayKey && matchAway === homeKey);
      return isSamePair && (!selectedDate || match.date < selectedDate);
    })
    .sort((first, second) => second.date.localeCompare(first.date));

  if (!records.length) {
    return { matches: [], summary: null, updated_through: archive.updated_through };
  }

  const summary = records.reduce((result, match) => {
    const homeWon = match.home_score > match.away_score;
    const awayWon = match.home_score < match.away_score;
    if (match.home_score === match.away_score) {
      result.draws += 1;
    } else if ((canonicalTeam(match.home) === homeKey && homeWon)
      || (canonicalTeam(match.away) === homeKey && awayWon)) {
      result.home_wins += 1;
    } else {
      result.away_wins += 1;
    }
    return result;
  }, { played: records.length, home_wins: 0, draws: 0, away_wins: 0 });

  return {
    matches: records.slice(0, 10),
    summary,
    updated_through: archive.updated_through
  };
};

const attachInternationalHistory = (details, home, away, fixtureDate = "") => {
  const archiveHistory = findInternationalHistory(home, away, fixtureDate);
  details.history_source = archive.source;
  details.history_updated_through = archiveHistory.updated_through;
  const homeKey = canonicalTeam(home);
  const awayKey = canonicalTeam(away);
  const selectedDate = String(fixtureDate || "").slice(0, 10);
  const isBeforeFixture = (match) => {
    if (!selectedDate || !match.date) return true;
    const date = String(match.date).slice(0, 10);
    if (date >= selectedDate) return false;
    return true;
  };
  const combined = [
    ...(Array.isArray(details.history) ? details.history : []),
    ...archiveHistory.matches
  ].filter((match) => {
    const matchHome = canonicalTeam(match.home);
    const matchAway = canonicalTeam(match.away);
    const samePair = (matchHome === homeKey && matchAway === awayKey)
      || (matchHome === awayKey && matchAway === homeKey);
    return !samePair || isBeforeFixture(match);
  });
  if (!archiveHistory.summary) {
    details.history = combined;
    return details;
  }

  const unique = new Map();
  combined.forEach((match) => {
    const key = matchKey(match.date, match.home, match.away, match.home_score, match.away_score);
    if (!unique.has(key)) unique.set(key, match);
  });
  details.history = [...unique.values()]
    .sort((first, second) => String(second.date || "").localeCompare(String(first.date || "")))
    .slice(0, 10);
  details.history_summary = archiveHistory.summary;
  details.history_source = archive.source;
  details.history_updated_through = archiveHistory.updated_through;
  return details;
};

module.exports = { attachInternationalHistory };

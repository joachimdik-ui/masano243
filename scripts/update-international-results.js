const fs = require("node:fs");
const path = require("node:path");

const SOURCE_URL = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "international-results.json");

const parseCsvRow = (line) => {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
};

const main = async () => {
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Masano243-international-history-sync" }
  });
  if (!response.ok) throw new Error(`International results source returned HTTP ${response.status}.`);

  const csv = await response.text();
  const lines = csv.replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
  const headers = parseCsvRow(lines.shift() || "");
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
  const required = ["date", "home_team", "away_team", "home_score", "away_score", "tournament"];
  if (required.some((header) => indexes[header] === undefined)) {
    throw new Error("International results source is missing required CSV columns.");
  }

  const matches = [];
  let updatedThrough = "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = parseCsvRow(line);
    const date = fields[indexes.date];
    const home = fields[indexes.home_team];
    const away = fields[indexes.away_team];
    const homeScoreText = fields[indexes.home_score];
    const awayScoreText = fields[indexes.away_score];
    const homeScore = Number(homeScoreText);
    const awayScore = Number(awayScoreText);
    const competition = fields[indexes.tournament];
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime())
      || parsedDate.toISOString().slice(0, 10) !== date || !home || !away
      || !/^\d+$/.test(homeScoreText) || !/^\d+$/.test(awayScoreText)
      || !Number.isInteger(homeScore) || !Number.isInteger(awayScore) || !competition) {
      throw new Error(`Invalid international match row: ${line.slice(0, 160)}`);
    }
    matches.push([date, home, homeScore, awayScore, away, competition]);
    if (date > updatedThrough) updatedThrough = date;
  }

  if (matches.length < 40000) {
    throw new Error(`International results source returned too few rows (${matches.length}).`);
  }

  const payload = {
    source: "Mart Jürisoo / openfootball international results",
    updated_through: updatedThrough,
    matches
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload)}\n`);
  console.log(`Saved ${matches.length} international results through ${updatedThrough}.`);
};

main().catch((error) => {
  console.error("Could not update international results.", error);
  process.exitCode = 1;
});

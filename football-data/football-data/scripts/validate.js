#!/usr/bin/env node
// Contrôle qualité : node scripts/validate.js
// Vérifie : JSON valide, champs obligatoires, dates ISO, scores, doublons, sources, conflits.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
const STATUSES = ["verified", "single_source", "unverified", "conflict"];
const errors = [], warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ["scripts", "inbox", "node_modules"].includes(e.name) ? [] : walk(p);
    return e.name.endsWith(".json") && e.name !== "package.json" ? [p] : [];
  });
}

function checkSources(f, id, it) {
  if (!Array.isArray(it.sources) || it.sources.length === 0) return err(f, `${id}: aucune source`);
  for (const s of it.sources) {
    if (!s.url || !/^https?:\/\//.test(s.url)) err(f, `${id}: URL de source invalide`);
    if (!s.name) err(f, `${id}: nom de source manquant`);
    if (!s.consulted_at || !ISO_DATE.test(s.consulted_at)) err(f, `${id}: consulted_at invalide`);
  }
  if (it.verification && it.verification.status === "verified" && it.sources.length < 2)
    warn(f, `${id}: « verified » avec une seule source`);
}

function checkMatch(f, it) {
  const id = it.id;
  if (it.date !== null && it.date !== undefined && !ISO_DATE.test(it.date)) err(f, `${id}: date invalide (${it.date})`);
  if (it.kickoff && !ISO_DT.test(it.kickoff)) err(f, `${id}: kickoff sans fuseau ou invalide (${it.kickoff})`);
  if (it.status === "finished") {
    const s = it.score;
    if (!s) err(f, `${id}: match terminé sans score`);
    else for (const k of ["home", "away"]) {
      if (s[k] !== null && (!Number.isInteger(s[k]) || s[k] < 0)) err(f, `${id}: score.${k} invalide`);
    }
    if (s && (s.home === null || s.away === null)) warn(f, `${id}: score inconnu (null)`);
  }
  if (!it.home || !it.away) err(f, `${id}: équipes manquantes`);
}

const ids = new Map();
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  let json;
  try { json = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { err(rel, "JSON invalide : " + e.message); continue; }
  if (rel === "metadata.json") {
    for (const k of ["schema_version", "generated_at", "collections", "sync_policy"]) if (!(k in json)) err(rel, `champ « ${k} » manquant`);
    continue;
  }
  if (!json.meta || !Array.isArray(json.items)) { err(rel, "structure attendue : { meta, items[] }"); continue; }
  const seen = new Set();
  for (const it of json.items) {
    const id = it.id;
    if (!id) { err(rel, "élément sans id"); continue; }
    if (seen.has(id)) err(rel, `doublon d'id : ${id}`);
    seen.add(id);
    if (!/^[a-z0-9_.\-]+$/.test(id)) warn(rel, `${id}: id non normalisé (a-z, 0-9, - _ .)`);
    checkSources(rel, id, it);
    if (!it.verification || !STATUSES.includes(it.verification.status)) err(rel, `${id}: statut de vérification absent ou inconnu`);
    if (it.home && it.away) checkMatch(rel, it);
    if (Array.isArray(it.conflicts) && it.conflicts.length) warn(rel, `${id}: ${it.conflicts.length} conflit(s) entre sources`);
    // doublon potentiel : même date + mêmes équipes + même compétition dans un autre id
    if (it.home && it.away && it.date) {
      const key = [it.competition_id, it.date, it.home.id, it.away.id].join("|");
      if (ids.has(key) && ids.get(key) !== id) err(rel, `doublon probable de ${ids.get(key)} : ${id}`);
      ids.set(key, id);
    }
  }
}
warnings.forEach(w => console.log("⚠ ", w));
errors.forEach(e => console.log("✗ ", e));
console.log(`\n${errors.length} erreur(s), ${warnings.length} avertissement(s).`);
process.exit(errors.length ? 1 : 0);

#!/usr/bin/env node
// Fusion : node scripts/merge.js inbox/<fichier>.json [--dry]
// Fichier d'entrée : { "target": "national-team/results.json", "items": [ ... ] }
// Règles : on lit l'existant, on ajoute les nouveaux ids, on met à jour les modifiés,
// on ne supprime jamais, on ne remplace jamais une donnée « verified » par une moins sûre,
// et chaque changement important est consigné dans metadata.json > changelog.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const RANK = { unverified: 0, conflict: 0, single_source: 1, verified: 2 };
const today = new Date().toISOString().slice(0, 10);
const args = process.argv.slice(2);
const inFile = args.find(a => !a.startsWith("--"));
const flag = args.find(a => a.startsWith("--"));
if (!inFile) { console.error("Usage : node scripts/merge.js inbox/<fichier>.json [--dry]"); process.exit(2); }
const dry = flag === "--dry";

const input = JSON.parse(fs.readFileSync(path.resolve(inFile), "utf8"));
const targetPath = path.join(ROOT, input.target);
const target = fs.existsSync(targetPath)
  ? JSON.parse(fs.readFileSync(targetPath, "utf8"))
  : { meta: { collection: input.target.replace(/\.json$/, ""), schema_version: "1.0.0" }, items: [] };
const byId = new Map(target.items.map(i => [i.id, i]));
const log = { added: [], updated: [], kept: [] };
const strip = o => JSON.stringify(o, (k, v) => ["last_synced", "first_seen"].includes(k) ? undefined : v);

for (const inc of input.items) {
  const old = byId.get(inc.id);
  if (!old) { target.items.push({ ...inc, first_seen: today, last_synced: today }); byId.set(inc.id, inc); log.added.push(inc.id); continue; }
  if (strip(old) === strip({ ...inc, first_seen: old.first_seen })) { old.last_synced = today; continue; }
  const oldRank = RANK[old.verification?.status] ?? 0, newRank = RANK[inc.verification?.status] ?? 0;
  if (newRank < oldRank) { log.kept.push(`${inc.id} (donnée vérifiée conservée, nouvelle donnée moins sûre ignorée)`); continue; }
  const history = old.history || [];
  history.push({ date: today, previous: { score: old.score ?? null, status: old.status ?? null, kickoff: old.kickoff ?? null, verification: old.verification?.status ?? null } });
  Object.assign(old, inc, { first_seen: old.first_seen, last_synced: today, history });
  log.updated.push(inc.id);
}
target.meta.last_sync = today;
console.log(`Ajoutés: ${log.added.length} | Mis à jour: ${log.updated.length} | Conservés: ${log.kept.length}`);
log.kept.forEach(k => console.log("  =", k));
if (dry) { console.log("(--dry : rien n'a été écrit)"); process.exit(0); }
fs.writeFileSync(targetPath, JSON.stringify(target, null, 2) + "\n");
if (log.added.length || log.updated.length) {
  const mp = path.join(ROOT, "metadata.json"), m = JSON.parse(fs.readFileSync(mp, "utf8"));
  m.changelog.push({ date: today, type: "merge", target: input.target, added: log.added, updated: log.updated });
  m.last_full_sync = m.last_full_sync; // inchangé : une fusion partielle n'est pas une synchro complète
  const key = input.target.replace(/\.json$/, "");
  if (m.collections[key]) { m.collections[key].last_sync = today; m.collections[key].items = target.items.length; }
  fs.writeFileSync(mp, JSON.stringify(m, null, 2) + "\n");
}

# football-data

Données football au format JSON : sélection de la RDC, clubs congolais en compétitions CAF, confrontations directes.
Ces fichiers restent l'archive éditoriale de référence et ne sont pas publiés dans les pages du site.

Lors d'une synchronisation AI Football Intelligence, les dix collections JSON sont aussi enregistrées dans les tables privées Supabase comme source `football-data-archive`. Les sources citées et le statut de vérification du fichier sont conservés dans le contenu de chaque observation ; le statut de vérification Supabase reste `pending` jusqu'à un contrôle indépendant. Les fichiers sont chargés au déploiement : redéployer après une mise à jour pour synchroniser leur nouvelle version.

## Principe de mise à jour

La collecte web et la mise à jour des fichiers restent à la demande : les scripts de ce dossier ne font **pas** de requêtes web et valident/fusionnent les données collectées. Le Cron AI Football Intelligence importe automatiquement la copie déployée des fichiers dans Supabase, mais ne collecte pas de nouvelles données pour modifier cette archive.

1. Tu lances une commande de collecte (voir plus bas) dans la conversation.
2. Claude te rend un fichier `inbox/<nom>.json` : `{ "target": "national-team/results.json", "items": [...] }`.
3. Tu le déposes dans `inbox/`, puis :

```bash
npm run merge:dry -- inbox/<nom>.json   # simulation
npm run merge -- inbox/<nom>.json       # fusion réelle
npm run validate                        # contrôle qualité
```

Règles de fusion : un nouvel id est ajouté ; un id existant est mis à jour avec l'ancienne valeur gardée dans `history` ; rien n'est jamais supprimé ; une donnée `verified` n'est jamais remplacée par une donnée moins sûre ; chaque fusion est consignée dans `metadata.json > changelog`.

## Commandes de collecte (à envoyer à Claude)

| Besoin | Commande |
|---|---|
| Matchs de la RDC | « collecte:rdc-matchs : prochains matchs des Léopards (A, féminine, U23, U20, U17) » |
| Résultats de la RDC | « collecte:rdc-résultats : résultats récents des Léopards » |
| Classements | « collecte:classements : groupes et classements en cours » |
| Clubs CAF | « collecte:clubs-caf : clubs congolais en Ligue des Champions et Coupe de la Confédération » |
| Confrontations | « collecte:confrontations <équipe A> vs <équipe B> : 5 à 10 derniers duels » |
| Synchro complète | « collecte:tout : relis football-data/ et mets tout à jour » |

Fréquence conseillée : calendriers chaque jour, résultats après chaque match, classements après chaque journée, confrontations à la demande.

## Structure

```
metadata.json                    état de chaque collecte, lacunes, historique
national-team/  fixtures | results | standings | news
caf/            clubs | champions-league | confederation-cup | fixtures | standings
head-to-head/   confrontations
scripts/        validate.js | merge.js
inbox/          dépôt des fichiers à fusionner
```

Chaque fichier : `{ "meta": {...}, "items": [...] }`. Chaque élément a un `id` stable, des `sources[]` (nom, url, date de consultation), un `verification` (`verified`, `single_source`, `unverified`, `conflict`) et un tableau `conflicts`. Les valeurs inconnues sont `null`.

## Confrontations directes (head-to-head)

Chaque paire contient : `last_5` (les 5 derniers matchs avec score connu et non contesté), `matches` (tous les matchs retrouvés), `statistics` (calculées **uniquement** sur ces matchs), `all_time` (totaux publiés par les sources, avec leur fiabilité) et `known_gaps`.
Quand le score sur le terrain diffère du résultat officiel (forfait, tapis vert), `score` est le résultat officiel et `score_on_pitch` le score joué. Les matchs en conflit sont exclus des statistiques.
`home_confirmed: false` signale un ordre domicile/extérieur non confirmé.

## Utilisation dans le site

```js
const res = await fetch("/football-data/national-team/results.json").then(r => r.json());
const matchs = res.items.filter(m => m.verification.status !== "unverified");
```

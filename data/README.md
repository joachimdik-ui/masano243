# Données sportives Masano243

`international-results.json` contient :

- `matches` : résultats internationaux masculins archivés, utilisés pour calculer les confrontations directes ;
- `api_snapshots.international` : calendrier et résultats fournis par football-data.org ;
- `api_snapshots.interclubs` : rencontres CAF disponibles via TheSportsDB ;
- `api_snapshots.leopards` : calendrier des Léopards fourni par TheSportsDB ;
- les champs `source`, `source_url`, `providers`, `fetched_at`, `last_success_at`, `status` et `warnings` pour suivre la provenance et l’état des actualisations.

L’archive internationale est communautaire, couvre les sélections masculines seniors et peut contenir des lacunes ou erreurs. Elle ne contient pas les rencontres olympiques, U23 ou des équipes B. Le site affiche sa provenance et sa dernière date couverte ; les scores des confrontations sont calculés à partir des enregistrements et non générés par une IA.

## Actualisation automatique

Après sa première synchronisation, le Cron Vercel appelle `/api/sync-sports-data` une fois par jour à 04:23 UTC. Il récupère l’archive internationale et les calendriers des API internes, puis met à jour ce fichier sur la branche configurée. Sur le plan Hobby, l’horaire est quotidien avec une précision d’environ une heure.

Configurer les variables suivantes dans Vercel pour les environnements Production :

- `CRON_SECRET` : valeur aléatoire d’au moins 16 caractères. Vercel l’envoie comme jeton Bearer aux appels Cron.
- `GITHUB_DATA_SYNC_TOKEN` : jeton GitHub fine-grained limité au dépôt `joachimdik-ui/masano243`, avec permission **Contents: Read and write**.
- `GITHUB_DATA_REPOSITORY` et `GITHUB_DATA_BRANCH` sont facultatives ; par défaut le dépôt et la branche `main` sont utilisés.

Ne pas placer ces jetons dans le dépôt, dans le navigateur ou dans une conversation. Après leur configuration, redéployer le projet puis lancer le Cron manuellement depuis le tableau de bord Vercel pour vérifier la première synchronisation.

Les appels d’API en échec conservent le dernier instantané réussi et enregistrent l’état `stale` et le message d’erreur. L’échec de la source d’archive ou de l’écriture GitHub fait échouer la synchronisation plutôt que de publier une archive partielle.

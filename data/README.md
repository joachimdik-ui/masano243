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

## AI Football Intelligence — ingestion privée

La première étape de collecte est isolée des tables publiques de matchs et de classements. Après avoir appliqué `sql/supabase_football_intelligence.sql` dans le projet Supabase, le Cron Vercel `/api/football-sync` enregistre les matchs des APIs existantes comme observations avec source, date de collecte et empreinte de contenu. Les nouvelles observations reçoivent automatiquement le statut `pending` ; cette étape ne confirme pas les scores et ne modifie pas `matchs` ou `classements`. Les JSON de `football-data/football-data` sont des ressources statiques distinctes, lues directement par les écrans qui les utilisent ; ils ne sont pas importés dans Supabase.

Configurer côté serveur Vercel `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` et `CRON_SECRET` (au moins 16 caractères). Ne jamais exposer la clé `service_role` au navigateur. `SUPABASE_URL` peut être omis si `NEXT_PUBLIC_SUPABASE_URL` est déjà configuré côté serveur. Le Cron s’exécute quotidiennement après la synchronisation de l’archive ; sur Vercel Hobby, l’horaire est soumis à la précision horaire du plan.

La synchronisation reste désactivée tant que `FOOTBALL_INTELLIGENCE_SYNC_ENABLED` n’est pas défini sur `true`. Appliquer d’abord la migration, configurer les variables, puis activer explicitement ce drapeau et redéployer. Déclencher le Cron et vérifier `football_sync_logs`, `football_observations` et `football_data_verifications`. Les sources utilisées sont football-data.org et TheSportsDB via les APIs déjà présentes ; un échec partiel est journalisé, et les observations précédentes ne sont pas effacées. Cette première étape ne couvre pas encore la détection exhaustive des clubs CAF ni toutes les catégories nationales.

### Recherche Web générale avec IA (Tavily)

Le Cron effectue au plus une recherche Web générale par jour, en faisant tourner cinq thèmes sur les Léopards, le football féminin, les sélections U23/U20/U17 et les clubs/classements CAF. Par défaut, la recherche utilise le mode Tavily « keyless », qui ne nécessite ni compte ni clé et reste soumis aux limites de débit du fournisseur. Une clé Tavily facultative, stockée côté serveur dans `TAVILY_API_KEY`, permet d’utiliser les crédits du compte ; la documentation Tavily annonce 1 000 crédits gratuits par mois sans carte bancaire. Une limite transactionnelle interne plafonne l’application à 500 recherches réservées par mois, quel que soit le mode. La réponse IA, les extraits et citations sont enregistrés comme observations non vérifiées, avec le statut `pending` ; ils ne sont jamais publiés dans les tables de scores.

La migration `sql/supabase_tavily_search_usage.sql` ajoute le compteur mensuel atomique et doit être exécutée dans le SQL Editor Supabase avant le Cron. Après son application, déployer la version du code qui contient la recherche. Aucune clé Tavily n’est nécessaire pour le mode keyless. Si tu as une clé, tu peux l’ajouter dans Vercel comme variable serveur `TAVILY_API_KEY`, marquée sensitive, pour Production ; ne la place jamais dans le navigateur, le dépôt ou une conversation.

Après le prochain Cron, vérifier `football_sync_logs.source_results.web_search`, puis `football_observations` et `football_data_verifications`. Une réservation interne est consommée même si l’appel échoue, par prudence. Les limites du mode keyless et les quotas Tavily peuvent changer ; la première intégration ne constitue pas une confirmation factuelle multi-source et ne détecte pas automatiquement tous les clubs congolais engagés.

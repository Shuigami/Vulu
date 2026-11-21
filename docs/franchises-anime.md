# Franchises d'anime (issue #52)

Sur AniList, chaque saison d'un anime est une œuvre à part (_Frieren_, _Frieren Season 2_…).
Vulu les regroupe en **une seule œuvre par franchise**, avec les saisons AniList comme saisons,
comme une série TMDB : une page, une entrée de bibliothèque, une progression en épisodes absolus.

Décisions prises (2026-11-21) : une œuvre par franchise (pas un simple lien entre œuvres) ;
regroupement par les relations AniList `SEQUEL` / `PREQUEL`.

## Règle de regroupement

- Une franchise est une chaîne de saisons AniList de format série (`TV`, `TV_SHORT`, `ONA`) reliées
  par `PREQUEL` / `SEQUEL`. On remonte les `PREQUEL` jusqu'à la racine, puis on suit les `SEQUEL`
  (déjà fait par `animeSeasons` dans `anilist.ts`, 30 saisons au plus).
- Films, OVA, specials et spin-offs (`SIDE_STORY`, `SPIN_OFF`, `ALTERNATIVE`…) restent des œuvres à
  part.
- Plusieurs suites série (rare : une suite TV et une ONA) : la première en date est la saison
  suivante, les autres restent à part.
- Une franchise d'une seule saison est une œuvre normale avec une saison 1 : même modèle partout.
- Coût : une requête AniList par saison (limite 30/min), faite par le worker à l'import, puis à la
  mise à jour quotidienne des franchises en cours (nouvelle saison annoncée).

## Modèle

Pas de nouvelle table d'œuvre : la franchise est un `media` de type `anime`.

- **`media`** (la franchise) : titre, affiche, synopsis, studio, genres de la **première saison** ;
  `start_date` de la première, `end_date` de la dernière ; `status` = `releasing` si une saison est en
  cours, `announced` si seule une saison annoncée reste, sinon celui de la dernière ;
  `total_units` = somme des épisodes des saisons (null si une saison ne le connaît pas encore) ;
  `total_units_secondary` = nombre de saisons.
- **`media_external_ids`** : l'id AniList de la racine est l'id primaire ; les ids AniList et MAL des
  autres saisons sont des ids secondaires de la franchise. Tout id d'une saison (recherche, import
  AniList/MAL, recommandations) retombe donc sur la franchise.
- **`media_titles`** : les titres de toutes les saisons (« Frieren Season 2 » trouve la franchise en
  recherche locale).
- **`seasons`** : une ligne par saison AniList, `number` 1…N. Nouvelles colonnes :
  `anilist_id` (texte) et `status`. `title`, `air_date` (date de début), `episode_count` et
  `poster_url` viennent d'AniList.
- **`episodes`** : rattachés à leur saison, `number` dans la saison, `absolute_number` cumulé sur
  la franchise. Chaque saison a toujours ses épisodes 1…`episode_count`, même sans TMDB (titre vide) ;
  TMDB (#49) les enrichit, saison par saison, en calant chaque saison sur sa date de début dans le
  show TMDB commun (`extra.tmdbId` passe de la saison à la franchise). Un « épisode 0 » qu'AniList compte et que TMDB range en
  spécial (saison 0) ouvre la saison, suivi des épisodes numérotés. Le planning AniList donne les
  heures exactes. Les épisodes sans saison (#49) disparaissent pour les franchises.
- `ProviderEpisodes` d'AniList devient : toutes les saisons, avec leurs épisodes.

Les films et OVA gardent le modèle actuel (pas de saisons, pas d'épisodes).

## Bibliothèque

Une entrée par franchise, comme une série TV :

- `progress` = épisodes absolus vus, `progress_secondary` = saisons terminées (calculé comme pour la
  TV). Les règles d'`applyChange` s'appliquent telles quelles (plafond, statut, dates).
- Le suivi par épisode et par saison (#35) marche sans changement : `seasonList`, `markEpisode`,
  `markSeason`, page épisode. Le groupe « sans saison » de #49 n'est plus utilisé que s'il reste des
  épisodes sans saison.
- Le rewatch repart à 0 sur toute la franchise.

### Fusion de plusieurs entrées (imports et migration)

Quand un utilisateur a plusieurs saisons d'une même franchise (import AniList/MAL, données
existantes), elles deviennent une entrée :

- `progress` = épisodes de toutes les saisons avant la dernière saison commencée + progression dans
  celle-ci (une saison sautée compte comme vue : c'est la règle « vu jusqu'ici » du suivi TV).
- `status` : `completed` si toutes les saisons sorties sont terminées ; sinon celui de la dernière
  saison commencée (`in_progress`, `paused`, `dropped`) ; `planned` si aucune n'est commencée.
- `score` : celui de la **dernière saison notée** (avis le plus récent). Les notes des autres
  saisons sont copiées dans les notes de l'entrée (« S1 : 8/10 ») pour ne rien perdre.
- `started_on` = la plus ancienne, `completed_on` = la plus récente si `completed`,
  `repeat_count` = le maximum, favori / privé = l'un ou l'autre (privé l'emporte),
  `review` et `notes` concaténées avec le nom de la saison.
- Imports : l'agrégation se fait avant `saveImportedEntry`, la règle « une entrée existante n'est
  jamais modifiée » reste. Les clés de dédoublonnage du journal (`import:<source>:<mediaId>:<kind>`)
  portent sur la franchise.
- Trakt : `resolveTraktAnime` ne répartit plus les épisodes vus sur les saisons AniList : le total
  Trakt devient directement la progression absolue de la franchise.

## Migration des données existantes

Les saisons 2+ existent aujourd'hui comme œuvres. Une migration SQL ne peut pas trouver les
relations (il faut AniList) : c'est un job worker `anime-franchises`, lancé une fois après le
déploiement pour tous les animes série, puis à chaque import d'anime.

Pour une franchise : construire la chaîne, choisir la racine (créée si absente), puis pour chaque
autre saison déjà en base, dans une transaction :

1. fusionner les entrées de bibliothèque dans celle de la franchise (règles ci-dessus), en passant
   par `updateEntry` sans journal (`source = 'import'`, rien dans le fil) ;
2. déplacer `activity_events` (`media_id` → franchise ; `episode_id` remis sur l'épisode
   correspondant de la nouvelle saison, sinon null), `list_items` (un doublon dans une liste est
   supprimé), `media_titles`, `media_external_ids` (deviennent secondaires) ;
3. remapper `episode_views` et `episode_ratings` sur les épisodes de la saison correspondante
   (même numéro) ;
4. supprimer l'ancien `media` (les `seasons` / `episodes` partent en cascade).

Idempotent : relancer sur une franchise déjà regroupée ne change rien. Les liens `/media/<id>` des
saisons 2+ ne marchent plus (404) : pas de table de redirection en V1.

## Ce qui change ailleurs

- **Recherche** : un résultat AniList d'une saison déjà connue ouvre la franchise ; les saisons
  d'une même franchise présente en local ne sont montrées qu'une fois. Ouvrir une suite inconnue
  importe toute la franchise.
- **Page œuvre** : les saisons en onglets (le sélecteur existant), progression par saison et
  globale ; la grille de progression disparaît pour les animes série. Films et OVA liés (relations
  AniList hors chaîne) affichés en bas, sous « Dans la même franchise » — plus tard si ça coûte.
- **Calendrier** : libellés `S2E3` au lieu de `Ép. 3`, rien d'autre.
- **Jellyfin** : les animes passent par le chemin TV (saison + épisode → numéro absolu). Risque :
  Jellyfin numérote comme TVDB/TMDB, pas comme AniList (cours coupés) ; on cherche d'abord
  l'épisode par saison/numéro, puis par date de diffusion si Jellyfin la donne. À vérifier sur un
  vrai serveur.
- **Stats** : rien (les événements sont déjà en épisodes et minutes).
- **Recommandations / tendances AniList** : chaque saison retombe sur sa franchise si elle est
  connue ; doublons retirés.
- **Export** : une ligne par franchise, id AniList de la racine.
- **Social / fil** : rien de spécial (une entrée = une œuvre).

## Découpage proposé (une PR chacun)

1. Schéma (`seasons.anilist_id`, `status`), client AniList (chaîne de saisons),
   import d'une franchise neuve, épisodes par saison (AniList + TMDB). Nouveaux animes seulement.
2. Job `anime-franchises` : fusion des œuvres et entrées existantes, puis lancement en production.
3. Imports (AniList, MAL, Trakt) : agrégation par franchise.
4. Recherche, recommandations, Jellyfin.

## Risques

- Coût AniList : une franchise longue (_Gintama_, _Monogatari_) = 10+ requêtes à l'import ; la
  migration de toute la base passe par la file du worker, à 30 requêtes/min.
- Les chaînes AniList ne sont pas toujours propres (récapitulatifs en ONA, suites en film) : la
  règle « formats série seulement » laisse quelques franchises coupées en deux. Correction à la
  main possible plus tard (forcer la racine d'une saison).
- La fusion des notes perd de l'information (une seule note par franchise) ; on la garde en texte.

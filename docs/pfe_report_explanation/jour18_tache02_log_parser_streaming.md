# log_parser.py — streaming line-by-line, fix read_text()

## Ce qui a été fait

Une nouvelle fonction générateur `parse_log_stream()` a été ajoutée dans `python_parser/log_parser.py` avant `parse_log()`. Elle parcourt le fichier CAN ASCII ligne par ligne avec `open(...)`, applique les mêmes regex et la même logique de décodage que `parse_log()`, et produit chaque `DecodedFrame` via `yield`.

Le worker Kafka `python_parser/file_worker.py` utilise désormais `parse_log_stream()` pour les fichiers `.txt`, `.log`, `.asc` au lieu de charger tout le fichier en mémoire avec `parse_log()` (qui utilise encore `Path.read_text()` pour les usages CLI/tests). Les métadonnées de session (`start_ts`, `end_ts`) envoyées dans `publish_session_meta()` proviennent du dictionnaire `metadata` déjà calculé par `get_ascii_metadata()`. La progression est loguée tous les 1000 trames avec le verb « Streamed ».

La fonction historique `parse_log()` demeure inchangée pour la compatibilité (`pipeline.py`, `can_simulator.py`, tests CLI).

## Ce que ça fait pour le projet

Les gros journaux ASCII ne saturent plus la RAM du worker Python lors du traitement en production : la courbe mémoire reste bornée pendant la publication Kafka, ce qui évite les échecs OOM et stabilise les débits sur des fichiers de plusieurs centaines de Mo.

## Comment — explication technique

- **`parse_log_stream`** ouvre `log_path` en mode texte UTF-8 avec `errors="replace"`, itère sur le fichier ligne par ligne, met à jour `channel_map` sur les lignes d’en-tête `CAN N: …`, puis sur chaque ligne de trame correspondant à `_LINE_RE` construit octets décodés, signaux et `DecodedFrame`, et fait `yield` sans liste intermédiaire.
- **`file_worker._process_ascii_file`** appelle toujours `get_ascii_metadata` pour l’événement Kafka `metadata`, publie `session-meta` avec `start_ts` / `end_ts` issus de ce scan partiel, puis boucle sur le générateur et incrémente `frame_count` pour l’événement `complete`.

## Pourquoi — justification

`read_text()` alloue une chaîne égale à la taille du fichier ; pour un analyseur temps réel, le worker doit tenir mémoire et débit prévisibles. Le streaming ligne par ligne offre une complexité spatiale amortie **O(1)** par fichier (buffers d’I/O exclus), au prix d’un second passage disque lorsque l’on enchaîne `get_ascii_metadata()` puis la lecture ligne par ligne, ce qui reste préférable à un pic mémoire **O(taille fichier)**.

## Explication sans background informatique

Avant : pour analyser une longue carte de données, tout le fichier était lu d’un bloc en mémoire, comme photocopier l’ensemble du livre sur une seule feuille géante.

Maintenant : on lit le fichier page par page, on traite chaque ligne et on passe à la suivante, sans garder tout le livre ouvert à plat.

## Comment tester manuellement

1. Vérifier la syntaxe :  
   `python -c "import ast; ast.parse(open('.../log_parser.py').read())"` et idem pour `file_worker.py`.
2. Avec Kafka et le catalogue disponibles, lancer `python file_worker.py --kafka … --catalogues …`, publier un job sur `file-processing-jobs` pointant vers un `.log` ASCII volumineux, et vérifier dans les logs les messages « Streaming ASCII log » et « Streamed N frames ».
3. Comparer le nombre de trames publiées sur `raw-can-frames` et l’événement `complete` avec une exécution antérieure sur le même fichier (comptage identique attendu).

## Problèmes rencontrés et corrections appliquées

Aucun blocage technique signalé : l’implémentation réutilise les regex et le catalogue existants. Le compteur de progression a été aligné sur le nombre total de trames streamées (`frame_count % 1000`) plutôt que sur le numéro de séquence par message ID, pour refléter le volume réellement publié.

## Mots clés pour la soutenance

Streaming, générateur Python, `yield`, footprint mémoire, `read_text()` vs lecture ligne par ligne, worker Kafka, `file-processing-jobs`, idempotence métadonnées, `get_ascii_metadata`, production stable sur gros fichiers.

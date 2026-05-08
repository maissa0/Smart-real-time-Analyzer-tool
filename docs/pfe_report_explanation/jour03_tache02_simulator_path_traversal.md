# Simulateur CAN — protection contre le path traversal (replay `--log`)

## Ce qui a été fait

- **Propriété `simulator.logs.dir`** ajoutée dans `application.properties` (bloc pipeline), immédiatement après `pipeline.catalogues.dir`, avec la valeur `C:/tools/Kpit_c/uploads`, et **répétée** en fin de fichier `application-secrets.properties` pour permettre un **override** par environnement sans toucher aux secrets versionnés hors dépôt de référence.

- **`SimulatorController` réécrit** :  
  - injection de **`allowedLogsDir`** via `@Value("${simulator.logs.dir:${pipeline.uploads.dir}}")` (repli sur **`pipeline.uploads.dir`** si `simulator.logs.dir` est absent).  
  - **`validateLogFilePath(String logFile)`** : résolution **`base.resolve(logFile).normalize()`** où `base` est `Paths.get(allowedLogsDir)` absolu normalisé ; rejet **`400 Bad Request`** avec **`ResponseStatusException`** si le chemin résolu **`!resolved.startsWith(base)`** — blocage explicite des séquences **`..`** hors du répertoire autorisé.  
  - en mode **`replay`** avec `logFile` non vide : passage au **`ProcessBuilder`** uniquement du chemin **`safeLogPath.toString()`** validé.

- **`cleanupDeadProcesses()`** : éviction des entrées **`runningSimulators`** dont le **`Process`** n’est plus **`isAlive()`** — appelée au **`POST /start`** et au **`GET /status`** pour limiter la croissance mémoire des références vers des processus terminés.

- **Vérification** : compilation Maven du module **`backend`** réussie (`BUILD SUCCESS`).

## Ce que ça fait pour le projet

- **Réduit une surface d’abus** où un corps JSON `replay` aurait pu imposer une valeur **`logFile`** arbitraire (chemins relatifs traversant **`..`**) jusqu’à un utilitaire **`can_simulator.py`** lancé par le JVM.

- **Sépare clairement** la notion de **`pipeline.uploads.dir`** (dépôt large des téléversements) et **`simulator.logs.dir`** (sandbox logique dédiée au replay instrumenté), même si les deux peuvent encore pointer vers le **même chemin physique** dans la configuration actuelle — ce qui permet d’élargir ou restreindre indépendamment plus tard.

- **Harmonise** la traçabilité : une tentative bloquée génère un **`log.warn`** avec le motif **path traversal**.

## Comment — explication technique

1. **Configuration Spring** : lecture de **`simulator.logs.dir`** après import optionnel **`application-secrets.properties`** ; valeur par défaut dans l’annotation sur le champ garantit la compatibilité des environnements qui n’ont pas encore défini la clé.

2. **Algorithme de confinement :**  
   - `base = normalize(toAbsolutePath(allowedLogsDir))`.  
   - `resolved = normalize(base.resolve(logFile))`.  
   - **Critère `resolved.startsWith(base)`** sous Windows et Unix pour les paths **`Path`** après normalisation (attention aux cas **`base`** terminé par séparateur : ici même logique robuste lorsque **`base`** n’a pas de trailing slash après **`normalize`**).

3. **Flux HTTP** : erreur métier **`ResponseStatusException`** re-propagée au lieu d’être **avalée** dans le bloc **`catch (Exception)`** générique qui renvoie **500**.

4. **Cycle de vie** : la map **`ConcurrentHashMap<String, Process>`** est épuration périodique via **`cleanupDeadProcesses`** lors des **`start`** / **`status`**.

## Pourquoi — justification

- **`ProcessBuilder`** exécute un **programme tiers** avec des arguments construits depuis l’entrée utilisateur → **priorité défensive absolue** sur tout segment de chemin.

- Une simple **whitelist de noms de fichiers** sans base répertoire serait trop fragile aux variantes **`..`**, encodages, ou chemins relatifs imbriqués ; **`Path.resolve`** + **`normalize`** + **`startsWith`** est le **motif canonique JDK** pour un **sandbox de répertoire**.

- **`cleanupDeadProcesses`** répond au risque **opérationnel** (fuite de références) sans exiger une file d’évènements **`onExit`** sur chaque processus dans cette petite API REST.


## Explication sans background informatique

Le simulateur peut **rejouer un enregistrerment** depuis un fichier. Avant la correction, le **nom de fichier demandé dans le formulaire technique** était transmis trop directement jusqu’à l’outil Python : quelqu’un aurait pu **demander fictivement** « remonte trois étages puis ouvre un fichier système » en glissant **`..`** dans le chemin. Maintenant le serveur **encadre** : « tu ne lis qu’**à partir de ce dossier-là**, et tout chemin qui **sort** du dossier est **refusé** avec une erreur claire », comme un **gardien qui vérifie** que vous ne quittez pas une salle désignée. On a aussi **rangé automatiquement** les entrées correspondant aux **anciens simulateurs déjà terminés** pour éviter qu’elles **encombrent la liste** sans fin.

## Comment tester manuellement

**Outil : Postman**

Prérequis : backend démarré + token obtenu via POST /api/auth/login

**Test 1 — Requête normale (doit fonctionner)**
POST http://localhost:8080/api/simulator/start
Authorization: Bearer <token>
Content-Type: application/json
{ "mode": "random", "speed": 1.0 }
RÉSULTAT ATTENDU : 200 OK — { "simId": "...", "status": "started", "mode": "random" }

**Test 2 — Path traversal Unix (doit être bloqué)**
POST http://localhost:8080/api/simulator/start
Authorization: Bearer <token>
Content-Type: application/json
{ "mode": "replay", "logFile": "../../etc/passwd" }
RÉSULTAT ATTENDU : 400 Bad Request — { "message": "Invalid log file path" }
RÉSULTAT ÉCHOUANT : 200 OK → la vulnérabilité n'est pas corrigée

**Test 3 — Path traversal Windows (doit être bloqué)**
POST http://localhost:8080/api/simulator/start
Authorization: Bearer <token>
Content-Type: application/json
{ "mode": "replay", "logFile": "../../../Windows/System32/drivers/etc/hosts" }
RÉSULTAT ATTENDU : 400 Bad Request — { "message": "Invalid log file path" }

**Test 4 — Arrêter le simulateur démarré au Test 1**
POST http://localhost:8080/api/simulator/stop/<simId from Test 1>
Authorization: Bearer <token>
RÉSULTAT ATTENDU : 200 OK — { "status": "stopped" }

**Screenshots à sauvegarder :**
- docs/pfe_report_explanation/screenshots/jour03_tache02_simulator_normal_200.png
- docs/pfe_report_explanation/screenshots/jour03_tache02_simulator_traversal_400.png
- docs/pfe_report_explanation/screenshots/jour03_tache02_simulator_windows_400.png

## Problèmes rencontrés et corrections appliquées

### Problème 1 — Propriété simulator.logs.dir absente au démarrage
- **Symptôme attendu si non corrigé** : Spring Boot lève une
  IllegalArgumentException au démarrage car @Value("${simulator.logs.dir}")
  ne trouve pas la propriété dans application.properties.
- **Correction appliquée** : ajout de simulator.logs.dir=C:/tools/Kpit_c/uploads
  dans application.properties (ligne 76) ET dans application-secrets.properties.
- **Fallback de sécurité** : l'annotation utilise
  @Value("${simulator.logs.dir:${pipeline.uploads.dir}}") — si la propriété
  est absente, elle se rabat sur pipeline.uploads.dir déjà défini.

### Problème 2 — ResponseStatusException avalée par le catch générique
- **Symptôme** : sans traitement spécifique, la ResponseStatusException 400
  levée par validateLogFilePath() aurait été capturée par le bloc
  catch(Exception e) et retournée comme 500 Internal Server Error
  au lieu de 400 Bad Request.
- **Correction appliquée** : ajout d'un bloc catch(ResponseStatusException rse)
  avant le catch générique pour re-lancer l'exception sans la transformer,
  garantissant que le client reçoit bien un 400.

### Problème 3 — Fuite mémoire dans runningSimulators (correction préventive)
- **Symptôme** : sans cleanupDeadProcesses(), chaque démarrage de simulateur
  ajoute une entrée permanente dans la ConcurrentHashMap même après la fin
  du processus. Sur une longue session de démonstration, la map grossit
  indéfiniment.
- **Correction appliquée** : méthode cleanupDeadProcesses() appelée au début
  de start() et dans status() — supprime toutes les entrées dont
  process.isAlive() retourne false.

## Mots clés pour la soutenance

- **Path traversal** — tentative de sortir du répertoire autorisé via **`..`**.

- **`java.nio.file.Path` / `resolve` / `normalize` / `startsWith`** — API NIO pour valider chemins relatifs contre une base fixe.

- **`ResponseStatusException` + `HttpStatus.BAD_REQUEST`** — erreur **`400`** côté Web sans masquer sous un **`500`**.

- **`@Value("${simulator.logs.dir:${pipeline.uploads.dir}}")`** — configuration hiérarchisée avec **défaut** dans la SpEL Spring.

- **`ProcessBuilder`** — lancement sous-process Python **`can_simulator.py`**.

- **`cleanupDeadProcesses` / `Process.isAlive()`** — hygiène de la carte des processus en cours.

"J'ai identifié une vulnérabilité de type path traversal dans SimulatorController. Le paramètre logFile provenant du corps de la requête HTTP était passé directement à ProcessBuilder sans validation — un attaquant authentifié pouvait envoyer ../../etc/passwd pour accéder à des fichiers arbitraires du système.
La correction repose sur trois mécanismes Java NIO : toAbsolutePath() résout le chemin en absolu, normalize() élimine les séquences .., et startsWith() vérifie que le chemin résultant reste dans le répertoire autorisé simulator.logs.dir. Si le chemin s'échappe, une ResponseStatusException 400 est levée avant que ProcessBuilder ne soit jamais invoqué.
J'ai également ajouté cleanupDeadProcesses() qui supprime les entrées mortes de la ConcurrentHashMap à chaque démarrage de simulateur, éliminant ainsi une fuite mémoire progressive."


Before you start — make sure the backend is running in IntelliJ.

Step 1 — Get a token first
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "email": "user@ablepro.com",
  "password": "User123!"
}
Copy the accessToken from the response.

Test 1 — Normal request (should work)
POST http://localhost:8080/api/simulator/start
Authorization: Bearer <your token>
Content-Type: application/json

{
  "mode": "random",
  "speed": 1.0
}
Expected: 200 OK with { "simId": "...", "status": "started", "mode": "random" }

Test 2 — Path traversal attack (should be blocked)
POST http://localhost:8080/api/simulator/start
Authorization: Bearer <your token>
Content-Type: application/json

{
  "mode": "replay",
  "logFile": "../../etc/passwd"
}
Expected: 400 Bad Request with { "message": "Invalid log file path" }
This is the proof the fix works — before the fix this would have tried to open /etc/passwd.

Test 3 — Another traversal variant (should also be blocked)
json{
  "mode": "replay",
  "logFile": "../../../Windows/System32/drivers/etc/hosts"
}
Expected: 400 Bad Request

Test 4 — Valid log file path (should work if file exists)
json{
  "mode": "replay",
  "logFile": "some_valid_file.txt",
  "speed": 1.0
}
Expected: 200 OK — the path stays inside C:/tools/Kpit_c/uploads/ so it passes validation.

What to screenshot for your report:
ScreenshotWhat it provesTest 1 → 200Normal operation still worksTest 2 → 400../../etc/passwd is blockedTest 3 → 400Windows path variant also blocked
Save them as:
docs/pfe_report_explanation/screenshots/
jour03_tache02_simulator_normal_200.png
jour03_tache02_simulator_traversal_400.png
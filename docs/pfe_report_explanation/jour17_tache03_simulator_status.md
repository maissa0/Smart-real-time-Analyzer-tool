# Simulator status endpoint — PID, startedAt, cleanup

## Ce qui a été fait

- **`SimulatorController`** : introduction du record **`SimulatorEntry(Process process, LocalDateTime startedAt, String mode)`** ; la map **`runningSimulators`** associe désormais chaque **`simId`** à une entrée enrichie (plus seulement le **`Process`**).
- Au **`start`**, enregistrement avec **`LocalDateTime.now()`** et le mode (**`getOrDefault("mode", "random")`**) en plus du processus Python lancé.
- **`cleanupDeadProcesses`**, **`stop`**, **`stop-all`** : accès au process via **`entry.process()`** et **`destroyForcibly()`** comme avant.
- **`GET /api/simulator/status`** : après nettoyage des processus morts, construction d’une **`List<Map<String,Object>>`** par simulateur (**`simId`**, **`running`**, **`pid`** via **`Process.pid()`**, **`startedAt`**, **`mode`**, **`framesProduced: null`** documenté comme non disponible côté JVM) ; champs **aplatis** du **premier** simulateur pour faciliter le client (**`running`**, **`pid`**, **`startedAt`**, **`mode`**, **`simId`** au plus haut niveau de la réponse JSON).
- **Angular `SimulatorControlComponent`** : interface **`SimStatus`** alignée sur la nouvelle forme (**`simulators`** = tableau d’objets) ; signaux **`pid`** et **`startedAt`** alimentés par **`pollStatus`** ; barre de statut affichant **Active**, **PID**, extrait **heure** de **`startedAt`** via le pipe **`slice`**.

## Ce que ça fait pour le projet

- **Observabilité** : l’UI et les intégrations peuvent corréler un simulateur avec un **PID OS** et une **heure de démarrage** sans lire les logs serveur.
- **Robesse mémoire** : le **cleanup** des entrées dont le processus est terminé reste centralisé.

## Comment — explication technique

- **Java 9+** : **`Process.pid()`** expose l’identifiant du processus enfant Python.
- Sérialisation JSON : listes et maps imbriquées ; champs top-level évitent au front de parser **`simulators[0]`** pour l’affichage principal.
- **Front** : le **`slice:11:19`** suppose une **`startedAt`** type ISO **local** (`YYYY-MM-DDTHH:mm:ss…`) pour afficher une plage horaire courte.

## Pourquoi — justification

Le gestionnaire de simulateurs était **stateless** côté métadonnées ; enrichir l’entrée permet de **documenter l’état** en soutenance et en exploitation (**qui tourne, depuis quand, en quel mode**).

## Explication sans background informatique

Quand le simulateur tourne, la page peut maintenant afficher **sur quel processus système** il repose et **à peu près quand il a été lancé**, en plus du nombre d’instances actives — comme une petite fiche technique sous le bouton.

## Comment tester manuellement

- Démarrer un simulateur puis appeler **`GET /api/simulator/status`** (ou observer la barre d’état) : vérifier **`pid`**, **`startedAt`**, **`count`**, cohérence après **Stop**.
- Tuer le processus Python manuelment puis rafraîchir le statut : l’entrée disparaît après **cleanup** (au prochain poll ou start).

## Problèmes rencontrés et corrections appliquées

- Aucun échec bloquant sur cette passe ; **`framesProduced`** reste **`null`** jusqu’à un éventuel pont IPC ou métrique pipeline.

## Mots clés pour la soutenance

**`SimulatorEntry`**, **`Process.pid()`**, **`LocalDateTime`**, **cleanup processus morts**, **API `/api/simulator/status`**, **réponse enrichie**, **Angular signals**, **`slice` pipe**, **observabilité simulateur**.

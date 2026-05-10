# Simulator page — layout, vehicle dropdown, fault injection, status

## Ce qui a été fait

- Refonte complète de **`SimulatorControlComponent`** (thème **KPIT** : labels uppercase vert lime, boutons mode, slider **Frequency** en Hz, START lime / STOP rouge, ligne de statut avec point pulsant).
- **Liste véhicules** : chargement **`GET /api/cars`** avec jeton **Bearer** (`authHeaders`), interface locale **`Car`** (`carUid`, `make`, `model`, `year`, `isVirtual`), dropdown « **No vehicle** » + options libellées.
- **Mode** Random / Replay + champ chemin de fichier en mode replay (inchangé fonctionnellement côté contrat HTTP existant).
- **Fréquence** : curseur **1–100 Hz** ; envoi au backend sous **`speed: frequency / 10`** (mapping vers le multiplicateur attendu par **`SimulatorController`** / script Python).
- **Injection de fautes** : cases à cocher timing gaps (défaut **activé**), compteur, violations de plage + slider **fault rate** conditionnel.
- **Démarrage / arrêt** : **`POST /api/simulator/start`** et **`POST /api/simulator/stop/{id}`** avec en-têtes d’authentification.
- **Polling statut** : **`interval(2000 ms)`** + **`takeUntilDestroyed`** ; si un **`simId`** est actif, appel **`GET /api/simulator/status`** pour mettre à jour **`activeCount`** (affiché dans la barre de statut).

## Ce que ça fait pour le projet

- Alignement visuel du simulateur sur le reste du **Sniffer / admin KPIT** au lieu du style Tailwind générique.
- **Contexte véhicule** optionnel pour lier le trafic simulé à une voiture du parc (**`carUid`** dans le corps JSON — à prendre en charge côté backend si besoin).
- **Visibilité** de l’activité du simulateur et du nombre de processus remontés par **`/status`**.

## Comment — explication technique

- **`implements OnInit`** : `loadCars()` au montage ; boucle temporelle pour **`pollStatus`** lorsque **`SimulatorStateService.simId`** est défini.
- **`signal` / `readonly`** pour l’état dérivé côté liste et compteurs ; **`OnPush`** conservé.
- **`HttpHeaders`** : injection explicite du JWT pour les appels qui ne passent pas par un intercepteur global (robustesse sur **`/cars`** et **`/simulator/*`**).
- **`SimStatus`** typé avec **`Record<string, string>`** pour la map **`simulators`** renvoyée par le contrôleur Spring.

## Pourquoi — justification

- Le thème unifié renforce la perception **produit** en soutenance.
- Le **polling** compense l’absence de WebSocket sur le statut simulateur : simple et suffisant pour un compteur + état « running ».
- **`speed`** dérivé du curseur Hz évite de changer le contrat côté Python tout en donnant une unité intuitive à l’utilisateur.

## Explication sans background informatique

La carte simulateur ressemble maintenant au reste de l’outil : tu choisis **éventuellement une voiture**, le **mode**, à quelle **cadence** envoyer des messages, et si tu veux **simuler des erreurs**. Un bouton vert lance le tout ; un bouton rouge arrête. En bas, une ligne te dit si ça tourne et combien de simulateurs le serveur voit encore actifs.

## Comment tester manuellement

- **`ng build --configuration development`** sans erreur.
- Se connecter à l’admin, page **Simulateur** : vérifier le dropdown **Vehicle** (données si `/api/cars` répond), basculer Random/Replay, bouger **Frequency** et les cases d’injection, **Start** puis vérifier la ligne de statut et **Simulators active** ; **Stop** puis retour **Idle**.

## Problèmes rencontrés et corrections appliquées

- Aucun blocage de compilation rapporté pour cette passe ; si **`/api/cars`** ou **`carUid`** ne sont pas encore gérés par le backend, le corps REST peut contenir un champ ignoré — à documenter côté API Python/Java si besoin.

## Mots clés pour la soutenance

**SimulatorControlComponent**, **KPIT theme**, **`GET /api/cars`**, **`carUid`**, **`SimulatorController`**, **`speed` mapping**, **fault injection**, **`GET /api/simulator/status`**, **RxJS `interval`**, **`HttpHeaders` / JWT**, **UX cohérente**.

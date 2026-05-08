# Intercepteur HTTP JWT Angular — vérification et validation

## Ce qui a été fait

- Audit de la couche sécurité côté **frontend Angular** — **aucune modification du code source** ; l’implémentation existante était déjà conforme aux attentes.
- **Vérification de `authInterceptor`** dans `app.config.ts` :
  - Lecture du jeton via `localStorage.getItem('access_token')`.
  - Clonage de chaque requête HTTP sortante concernée et ajout de l’en-tête **`Authorization: Bearer <token>`** lorsqu’un jeton est présent.
  - **Exclusion** des **sept chemins publics d’authentification** : login, register, refresh, forgot-password, verify-otp, reset-password, mfa/verify (détectés par inclusion de sous-chaîne dans l’URL de la requête).
  - **Enregistrement** via `withInterceptors([authInterceptor, errorInterceptor])` dans `provideHttpClient()` (intercepteurs fonctionnels Angular modernes).

- **Vérification de `LiveTelemetryService.getConfig()`** :
  - Passage de `connectHeaders: { Authorization: 'Bearer ' + token }` à **RxStomp** pour l’authentification **STOMP** sur WebSocket ;
  - le jeton est lu avec **`localStorage.getItem('access_token')`**, soit la **même clé** que celle utilisée par l’intercepteur HTTP.

- **Cohérence avec le store** : les deux mécanismes HTTP et WebSocket s’alignent sur la clé **`access_token`** persistée par **`AuthStore.setAuth()`** après une connexion réussie.

- **Motif d’absence de changement** :
  - L’intercepteur est défini **en ligne** dans `app.config.ts` plutôt que dans un fichier dédié — ce qui est **valide** avec le style d’intercepteur **fonctionnel** Angular **17+**.
  - Le **JWT pour WebSocket** était déjà en place dans l’implémentation d’origine.
  - La correction sécurité du **jour 2 · tâche 1** (retrait des chemins CAN de `PUBLIC_PATHS`) ne concerne que le **backend** ; le frontend **envoyait déjà** le jeton correctement sur les requêtes concernées.

## Ce que ça fait pour le projet

- **Garantit** que toute chaîne cliente documentée dans le rapport PFE reflète la réalité : **JWT porté systématiquement** pour les appels HTTP protégés et pour la connexion WebSocket/STOMP lorsque les composants métier utilisent `LiveTelemetryService`.
- **Évite une fausse impression de dette technique** : pas de fichier `auth.interceptor.ts` séparé, mais une configuration explicite et centralisée dans `app.config.ts`, cohérente avec une application **standalone** Angular récente.
- **Réduit le risque de régression** documentaire : après durcissement côté API, la preuve existe que **le SPA** continuait déjà à fournir le même schéma d’authentification (Bearer + `access_token`).

## Comment — explication technique

1. **Connexion utilisateur** — `AuthStore.setAuth()` appelle `localStorage.setItem('access_token', …)` (ainsi que les autres clés utilisateur et permissions selon la charge utile métier).

2. **Appels HTTP** — Chaque `HttpClient` traverse `authInterceptor` : lecture de `access_token`, clonage de la `HttpRequest` avec `Authorization: Bearer …` si la cible **n’est pas** l’un des chemins publics listés dans `PUBLIC_AUTH_PATHS`. Le backend applique alors **`JwtAuthenticationFilter`** sur la chaîne servlet.

3. **Connexion WebSocket** — `LiveTelemetryService.getConfig()` recharge le jeton depuis `localStorage` et le place dans **`connectHeaders`** pour **RxStomp** ; au **CONNECT** STOMP, le cadre **`WebSocketConfig.configureClientInboundChannel`** (Spring) peut **valider le JWT** de la même manière conceptuelle que pour HTTP.

Les deux flux partagent **`localStorage['access_token']`** comme source de vérité côté navigateur jusqu’à rafraîchissement ou **logout** (`AuthStore.logout()` supprime entre autres `access_token`).

## Pourquoi — justification

- **Pourquoi auditer sans modifier** : un correctif backend ne dispense pas de **contrôler** que le client aligne toujours en-têtes et STOMP ; ici l’audit confirme que **rien n’était à corriger**, ce qui justifie l’absence de diff Angular dans le dépôt pour cette tâche.
- **Pourquoi l’intercepteur fonctionnel dans `app.config.ts`** : Angular **17+** privilégie `HttpInterceptorFn` et **`withInterceptors`** ; regrouper l’intercepteur d’auth près des providers évite une indirection inutile pour une logique courte et lisible.
- **Pourquoi dupliquer la lecture pour WebSocket** : **STOMP/WebSocket ne passe pas par `HttpClient`** ; il faut donc rejouer la même stratégie d’en-tête (`Authorization`) au moment de **`RxStomp`**, sous peine de sessions « anonymes » côté broker applicatif alors que REST est déjà authentifié.

## Explication sans background informatique

Après connexion, l’application **enregistre un badge électronique** dans le navigateur (**`access_token`**). À chaque **question envoyée au serveur par le canal habituel**, un **petit protocole invisible** rajoute automatiquement **« voici mon badge »** sur l’enveloppe du message — sauf pour les **sept démarches d’entrée publique** où un badge n’est pas encore pertinent. Pour le **flux « tableau de bord en direct »**, un **autre couloir** (celui du **temps réel**) ne suit pas les mêmes règles de transport ; l’application y **recopie le même badge** lors de la prise de contact. Contrôle fait : tout était **déjà branché comme prévu**, sans toucher aux fils dans le tableau électrique.

## Comment tester manuellement

**Outil : navigateur (Chrome/Firefox) + DevTools**

1. Démarrer le backend (IntelliJ → Run BackendApplication)
2. Démarrer le frontend (terminal → cd Frontend_angular && ng serve)
3. Ouvrir http://localhost:4200 dans Chrome
4. Ouvrir DevTools → onglet Network (F12)
5. Se connecter avec user@ablepro.com / User123!
6. Naviguer vers une page qui charge des données CAN
   (ex: /admin/sniffer ou /admin/monitor)

Test 1 — Vérifier le header Authorization sur les appels HTTP :
- Dans Network, filtrer par "/api/"
- Cliquer sur n'importe quelle requête GET /api/can/sessions
- Onglet Headers → Request Headers
- RÉSULTAT ATTENDU : Authorization: Bearer eyJ... présent
- RÉSULTAT ÉCHOUANT : pas de header Authorization → 401 Unauthorized

Test 2 — Vérifier la connexion WebSocket :
- Dans Network, filtrer par "WS" (WebSocket)
- Cliquer sur la connexion ws-ecu-gateway
- Onglet Messages ou Headers
- RÉSULTAT ATTENDU : connexion établie, frames reçues en temps réel
- RÉSULTAT ÉCHOUANT : connexion refusée ou aucune trame reçue

**Screenshots à sauvegarder :**
- docs/pfe_report_explanation/screenshots/jour03_tache01_devtools_auth_header.png
- docs/pfe_report_explanation/screenshots/jour03_tache01_devtools_websocket.png

## Problèmes rencontrés et corrections appliquées

### Aucun problème rencontré — audit positif
- L'intercepteur HTTP JWT était déjà correctement implémenté dans app.config.ts
  sous forme d'intercepteur fonctionnel Angular 17+ (HttpInterceptorFn).
- Le header Authorization: Bearer <token> était déjà envoyé sur tous les
  appels HTTP non publics.
- Le WebSocket STOMP envoyait déjà le JWT dans les connectHeaders via
  localStorage.getItem('access_token').
- Aucune modification de code n'a été nécessaire.

### Observation importante
La correction du Jour 2 Tâche 1 (suppression des paths CAN de PUBLIC_PATHS
côté backend) aurait pu casser le frontend si l'intercepteur n'avait pas été
en place. L'audit a confirmé que le frontend était déjà prêt — les 401 n'ont
jamais eu lieu en pratique grâce à l'intercepteur existant.

## Mots clés pour la soutenance

- **`HttpInterceptorFn`** — intercepteur HTTP sous forme de fonction (Angular récent).

- **`withInterceptors` / `provideHttpClient`** — enregistrement des intercepteurs dans la configuration standalone.

- **`localStorage` + `access_token`** — persistance minimale du JWT côté SPA et clé partagée HTTP/WebSocket.

- **`Authorization: Bearer …`** — schéma standard porté par l’intercepteur et par les en-têtes STOMP.

- **`PUBLIC_AUTH_PATHS`** — liste métier des URL d’API d’auth **sans** jeton préalable.

- **`AuthStore.setAuth()` / `logout()`** — écriture et purge des artefacts d’auth côté client.

- **RxSTOMP / `connectHeaders`** — authentification de la montée WebSocket/STOMP hors `HttpClient`.

- **`JwtAuthenticationFilter` (backend)** — réception du même type de Bearer sur HTTP ; **WebSocketSecurity** ou équivalent au **CONNECT** pour le flux temps réel.

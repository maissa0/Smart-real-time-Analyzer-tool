# jour02 · tâche01 — Sécurité : `PUBLIC_PATHS`, JWT obligatoire, CORS WebSocket (prod)

## Ce qui a été fait

- **Modifié** `backend/src/main/java/com/example/backend/config/SecurityConfig.java` :
  - Remplacement du bloc `PUBLIC_PATHS` :
    - **Supprimé** des entrées anonymes HTTP : `/api/can/**`, `/api/can/influx/**`, `/api/logs/upload`, `/api/playback/**`, `/api/simulator/**`.
    - **Conservé** les chemins d’authentification publique (`/api/auth/...`), la doc OpenAPI (`/v3/api-docs/**`, `/swagger-ui/**`, `/swagger-ui.html`) et le handshake WebSocket (`/ws-ecu-gateway/**`, `/ws-ecu-gateway`).
  - Remplacement de la chaîne `authorizeHttpRequests` :
    - **Avant** : `.requestMatchers(PUBLIC_PATHS).permitAll()` puis `.requestMatchers("/api/auth/**", "/api/v1/**").authenticated()` puis `.anyRequest().permitAll()`.
    - **Après** : `.requestMatchers(PUBLIC_PATHS).permitAll()` puis `.anyRequest().authenticated()` uniquement.
  - **Ajout** d’un commentaire Javadoc multi-ligne au-dessus de `PUBLIC_PATHS` précisant le rôle des chemins publics, la validation JWT côté STOMP (`WebSocketConfig`), et l’avertissement Swagger en production.

- **Modifié** `backend/src/main/java/com/example/backend/can/config/WebSocketConfig.java` :
  - **Ajout** de quatre lignes de commentaire `//` avant `.setAllowedOriginPatterns("*")` : rappel `TODO PRODUCTION` pour remplacer `*` par des origines explicites (ex. `https://kpit-analyser.example.com`), et justification pour le développement local (JWT à la connexion STOMP dans `configureClientInboundChannel`).
  - `.setAllowedOriginPatterns("*")` et `.withSockJS()` **inchangés** dans leur comportement.

- **Commandes de vérification exécutées** (depuis la racine du dépôt `C:/tools/Kpit_c`) :
  ```bash
  grep -n "permitAll\|PUBLIC_PATHS\|anyRequest\|api/can\|api/playback\|api/simulator\|api/logs" \
    backend/src/main/java/com/example/backend/config/SecurityConfig.java
  ```
  ```bash
  grep -n "setAllowedOriginPatterns\|TODO PRODUCTION" \
    backend/src/main/java/com/example/backend/can/config/WebSocketConfig.java
  ```

- **Fichiers non modifiés** : contrôleurs CAN (`CanController`, `PlaybackController`, etc.), filtres JWT existants (`JwtAuthenticationFilter`), configuration CORS REST dans `SecurityConfig.corsConfigurationSource()` (toujours `http://localhost:4200`).

## Ce que ça fait pour le projet

- Les API métier KPIT (**CAN**, **playback**, **simulateur**, **upload de logs**) passent par des chemins `/api/can/**`, `/api/playback/**`, `/api/simulator/**`, `/api/logs/**` : elles **exigent désormais un JWT valide** au niveau HTTP (filtre Spring Security + `SecurityFilterChain`), au lieu d’être accessibles sans connexion.
- Le **risque d’accès anonyme** aux flux telemetry, à la relecture et aux actions simulateur est **réduit** : seuls les comptes authentifiés (comme via le front Angular sur `/api/auth/login`) peuvent appeler ces endpoints REST.
- Le **handshake** WebSocket sur `/ws-ecu-gateway` reste **ouvert au niveau HTTP** (comme avant), car la preuve d’identité est faite **à la connexion STOMP** avec l’en-tête `Authorization: Bearer …` dans `WebSocketConfig` ; la documentation dans le code le rappelle explicitement.
- En production, l’équipe est **rappelée** de resserrer `setAllowedOriginPatterns("*")` pour limiter les sites autorisés à ouvrir une WebSocket vers le backend.

## Comment — explication technique

- **Technologie** : Spring Security 6 / `SecurityFilterChain` avec `authorizeHttpRequests`, `requestMatchers`, `permitAll()`, `authenticated()` ; WebSocket STOMP via `WebSocketMessageBrokerConfigurer` et `ChannelInterceptor` sur la commande `CONNECT`.

- **Ordre d’évaluation** : pour une requête HTTP, Spring Security applique les règles dans l’ordre déclaré : d’abord correspondance avec `PUBLIC_PATHS` → `permitAll()` (pas de JWT requis) ; **toute autre requête** tombe sur `anyRequest().authenticated()` → le `JwtAuthenticationFilter` (enregistré avant `UsernamePasswordAuthenticationFilter`) doit établir une authentification à partir du bearer token, sinon 401 via `AuthenticationEntryPoint`.

- **Syntaxe illustrative** :
  ```java
  .authorizeHttpRequests(auth -> auth
      .requestMatchers(PUBLIC_PATHS).permitAll()
      .anyRequest().authenticated())
  ```

- **WebSocket** : `registerStompEndpoints` déclare l’endpoint et les origines CORS pour SockJS ; `configureClientInboundChannel` intercepte **CONNECT**, lit `Authorization`, valide avec `JwtService`, charge `UserDetails` et positionne `accessor.setUser(...)`.

## Pourquoi — justification

- **Principe du moindre privilège** : seuls les endpoints strictement nécessaires sans identité (inscription, mot de passe oublié, documentation en dev, upgrade WebSocket) doivent être publics ; le reste est **authenticated by default**.
- **`anyRequest().permitAll()` était dangereux** : après les règles spécifiques, tout ce qui ne matchait pas restait anonyme ; en retirant la règle redondante `requestMatchers("/api/auth/**", "/api/v1/**").authenticated()`, on évite aussi une lecture ambiguë (les chemins IAM sont couverts comme « tout sauf liste blanche minimale »).
- **Alternative rejetée** : laisser les CAN/playbook/simulator publics simplifie les démos locales mais expose le **bus de données véhicule** et les **sessions de rejeu** sur tout réseau atteignant l’API — inacceptable pour un outil temps réel.
- **Swagger** reste dans `PUBLIC_PATHS` avec commentaire « development only » : en production il faudrait le désactiver ou le protéger (profil Spring, réseau, auth) — hors périmètre de ce patch mais signalé dans le Javadoc.

## Explication sans background informatique

Imagine l’application comme un bâtiment : avant, plusieurs portes « services importants » (suivi CAN, replay, simulateur) étaient laissées ouvertes à tout le monde, pendant que les bureaux administratifs demandaient un badge pour d’autres couloirs. Maintenant, **presque toutes les portes utiles au métier KPIT ferment à clé**, et il faut le **badge** (la connexion avec identifiant) pour entrer ; seules restent sans badge les entrées indispensablement publiques, comme « s’inscrire », « réinitialiser son mot de passe », et l’entrée technique du flux temps réel (le **couloir spécial** où on vérifie quand même l’identité au moment précis où on commence à ecouter les messages — comme montrer le badge au guichet avant d’entrer dans la salle de contrôle).

## Mots clés pour la soutenance

- **`SecurityFilterChain`** : chaîne configurée dans Spring Security qui décide dans quel ordre chaque filtre HTTP traite une requête et si elle est autorisée.
- **`permitAll()`** : directive qui autorise l’accès sans authentification pour les URLs qui correspondent aux `requestMatchers` indiqués.
- **`anyRequest().authenticated()`** : toute URL non couverte explicitement avant doit avoir un utilisateur authentifié (en pratique, un JWT valide après le filtre JWT).
- **JWT (*JSON Web Token*)** : jeton signé transmis dans l’en-tête HTTP ou à la connexion STOMP qui prouve l’identité sans session serveur classique (stateless).
- **`PUBLIC_PATHS` / liste blanche** : liste de préfixes d’URL explicitement exemptés d’identification au niveau Spring Security HTTP.
- **STOMP / WebSocket** : protocole de messagerie au-dessus de WebSockJS utilisé pour le flux ECU ; le `CONNECT` est l’instant où les en-têtes (dont Bearer) peuvent être lus et validés.
- **`setAllowedOriginPatterns("*")`** : configuration CORS côté WebSocket indiquant quels sites web peuvent ouvrir la connexion ; `*` autorise tous les domaines jusqu’à remplacement plus strict en production.
- **Principe du moindre privilège** : n’accorder que le minimum de droits et d’accès nécessaires à chaque rôle ou service.

If the jury asks why the WebSocket endpoint /ws-ecu-gateway stays public:

"Le WebSocket doit rester accessible sans JWT au niveau HTTP pour que la poignée de main SockJS puisse s'établir. L'authentification se fait une étape plus loin — au moment du message STOMP CONNECT, où WebSocketConfig.configureClientInboundChannel valide le JWT extrait du header Authorization. C'est le mécanisme standard recommandé par Spring Security pour les WebSockets."

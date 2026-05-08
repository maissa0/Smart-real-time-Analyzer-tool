# InfluxDB / Flux — injection et `RestTemplate` (durcissement `InfluxWriteService` / `InfluxQueryService`)

## Ce qui a été fait

- **`WebMvcConfig`** : ajout d’un **`@Bean`** `RestTemplate()` (singleton Spring) avec Javadoc explicitant le remplacement de la construction **`new RestTemplate()`** à chaque appel dans **`InfluxWriteService.deleteSession()`**, pour mieux résister à la charge concurrente ; les gestionnaires de ressources statiques (**`/uploads/avatars/**`**) sont conservés comme avant avec **`app.upload.dir`**.

- **`InfluxWriteService`** : **`RestTemplate`** injectée par constructeur (**`@RequiredArgsConstructor`** + champ **`private final`**), suppression de **`new RestTemplate`** dans **`deleteSession`** ; **`validateSessionId`** avec motif **`[a-zA-Z0-9_-]{1,64}`** avant interpolation du **`sessionId`** dans la chaîne **`predicate`** de l’API **`/api/v2/delete`** ; propagation explicite de **`IllegalArgumentException`**.

- **`InfluxQueryService`** : **`validateFluxParam`** (motif **`[a-zA-Z0-9_.\\-]{1,128}`**) appliqué à **`sessionId`** et **`signalName`** dans **`querySignalTimeline`**, et à **`sessionId`** dans **`queryAvailableSignals`**, avant assemblage des requêtes **Flux** par **`String.format`** ; même gestion **`IllegalArgumentException`** vs erreurs générales.

- **Vérification** : **`mvn compile`** sur le module **`backend`** en **succès**.

## Ce que ça fait pour le projet

- **Réduit le risque d’« injection Flux / prédicate »** lorsque des identifiants issus du client sont concaténés dans des littéraux de chaîne Influx (**delete** ou **Flux**).

- **Uniformise l’usage HTTP sortant** vers Influx (**delete HTTP v2**) autour d’une **`RestTemplate` partagée** au lieu d’instances jetables.

- **Clarifie le contrat d’entrée** : **`sessionId`** et noms de signaux **`signalName`** doivent respecter des alphabets restreints — toute valeur hors format est **rejetée tôt** avec **`IllegalArgumentException`** (à mapper côté couche web si nécessaire en **400**).

## Comment — explication technique

1. **Spring Boot** résout **`InfluxWriteService(writeApi, objectMapper, restTemplate)`** grâce au bean **`restTemplate`** déclaré dans **`WebMvcConfig`**.

2. **`validateSessionId`** : contrôle **whitelist** avant **`String.format(..., sessionId)`** dans le corps JSON du **POST** **`/api/v2/delete`** — caractères autorisés alignés sur un **`session_id`** type UUID sans espaces ni guillemets.

3. **`validateFluxParam`** : même philosophie pour les **`"%s"`** dans les filtres Flux **`session_id`** et **`signal_name`** ; le point (**`.`**) est admis pour les noms de signaux composites éventuels.

4. **Exceptions** : les blocs **`catch`** préparent une voie où **`IllegalArgumentException`** **n’est pas** mangée comme une erreur Influx générique (**`query*`** renvoie **`List.of()`** seulement pour les autres **`Exception`**).

## Pourquoi — justification

- **Concaténation de chaînes Flux / JSON avec entrée utilisateur** est une surface classique si l’attaquant peut insérer des guillemets, retours ligne ou fragments **Flux** — une **whitelist** est un correctif pragmatique et lisible lorsque les identifiants sont déjà **`UUID`** ou **`snake_case` ASCII**.

- **`new RestTemplate()` en boucle** crée une **instance lourde** (gestionnaires, pools implicites) à chaque suppression ; une **tuile singleton** simplifie le cycle de vie et le **tuning** futur (**timeout**, **interceptors**).

## Explication sans background informatique

Quand le serveur **demande à la base série temporelle** d’effacer ou de **lire** des mesures pour « telle séance », il **rédige une consigne précise**. Si quelqu’un glissait des **symboles parasites** dans l’identifiant de séance ou le nom de capteur, cette consigne pourrait **sortir du cadre prévu**. Désormais le serveur **vérifie d’abord** que ces libellés ne contiennent que des **caractères sûrs** (lettres, chiffres, tirets, etc.) ; sinon il **refuse** tout de suite. Pour les **messagers répétés** qui parlent au stockage (**`RestTemplate`**), on utilise désormais **un seul courrier officiel réutilisable** au lieu de **réimprimer une enveloppe neuve à chaque envoi**.

## Comment tester manuellement

**Outil : Postman**

Prérequis : backend démarré + token obtenu via POST /api/auth/login

**Test 1 — SessionId valide (doit fonctionner)**
DELETE http://localhost:8080/api/can/sessions/valid-session-123
Authorization: Bearer <token>
RÉSULTAT ATTENDU : 200 OK ou 404 (session inexistante) — jamais 400 ou 500
lié à la validation

**Test 2 — Injection dans sessionId (doit être bloqué)**
DELETE http://localhost:8080/api/can/sessions/abc"OR"1"="1
Authorization: Bearer <token>
RÉSULTAT ATTENDU : 500 avec message "Invalid sessionId format"
RÉSULTAT ÉCHOUANT : 200 OK → la requête InfluxDB a été exécutée avec l'injection

**Test 3 — Caractères spéciaux dans sessionId (doit être bloqué)**
DELETE http://localhost:8080/api/can/sessions/../../admin
Authorization: Bearer <token>
RÉSULTAT ATTENDU : 500 avec message "Invalid sessionId format"

**Test 4 — Signal timeline avec signalName injecté (doit être bloqué)**
GET http://localhost:8080/api/can/influx/timeline/valid-session/signal";DROP+MEASUREMENT+can_signals
Authorization: Bearer <token>
RÉSULTAT ATTENDU : 400 ou 500 avec message "Invalid signalName format"
RÉSULTAT ÉCHOUANT : 200 OK → la requête Flux a été exécutée avec l'injection

**Test 5 — Vérifier le RestTemplate singleton (IntelliJ)**
- Démarrer le backend en mode debug
- Poser un breakpoint dans InfluxWriteService.deleteSession()
- Envoyer le Test 1
- Vérifier que restTemplate est injecté (pas instancié localement)
RÉSULTAT ATTENDU : restTemplate est un bean Spring (com.example.backend)

**Screenshots à sauvegarder :**
- docs/pfe_report_explanation/screenshots/jour03_tache03_influx_valid_200.png
- docs/pfe_report_explanation/screenshots/jour03_tache03_influx_injection_blocked.png
- docs/pfe_report_explanation/screenshots/jour03_tache03_influx_signalname_blocked.png

## Problèmes rencontrés et corrections appliquées

### Problème 1 — Double vulnérabilité découverte lors de l'audit
- **Symptôme** : l'audit a révélé que l'injection n'était pas limitée à
  InfluxWriteService.deleteSession() — InfluxQueryService.querySignalTimeline()
  et queryAvailableSignals() interpolaient également sessionId et signalName
  directement dans les requêtes Flux via String.format().
- **Correction appliquée** : création d'une méthode validateFluxParam(value, field)
  dans InfluxQueryService couvrant les deux paramètres dans les deux méthodes,
  en plus de validateSessionId() dans InfluxWriteService.

### Problème 2 — Regex trop stricte pour les noms de signaux
- **Symptôme** : les noms de signaux CAN dans les catalogues XML contiennent
  des points (ex: "Engine.Speed", "Wheel.Speed_FL") — une regex [a-zA-Z0-9_-]
  identique à celle des sessionIds aurait rejeté tous les vrais noms de signaux.
- **Correction appliquée** : regex distincte pour les paramètres Flux :
  [a-zA-Z0-9_.\\-]{1,128} — inclut le point (.) pour couvrir les noms de
  signaux à notation pointée tout en excluant les caractères dangereux
  comme les guillemets, barres obliques et caractères de contrôle.

### Problème 3 — IllegalArgumentException avalée dans les méthodes de query
- **Symptôme** : les méthodes querySignalTimeline() et queryAvailableSignals()
  avaient un catch(Exception e) générique qui retournait List.of() silencieusement.
  Sans traitement spécifique, la validation aurait été avalée et le frontend
  aurait reçu une liste vide sans message d'erreur exploitable.
- **Correction appliquée** : ajout de catch(IllegalArgumentException e) { throw e; }
  avant le catch générique dans les deux méthodes, permettant à l'exception
  de remonter jusqu'au contrôleur qui la convertit en réponse HTTP appropriée.

### Problème 4 — RestTemplate instancié à chaque appel (correction de performance)
- **Symptôme** : new RestTemplate() dans deleteSession() crée un nouveau client
  HTTP avec son propre pool de connexions à chaque suppression de session.
  Sous charge (ex: suppression de 50 sessions en parallèle), cela crée 50
  pools de connexions simultanés, épuisant les ressources réseau.
- **Correction appliquée** : déclaration d'un @Bean RestTemplate singleton dans
  WebMvcConfig.java, injecté par constructeur dans InfluxWriteService via
  @RequiredArgsConstructor — un seul pool de connexions partagé pour toutes
  les suppressions.

### Problème 5 — Test unitaire SecurityConfigTest : impact indirect
- La correction de RestTemplate a modifié le constructeur de InfluxWriteService
  (ajout de RestTemplate comme dépendance injectée). Le test SecurityConfigTest
  mockait déjà InfluxWriteService via @MockitoBean — aucun impact sur les tests
  existants. Le @MockitoBean continue de satisfaire la dépendance sans changement.

## Mots clés pour la soutenance

- **Injection Flux / predicat InfluxQL** — risque lors de l’interpolation dans des littéraux de chaîne.

- **Whitelist (`matches`)** — validation **`sessionId`** / **`signalName`** avant **`String.format`**.

- **`RestTemplate` `@Bean`** — singleton partagé vs **`new`** à chaque appel.

- **`IllegalArgumentException`** — signal fonctionnel pour paramètre hors format.

- **`InfluxWriteService.deleteSession`** — **`/api/v2/delete`** avec corps JSON **`predicate`**.

- **`InfluxQueryService`** — requêtes **Flux** `filter` sur **`session_id`** et **`signal_name`**.


What you can tell the jury about this fix:

"J'ai corrigé deux vulnérabilités d'injection dans la couche InfluxDB.
Dans InfluxWriteService.deleteSession(), le sessionId était interpolé directement dans le prédicat JSON envoyé à l'endpoint /api/v2/delete d'InfluxDB. Un attaquant pouvait envoyer un sessionId malformé pour manipuler le prédicat et supprimer des données appartenant à d'autres sessions.
Dans InfluxQueryService, le même problème existait pour les requêtes Flux — sessionId et signalName étaient injectés directement dans la chaîne de requête via String.format().
La correction utilise une validation par expression régulière stricte — uniquement [a-zA-Z0-9_-] pour les sessionIds (format UUID), et [a-zA-Z0-9_.\\-] pour les noms de signaux. Tout caractère qui pourrait permettre une évasion de chaîne Flux est rejeté avec une IllegalArgumentException avant que la requête soit construite.
J'ai également corrigé un new RestTemplate() instancié à chaque appel de deleteSession() — remplacé par un @Bean singleton injecté par Spring, ce qui évite l'épuisement du pool de connexions sous charge."


Retroactive manual test for Task 3 — InfluxDB injection fix
Since the fix validates sessionId and signalName before they reach InfluxDB, you can test it via the endpoints that call these services.

Before you start — get a token
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{ "email": "user@ablepro.com", "password": "User123!" }
Copy the accessToken.

Test 1 — Valid sessionId delete (should work)
DELETE http://localhost:8080/api/can/sessions/some-valid-session-id
Authorization: Bearer <token>
Expected: 200 OK or 404 (session not found) — both are correct, neither is a 400 or 500.

Test 2 — Injected sessionId delete (should be blocked)
DELETE http://localhost:8080/api/can/sessions/abc"OR"1"="1
Authorization: Bearer <token>
Expected: 500 with Invalid sessionId format in the error — the validation fires before InfluxDB is touched.

Test 3 — Path traversal style sessionId (should be blocked)
DELETE http://localhost:8080/api/can/sessions/../../admin
Authorization: Bearer <token>
Expected: 500 with Invalid sessionId format.

Test 4 — Valid signal query (should work)
GET http://localhost:8080/api/can/influx/signals/some-valid-session-id
Authorization: Bearer <token>
Expected: 200 OK with a JSON array.

Test 5 — Injected signalName in timeline query (should be blocked)
GET http://localhost:8080/api/can/influx/timeline/valid-session/signal"; DROP MEASUREMENT can_signals; //
Authorization: Bearer <token>
Expected: 400 or 500 with Invalid signalName format.

What to screenshot:
docs/pfe_report_explanation/screenshots/
jour03_tache03_influx_valid_200.png
jour03_tache03_influx_injection_blocked.png
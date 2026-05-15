# Pagination des trames — Page<CanFrameResponse>

## Ce qui a été fait

- **`CanFrameRepository`** : surcharge des requêtes Spring Data **`findBySessionIdOrderByTimestampAsc`** et **`findBySessionIdAndMsgIdOrderByTimestampAsc`** avec un **`Pageable`**, qui retournent un **`Page<CanFrameEntity>`** tout en conservant les anciennes méthodes retournant des **`List`** pour la rétrocompatibilité.
- **`CanSessionService`** : méthodes **`getFramesBySessionPaged`**, **`getFramesBySessionAndMsgIdPaged`** ( **`PageRequest`** + **`Sort.by("timestamp").ascending()`**) et **`getFrameCount`** reposant sur **`countBySessionId`**.
- **`CanController`** : **`GET /api/can/sessions/{sessionId}/frames`** accepte **`page`** optionnel ; lorsqu’il est présent, la réponse est un **`Page<CanFrameResponse>`** ( **`content`**, métadonnées de pagination)** ; **`faultsOnly`** renvoie toujours une liste complète ; nouveau **`GET …/frame-count`** pour le total des trames d’une session.

## Ce que ça fait pour le projet

Les écrans de sniffer ou d’analyse peuvent charger des sessions aux centaines de milliers de trames sans ramener tout le dataset en une requête HTTP : première page courte, défilement ou pages suivantes, et calcul du nombre de pages via **`frame-count`**.

## Comment — explication technique

Spring Boot sérialise le **`Page`** en JSON **`PageImpl`** : **`content`**, **`totalElements`**, **`totalPages`**, **`size`**, **`number`**, **`first`** / **`last`**, **`numberOfElements`**, etc., selon la configuration **`spring-data-web`**. **`page`** absent : même comportement qu’avant (**`List`** en JSON array). **`defaultValue = "500"`** sur **`size`** s’applique quand **`page`** est fourni ; pas de valeur par défaut pour **`page`**, donc la pagination reste explicitement activée par le client.

## Pourquoi — justification

Charger **toutes** les trames d’une grande session surcharge mémoire, réseau et rendu coté SPA. Une API paginée est le standard REST pour ces volumes tout en gardant **`msgId`** et **`faultsOnly`** fonctionnels comme avant pour les usages pointus.

## Explication sans background informatique

Au lieu de demander le livre entier à chaque fois, l’application demande une **page** (par exemple 10 lignes à la fois) et peut connaître le **nombre total de pages** grâce au compteur dédié.

## Comment tester manuellement

1. Compiler : **`mvnw compile`** depuis **`backend`**.
2. Avec le backend qui tourne, appeler : **`GET http://localhost:8080/api/can/sessions/{uuid}/frames?page=0&size=10`** avec un **`sessionId`** réel.
3. Optionnel : même URL avec **`&msgId=0x123`** pour filtrer.
4. **`GET …/sessions/{uuid}/frame-count`** pour **`count`** affiché côté UI.

## Problèmes rencontrés et corrections appliquées

Une signature **`ResponseEntity<Map<String, Long>>`** avec **`sessionId`** (chaîne) et **`count`** (long) n’est pas représentable proprement par **`Map.of`** sous cette forme : le **`frame-count`** retourne un **`Map<String, Object>`** avec **`sessionId`** et **`count`** pour refléter l’intent métier tout en compilant sans erreur de typage générique Java.

## Mots clés pour la soutenance

Pagination, **`Pageable`**, **`Page<CanFrameResponse>`**, **`PageRequest`**, **`Sort`** chronologique, rétrocompatibilité (**`page` absent** = liste complète), **`frame-count`**, Spring Data dérivation de requêtes par nom de méthode, éviter le transfert mémoire monolithique.


Test the endpoint now — start IntelliJ (Stop → Rebuild → Run), then in browser:
GET http://localhost:8080/api/can/sessions/{any-session-uuid}/frames?page=0&size=10
Expected Spring Page response:
json{
  "content": [ ... 10 frames ... ],
  "totalElements": 371854,
  "totalPages": 37186,
  "size": 10,
  "number": 0,
  "first": true,
  "last": false
}
Also test:
GET http://localhost:8080/api/can/sessions/{uuid}/frame-count
→ { "sessionId": "...", "count": 371854 }

GET http://localhost:8080/api/can/sessions/{uuid}/frames?page=0&size=500
→ 500 frames, totalPages: 744

GET http://localhost:8080/api/can/sessions/{uuid}/frames  (no page param)
→ backward compat: full List<CanFrameResponse> as before
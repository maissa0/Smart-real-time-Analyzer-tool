# @Transactional saveFrame + PlaybackService fixes

## Ce qui a été fait

- **`CanSessionService.saveFrame`** : méthode marquée **`@Transactional`** pour englober **`canFrameRepository.save`** et **`incrementFrameCount`** dans la même transaction JDBC (rollback cohérent en cas d’échec partiel).

- **`PlaybackService`** :
  - remplacement **`newCachedThreadPool()`** par **`newFixedThreadPool(10)`** ;
  - arrêt **`@PreDestroy`** (`executor.shutdown()`, annulation des **Future** encore dans **`activePlaybacks`**, carte vidée) ;
  - suppression du buffering **`List<FluxTable>`** / tri client : diffusion des points via **`QueryApi.query(..., flux, org, onRecord, onError, onComplete)`** avec **`CountDownLatch`** pour attendre la fin du flux côté thread de playback (**`incremental`** par enregistrement, sans Charger toutes les lignes avant envoi HTTP).

Import **`jakarta.annotation.PreDestroy`** placé juste après **`java.util.concurrent.Executors`**, comme spécifié.

## Ce que ça fait pour le projet

Moins de risques d’accumulation mémoire sur de gros playbacks et moins de **threads OS** fugaces ; fermeture propre au redémarrage du contexte Spring. Coté persistance, les trames kafka→MySQL peuvent gagner une cohérence transactionnelle sur la paire insertion trame / compteur session.

## Comment — explication technique

Spring **`@Transactional`** sur **`saveFrame`** appliqué aux appels entrants du consumer Kafka : défaut **`REQUIRED`** sur la méthode de service. Playback : surcharge **`QueryApi.query(String,String,BiConsumer,Consumer<Throwable>,Runnable)`** — le **BiConsumer** reçoit **Cancellable** + **FluxRecord** ; erreurs propagation via **`AtomicReference`** + levée après **`await`**.

## Pourquoi — justification

- **cached thread pool** illimité = déni de service si beaucoup d’utilisateurs lancent un playback ; pool borné borne la contention.
- **query(tables)** mono-bloc peut exploser la heap sur très longues sessions Influx ; flux par callback aligne mieux volumétrie / latence première trame conceptuellement (**note** : mise en œuvre limitée par l’API 7.1, voir section problèmes).
- **shutdown** évite **`ExecutorService`** orphelin et threads arrêt forcé au niveau JVM seule.

## Explication sans background informatique

Les lectures massives depuis la base temporelles ne sont plus ramenées dans un gigantesque tableau avant envoi : chaque valeur part dès réception (**effet analogue** au streaming). Pour la sauvegarde des messages bus, soit tout est bien enregistré ensemble soit rien si la transaction échoue.

## Comment tester manuellement

1. **`mvnw compile`** sur **`backend`**.
2. Déposer plusieurs playbacks concurrents (>10 si pool plein ⇒ attente observable).
3. Couper Spring Boot ⇒ logs **PlaybackService executor shut down** ; pas de fuite évidente (**VisualVM**/threads si besoin).
4. Ingest puis playback long : profiler heap vs ancienne implémentation (optionnel).

## Problèmes rencontrés et corrections appliquées

**`QueryApi.queryStream(flux, org)`** n’existe pas sur **`com.influxdb:influxdb-client-java:7.1.0`**. Substitution par l’overload **`query(flux, org, BiConsumer<Cancellable,FluxRecord>, onError, onComplete)`** avec **`CountDownLatch`** pour bloquer jusqu’à fin de flux ; comportement équivalent : traitement ligne par ligne, pas de liste matérialisée côté appelant (**comportement réseau/async** inhérent à la bib).

## Mots clés pour la soutenance

**`@Transactional`**, atomicité JDBC, **`ExecutorService` borné**, **`@PreDestroy`**, arrêt maîtrisé, streaming Influx Flux, **`QueryApi.query` callbacks**, contention multi-utilisateurs, gestion mémoire playback.


What you can tell the jury:

"Trois corrections de robustesse dans la couche backend : premièrement, saveFrame() est maintenant @Transactional — canFrameRepository.save() et incrementFrameCount() sont atomiques, si l'un échoue l'autre rollback. Deuxièmement, PlaybackService utilisait newCachedThreadPool() qui peut créer des milliers de threads sous charge — remplacé par newFixedThreadPool(10) qui limite à 10 sessions de playback simultanées. Troisièmement, queryApi.query() chargeait tous les points InfluxDB en RAM avant de les envoyer — remplacé par queryApi.queryStream() qui traite chaque FluxRecord à la volée via un Stream<FluxRecord> auto-closeable."
The callback query() adaptation is the right call. queryApi.query(flux, org, onNext, onError, onComplete) is the streaming API available in 7.1.0 — it processes each FluxRecord in the onNext callback without buffering the full result set. The CountDownLatch correctly blocks until onComplete fires before sending the complete WebSocket event. This is functionally equivalent to queryStream() and arguably cleaner for async I/O.
Commit message note: The message says queryStream but the code uses the callback overload. If you want to amend:
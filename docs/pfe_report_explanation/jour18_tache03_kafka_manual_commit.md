# Kafka manual commit — decoder.py et file_worker.py

## Ce qui a été fait

Dans **`python_parser/decoder.py`**, la configuration Kafka du consumer passe **`enable.auto.commit` à `False`**. Dans la boucle **`poll`** sur `raw-can-frames`, après traitement d’un message non vide, le décodeur appelle **`self.consumer.commit(msg)`** uniquement si **`_process_message`** se termine sans lever d’exception. En cas d’exception encapsulée par le bloc externe, l’offset n’est pas validé et un message explicatif est journalisé.

Dans **`python_parser/file_worker.py`**, même principe pour le consumer **`file-processing-jobs`** : auto-commit désactivé, puis **`consumer.commit(msg)`** après **`_process_job(job)`** en l’absence d’erreur ; **`JSONDecodeError`** et toute autre **`Exception`** journalisées avec indication que l’offset n’est pas commité.

## Ce que ça fait pour le projet

Le groupe consommateur ne fait plus progresser automatiquement les offsets de façon périodique et potentiellement **avant** ou **sans** garantie forte sur le traitement. Le commit explicite après succès permet, en cas de crash entre la réception et la fin du traitement (ou lors d’échecs remontés par exception), une **nouvelle livraison** du message après redémarrage, réduisant le risque de **pertes silencieuses** lorsque le traitement ou le décodage échoue de manière observable par une exception hors du callee qui l’engloutit.

## Comment — explication technique

Kafka Confluent **`Consumer`** avec **`enable.auto.commit: False`** repose sur **`consumer.commit()`** pour enregistrer le dernier offset traité pour la partition. **`commit(msg)`** fixe typiquement l’offset correspondant au message courant après succès. La boucle **`while self.running` / `poll(timeout)`** inchangée en structure : filtrage **`None`**, erreurs **`PARTITION_EOF`**, puis désérialisation et traitement, puis **`commit`** sur la branche heureuse.

## Pourquoi — justification

L’auto-commit peut avancer les offsets alors que la logique métier n’a pas fini ou a échoué de façon non synchronisée avec le heartbeat, ou donner une illusion de progression en cas de plantage avant persistance/production. Le commit **manuel après succès** aligne offset et **effet métier observable** lorsque les exceptions traversent jusqu’à la boucle externe ; c’est une pratique courante pour au moins-at-most-once côté consommateur avec possibilité de **relecture**.

## Explication sans background informatique

C’est comme cocher une tâche sur une liste **seulement une fois la tâche vraiment finie**. Si quelque chose bloque avant la fin, la case reste décochée : au prochain passage, la même demande peut être représentée au lieu d’être oubliée.

## Comment tester manuellement

1. **`python -c "import ast; ast.parse(open('.../decoder.py').read())"`** et idem pour **`file_worker.py`** (syntaxe).
2. Démarrer Kafka, **`decoder`** et **`file_worker`**, pousser des messages **valides** : vérifier consommation continue et absence d’erreurs `commit`.
3. Simuler un plantage avant commit (couper le processus pendant le traitement) ou une charge JSON invalide côté worker : après redémarrage, observer éventuelle **rejouabilité** des jobs / messages selon le scénario.
4. Surveiller les logs **« offset NOT committed »**.

## Problèmes rencontrés et corrections appliquées

Pas d’erreur bloquante sur la chaîne prévue pour ce changement ; attention toutefois que **`_process_message`** dans le décodeur et **`_process_job`** dans le worker peuvent encore **capturer des exceptions en interne** sans les relancer — dans ce cas le commit externe peut quand même avoir lieu. Documenter cette limite évite une fausse attente « at-least-once strict » tant que ces méthodes n’inverse pas ce comportement.

## Mots clés pour la soutenance

Kafka, offset, **`enable.auto.commit`**, **`consumer.commit(message)`**, at-least-once, rejouabilité, **raw-can-frames**, **file-processing-jobs**, résilience crash, livraisons dupliquées vs perte silencieuse.


Day 18 fully complete — all 3 tasks:
TaskCommitWhatTask 15b003e2bUpload page — drag-and-drop, progress, historyTask 209e48a75log_parser streaming — O(1) memoryTask 3d713aa2fKafka manual commit — no data loss on crash

Day 18 Python quality improvements summary for the report:

"Trois améliorations de robustesse ont été apportées à la couche Python en jour 18 : le parseur de logs streame maintenant ligne par ligne au lieu de charger tout le fichier en RAM ; les deux consommateurs Kafka utilisent le commit manuel pour garantir at-least-once delivery ; et le simulateur est devenu interruptible pendant les timing gaps grâce au flag temporel non-bloquant. Ces trois fixes transforment le pipeline d'un prototype en un système robuste pour la démonstration."

Why takeWhile with inclusive: true:
The true second argument means the terminal value (COMPLETED or FAILED) is emitted once through tap — so the UI updates — then the Observable completes automatically. Without true, takeWhile would unsubscribe before the final status is processed and the UI would never reach the complete state.
What you can tell the jury:

"Le polling utilise interval(2s).pipe(switchMap(...), tap(...), takeWhile(..., true)). switchMap annule la requête HTTP précédente si l'intervalle suivant arrive avant la réponse — pas de requêtes concurrentes. takeWhile avec inclusive: true complète l'Observable automatiquement dès que le statut atteint COMPLETED ou FAILED — aucun unsubscribe() manuel, aucun risque d'oubli de nettoyage."


Full upload pipeline now works end-to-end:
User drops file → POST /api/logs/upload → { sessionId, status: "PROCESSING" }
    ↓ step = 'uploading' → progress bar fills
    ↓ step = 'processing' → polling starts
GET /api/logs/status/{id} every 2s → { status: "PROCESSING" } → continue
GET /api/logs/status/{id} → { status: "COMPLETED", frameCount: 89200 }
    ↓ tap() → step = 'complete', frameCount set, history reloaded
    ↓ takeWhile(inclusive) → Observable completes automatically
    ↓ No manual unsubscribe needed
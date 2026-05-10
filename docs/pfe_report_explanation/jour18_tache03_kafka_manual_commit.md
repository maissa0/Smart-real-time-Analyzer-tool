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

# Fix timing gap non-bloquant — can_simulator.py

## Ce qui a été fait

- Ajout de **`self.gap_active_until: float`** dans **`CanSimulator.__init__`** pour mémoriser jusqu’à quelle date/heure système la **fenêtre de suppression** des trames reste active.
- **`inject_timing_gap()`** conservé en version **bloquante** avec docstring « legacy », pour le mode **replay** qui appelle encore **`time.sleep(16–20)`** dans la boucle de lecture fichier.
- Nouvelle méthode **`trigger_timing_gap()`** : tire une durée aléatoire **16–20 s**, pose **`gap_active_until = time.time() + gap`**, incrémente les stats et journalise — **sans** dormir.
- **`run_random()`** : en tête de chaque itération, si **`now < gap_active_until`**, **`time.sleep(0.001)`** puis **`continue`** (aucune trame envoyée) ; dans la boucle sur les messages, en cas de faute timing, appel à **`trigger_timing_gap()`** à la place de **`inject_timing_gap()`** (plus de **`last_sent`** forcé avant sleep bloquant).

## Ce que ça fait pour le projet

- Le processus Python du simulateur **random** reste **interruptible** et plus **réactif** pendant les « trous » de trafic simulés (pas de blocage monolithique de 16–20 s sur un seul **`sleep`**).
- Le comportement **replay** (fichier + intervalles réels) reste inchangé fonctionnellement côté timing d’injection si l’on garde l’ancienne méthode.

## Comment — explication technique

- **État explicite** : la « pause » est modélisée comme un **intervalle de temps** **[now, gap_active_until)** au lieu d’un appel synchronisé unique.
- **Granularité** : boucle à pas **1 ms** pendant la fenêtre (**`sleep(0.001)`**) pour **céder** au scheduler et rester réactif (Ctrl+C, arrêt process, etc.).
- **Comptage** : une fenêtre déclenchée par **`trigger_timing_gap()`** compte toujours **une** entrée **`timing_gaps`** comme avant pour les statistiques affichées en sortie.

## Pourquoi — justification

Un **`time.sleep(16–20)`** monopolise le thread principal : l’arrêt propre, la livraison Kafka périodique et la capacité à répondre au **SIGINT** peuvent être perçus comme « gelés ». La fenêtre non-bloquante aligne le mode random sur les bonnes pratiques des **boucles événementielles** légères.

## Explication sans background informatique

Avant, quand le simulateur « simulait un trou » sur le bus, il **s’endormait** pendant une longue pause d’un seul bloc. Maintenant il **retient seulement jusqu’à quand** il doit se taire, et il **vérifie souvent** — comme une alarme répétée plutôt qu’une sieste unique — ce qui rend l’arrêt du programme plus naturel.

## Comment tester manuellement

- **Syntaxe** : `python -c "import ast; ast.parse(open('.../can_simulator.py').read()); print('OK')"` doit afficher **`OK`**.
- Lancer le simulateur en mode **random** avec **`--inject-timing-gaps`** et **`--fault-rate`** suffisamment élevé : observer des **périodes sans trames Kafka** d’environ la durée annoncée, tout en pouvant **Ctrl+C** sans attendre la fin du sleep legacy.

## Problèmes rencontrés et corrections appliquées

- Aucun incident bloquant sur cette passe ; le mode **replay** conserve **`inject_timing_gap()`** bloquant volontairement pour ne pas refactorer `run_replay` dans ce ticket.

## Mots clés pour la soutenance

**Non-bloquant**, **`gap_active_until`**, **`trigger_timing_gap`**, **event loop**, **réactivité SIGINT**, **Kafka producer poll**, **mode random vs replay**, **fault injection timing**.

# Filtres avancés — msgId, faultsOnly, anomalyOnly

## Ce qui a été fait

- **API REST** : **`GET /api/can/sessions/{sessionId}/frames`** accepte désormais **`faultsOnly`** et **`anomalyOnly`** (`boolean`, défaut `false`) en plus de **`msgId`**. La logique applique **`faultsOnly` en priorité**, puis un **placeholder `anomalyOnly`** (liste vide tant qu’il n’y a pas d’entité d’anomalies côté backend), puis filtre **`msgId`** si non vide, sinon toutes les trames.
- **`CanSessionService`** : méode **`getFramesWithFaults(sessionId)`** qui lit les fautes d’intégrité via **`IntegrityFaultRepository.findBySessionIdOrderByFrameTimestampAsc`**, extrait les **`frameId`** distincts, charge les trames avec **`CanFrameRepository.findAllById`**, trie par **timestamp**, puis mappe en **`CanFrameResponse`**. Le dépôt **`IntegrityFaultRepository`** était **déjà injecté** avec **`@RequiredArgsConstructor`** — aucun champ supplémentaire.
- **Frontend `CanService.getFrames`** : signature **`getFrames(sessionId, filters?)`** avec **`URLSearchParams`** pour **`msgId`**, **`faultsOnly`**, **`anomalyOnly`**.
- **Sniffer** : signaux **`faultsOnly`** et **`anomalyOnly`**, computed **`frameApiFilters`**, **`loadFrames`** passe les filtres au service ; boutons **⚠ Faults only** et **🔴 Anomalies only** (exclusifs mutuellement) ; **`clearAllFilters`** réinitialise aussi ces signaux et **recharge** les trames ; styles **`.kpit-advanced-filters`** / **`.kpit-filter-toggle`**.

## Ce que ça fait pour le projet

- Réduit le volume de données chargé côté client quand on ne veut que les trames **liées à des fautes d’intégrité**.
- Prépare la voie pour un futur **filtrage « anomalies IA »** sans casser l’API (**réponse vide** pour l’instant).
- **Cohérence** avec les paramètres déjà utilisés côté UI (**msgId** via **`selectedMsgId`** dans **`frameApiFilters`**).

## Comment — explication technique

- **Backend** : **`IntegrityFaultEntity`** référence **`frameId`** ; les IDs sont agrégés puis **`findAllById`** (JPA). Ordre garanti par **`Comparator.comparingDouble(CanFrameEntity::getTimestamp)`**.
- **`anomalyOnly`** : contournement explicite pour éviter une **500** en attendant une table **`anomaly_results`** ou équivalent.
- **Angular** : **`computed(() => ({ msgId, faultsOnly, anomalyOnly }))`** combiné à **`loadFrames(sessionId, frameApiFilters())`** ; les toggles appellent **`loadFrames`** après mutation des signaux ; **exclusivité** faults ↔ anomalies dans les toggles.

## Pourquoi — justification

- **Faults only** : les anomalies métier sont déjà stockées dans **`integrity_faults`** ; filtrer côté serveur évite de télécharger tout l’historique pour une analyse ciblée.
- **`anomalyOnly` vide** : contrat API stable pour le sprint IA sans implémentation prématurée.
- **`faultsOnly` prioritaire** : évite les combinaisons ambiguës avec **`msgId`** (décision documentée dans le contrôleur).

## Explication sans background informatique

Dans le panneau de filtres, vous pouvez **n’afficher que les messages problématiques** détectés par le contrôle d’intégrité, ou (bientôt) **ceux marqués comme bizarres par l’IA** — pour l’instant ce dernier bouton renvoie une liste vide en attendant la fonctionnalité complète. Le bouton **Effacer** remet tout à zéro et recharge la liste complète.

## Comment tester manuellement

- **Backend** : `.\mvnw.cmd compile` (voir **`BUILD SUCCESS`**).
- **Frontend** : `npx ng build --configuration development`.
- Choisir une session avec des **fautes** connues : activer **⚠ Faults only** → le tableau et les compteurs doivent refléter **uniquement** les trames concernées ; désactiver ou **Clear filters** → retour au chargement normal.
- Activer **🔴 Anomalies only** → **aucune trame** tant que le backend ne renvoie pas encore de données anomalies.

## Problèmes rencontrés et corrections appliquées

- Le snippet utilisait **`findBySessionId`**, **absent** du **`IntegrityFaultRepository`** réel : remplacé par **`findBySessionIdOrderByFrameTimestampAsc`** pour lister les fautes d’une session.
- Le gabarit HTML « Clear Filters » / classe **`kpit-clear-filters-btn`** ne correspondait pas au fichier : insertion des toggles **au-dessus** du bouton existant **`kpit-clear-btn`**, pour ne pas casser les styles déjà définis.

## Mots clés pour la soutenance

**Query parameters**, **`faultsOnly`**, **`anomalyOnly` (placeholder)**, **`getFramesWithFaults`**, **`IntegrityFaultRepository`**, **`URLSearchParams`**, **signals Angular**, **`computed`**, **filtrage serveur vs client**, **API extensible**, **intégrité CAN**.

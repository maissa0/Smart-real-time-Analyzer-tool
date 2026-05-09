# Chapitre 4 — Conception de la base de données

## 4.1 Conception et migration du schéma

### 4.1.1 État initial du schéma

L'analyse du schéma original de la base de données `smart_real_time_analyser`
a révélé **12 problèmes** identifiés lors de la revue de conception :

1. La colonne `signals` de `can_frames` était typée `TEXT` alors qu'elle
   stocke exclusivement des données JSON — empêchant toute validation
   ou indexation native par MySQL.
2. La colonne `raw_bytes` était typée `TEXT` alors que la longueur maximale
   réelle dans les données de production est de 24 caractères.
3. La colonne `direction` était typée `VARCHAR(255)` alors que seules trois
   valeurs sont valides (`Rx`, `Tx`, `Unknown`) — aucune contrainte
   d'intégrité n'était appliquée.
4. Les colonnes `msg_id`, `msg_name` et `channel_name` étaient déclarées
   `VARCHAR(255)` alors que les longueurs maximales réelles sont
   respectivement 5, 21 et 14 caractères.
5. La table `can_sessions` ne possédait pas de colonne `user_id` —
   impossible de relier une session à son propriétaire.
6. La table `can_sessions` ne possédait pas de colonne `status` —
   aucun suivi du cycle de vie des sessions (live, completed, failed).
7. La table `can_sessions` ne possédait pas de colonne `updated_at` —
   impossibilité de tracer les modifications.
8. La table `integrity_faults` ne possédait qu'un index PRIMARY —
   les requêtes filtrées par `session_id`, `fault_type` ou `created_at`
   effectuaient des parcours complets de table (full table scan).
9. La table `log_files` ne possédait pas d'index sur la colonne `status` —
   même problème de performance pour les requêtes de suivi d'état.
10. **18 238 trames orphelines** dans `can_frames` — des lignes dont le
    `session_id` ne correspondait à aucune ligne de `can_sessions`,
    représentant 4,7 % du volume total (390 092 trames).
11. Absence des tables métier pour les fonctionnalités Sprint 5 et 6 :
    véhicule (cars), catalogue ECU, définitions de signaux, détection
    d'anomalies, seuils d'alerte, exports, préférences utilisateur.
12. Aucune stratégie de migration versionnée — les modifications de schéma
    étaient appliquées manuellement sans traçabilité.

### 4.1.2 Stratégie de migration

La migration a été réalisée en **deux phases distinctes**, suivant le
principe de migrations versionnées Flyway (`Vx__description.sql`).

**Sauvegarde préalable**

Avant toute intervention sur le schéma, une sauvegarde complète de la base
de production a été réalisée avec `mysqldump --single-transaction`, garantissant
la cohérence des données sans verrouillage des tables pendant l'opération.
La sauvegarde (173 Mo) a été restaurée dans une base de test dédiée
`smart_analyser_test` pour valider chaque migration avant application
en production.

```sql
mysqldump -u root --single-transaction smart_real_time_analyser \
  > backup_pre_migration_20260508.sql
```

**Phase 1 — V1__fix_existing_tables.sql**

La première migration corrige les problèmes identifiés sur les tables
existantes :

- Suppression des 18 238 trames orphelines (décision délibérée — données
  inaccessibles via les requêtes normales session → trames)
- Conversion `signals` : `TEXT` → `JSON`
- Conversion `raw_bytes` : `TEXT` → `VARCHAR(30)`
- Conversion `direction` : `VARCHAR(255)` → `ENUM('Rx','Tx','Unknown')`
  (casse réelle vérifiée sur les données de production)
- Resserrement de `msg_id` → `VARCHAR(20)`, `msg_name` → `VARCHAR(100)`,
  `channel_name` → `VARCHAR(64)`
- Ajout des colonnes `user_id`, `status`, `updated_at` à `can_sessions`
- Ajout des index manquants sur `integrity_faults` et `log_files`

**Phase 2 — V2__create_new_tables.sql**

La seconde migration crée les 7 nouvelles tables requises par les
fonctionnalités des sprints 5 et 6 :

| Table | Rôle |
|---|---|
| `ecu_catalogs` | Référence les fichiers XML du pipeline Python |
| `cars` | Entité véhicule (VIN, marque, modèle, catalogue ECU) |
| `signal_definitions` | Métadonnées des signaux extraits des catalogues |
| `signal_thresholds` | Seuils d'alerte configurables par signal et par véhicule |
| `anomaly_results` | Résultats de détection IA/ML (IsolationForest, RandomForest) |
| `export_jobs` | Suivi des exports PDF/CSV/XLSX asynchrones |
| `user_preferences` | Préférences applicatives par utilisateur |

L'ordre de création respecte les dépendances de clés étrangères :
`ecu_catalogs` → `cars` → `signal_thresholds`, `anomaly_results`,
`user_preferences`.

### 4.1.3 Résultats de la migration

Les deux migrations ont été exécutées et validées sur `smart_analyser_test`
avant application en production.

| Indicateur | Avant V1 | Après V1 | Après V2 |
|---|---|---|---|
| Nombre de tables | 14 | 14 | 21 |
| Trames `can_frames` | 390 092 | 371 854 | 371 854 |
| Sessions `can_sessions` | 88 | 88 | 88 |
| Trames orphelines | 18 238 | 0 | 0 |
| Index sur `integrity_faults` | 1 (PRIMARY) | 5 | 5 |
| Colonnes `can_sessions` | 7 | 10 | 10 |

### 4.1.4 Diagramme entité-association

> **Note de rédaction** : le diagramme ER complet sera inséré ici après
> la Journée 8. Il couvrira l'ensemble des 21 tables avec leurs relations,
> cardinalités et contraintes de clés étrangères.
>
> *[ER_DIAGRAM_PLACEHOLDER — à remplacer par le diagramme généré en Jour 8]*

### 4.1.5 Application en production

Une fois les migrations validées sur la base de test, elles ont été
appliquées à la base de production `smart_real_time_analyser` avec
la même procédure :

```sql
-- Application de V1
mysql -u root smart_real_time_analyser < V1__fix_existing_tables.sql

-- Application de V2
mysql -u root smart_real_time_analyser < V2__create_new_tables.sql
```

Les scripts de migration sont versionnés dans le dépôt Git sous
`db/migrations/` et constituent la documentation de référence de
l'évolution du schéma tout au long du projet.

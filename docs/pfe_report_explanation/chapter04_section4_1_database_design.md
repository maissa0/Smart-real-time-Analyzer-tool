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

### 4.1.2 Stratégie de migration — zéro perte de données

La migration a été réalisée en **4 phases distinctes** selon une stratégie
de migration à zéro perte de données (*zero-data-loss migration strategy*).
Chaque phase a été testée sur la base `smart_analyser_test` (copie exacte
de la production) avant application sur `smart_real_time_analyser`.

> "The migration was executed in 4 phases to minimize risk: fixing existing
> column types (V1), creating domain tables (V2), assigning foreign keys
> after null-check (V3), and enabling constraints (V4)."

**Sauvegarde préalable**

Avant toute intervention, une sauvegarde complète de 173 Mo a été réalisée
avec `mysqldump --single-transaction` — cohérence garantie sans verrouillage
des tables. La sauvegarde a été restaurée dans `smart_analyser_test` et
les comptages vérifiés avant de commencer.

---

**Phase 1 — V1 : Correction des tables existantes**

*Objectif : corriger les 12 défauts de schéma sans créer de nouvelles tables.*

- Suppression des 18 238 trames orphelines (4,7 % des données)
- `signals` : `TEXT` → `JSON` (validation native MySQL activée)
- `raw_bytes` : `TEXT` → `VARCHAR(30)` (longueur max réelle = 24 chars)
- `direction` : `VARCHAR(255)` → `ENUM('Rx','Tx','Unknown')` (casse réelle vérifiée)
- `msg_id` → `VARCHAR(20)`, `msg_name` → `VARCHAR(100)`, `channel_name` → `VARCHAR(64)`
- Ajout des colonnes `user_id`, `status`, `updated_at` sur `can_sessions`
- Ajout des index manquants sur `integrity_faults` et `log_files`

*Durée sur production : 165 secondes. Zéro erreur.*

---

**Phase 2 — V2 : Création des tables métier**

*Objectif : ajouter les 7 nouvelles tables sans toucher aux données existantes.*

| Table | Rôle |
|---|---|
| `ecu_catalogs` | Référence les fichiers XML du pipeline Python |
| `cars` | Entité véhicule (VIN, marque, modèle, catalogue ECU) |
| `signal_definitions` | Métadonnées des signaux extraits des catalogues |
| `signal_thresholds` | Seuils d'alerte configurables par signal et par véhicule |
| `anomaly_results` | Résultats de détection IA/ML (IsolationForest, RandomForest) |
| `export_jobs` | Suivi des exports PDF/CSV/XLSX asynchrones |
| `user_preferences` | Préférences applicatives par utilisateur |

*Durée sur production : quelques secondes. Zéro donnée existante modifiée.*

---

**Phase 3 — V3 : Assignation des clés étrangères après vérification null**

*Objectif : ajouter car_id aux tables CAN, insérer les données de référence,
puis assigner toutes les sessions avant d'activer les contraintes FK.*

Cette phase illustre le principe fondamental : **une FK ne peut être ajoutée
que si toutes les lignes existantes ont une valeur valide**.

- Ajout de la colonne `car_id BIGINT DEFAULT NULL` sur `can_sessions` et `log_files`
- Insertion de 2 véhicules de référence :
  - *Legacy* (virtuel) — propriétaire de toutes les sessions pré-migration
  - *KPIT CAN Simulator* (virtuel) — pour les sessions futures du simulateur
- `UPDATE can_sessions SET car_id = @legacy_id WHERE car_id IS NULL`
  → 88 sessions assignées, `null_car_id = 0` vérifié avant l'étape suivante
- Ajout des contraintes FK `can_sessions→cars` et `log_files→cars`

*Vérification critique : `SELECT COUNT(*) FROM can_sessions WHERE car_id IS NULL`
doit retourner 0 avant l'ajout de la FK.*

---

**Phase 4 — V4 : Activation des contraintes d'intégrité référentielle**

*Objectif : rendre structurellement impossible la réapparition de trames orphelines.*

- `can_frames.session_id → can_sessions.session_id ON DELETE CASCADE`
- `integrity_faults.session_id → can_sessions.session_id ON DELETE CASCADE`

La règle `ON DELETE CASCADE` signifie que supprimer une session supprime
automatiquement toutes ses trames et toutes ses anomalies — ce qui rend
impossible la réapparition des 18 238 trames orphelines nettoyées en V1.

*Pré-condition vérifiée : 0 trame orpheline, 0 anomalie orpheline avant ajout des FK.*

---

**Résultats finaux après les 4 phases**

| Indicateur | Avant V1 | Après V4 |
|---|---|---|
| Nombre de tables | 14 | 21 |
| Contraintes FK | 0 (CAN) | 20 total |
| Trames `can_frames` | 390 092 | 371 854 |
| Trames orphelines | 18 238 | 0 (structurellement impossible) |
| Sessions `can_sessions` | 88 | 88 |
| Véhicules `cars` | 0 | 2 |
| Sessions sans `car_id` | N/A | 0 |

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

---

## 4.2 Implémentation de l'entité Véhicule (Sprint 5)

### 4.2.1 Architecture en couches

L'entité Véhicule suit l'architecture en couches standard du projet :
CarEntity (JPA) → CarRepository (Spring Data) → CarService → CarController (REST)
↓                                              ↑
cars table (MySQL)                          CarDto / CarCreateRequest / CarUpdateRequest

### 4.2.2 Entité JPA — CarEntity

`CarEntity` mappe la table `cars` avec 14 champs couvrant l'identité du
véhicule, ses métadonnées, et son cycle de vie (soft delete via `deletedAt`).

Choix techniques notables :

- **`carUid` auto-généré** via `@PrePersist` — garantit que chaque véhicule
  possède un identifiant UUID public même si le appelant ne le fournit pas.
  L'`id` (BIGINT auto-increment) reste l'identifiant interne ; `carUid` est
  l'identifiant exposé dans les URLs REST (`/api/cars/{carUid}`).

- **`ownerUserId` en `byte[]`** avec `columnDefinition = "BINARY(16)"` —
  correspond exactement au type de la colonne `users.id` en base.

- **`@OneToMany` intentionnellement omis** — une relation JPA vers
  `CanSessionEntity` provoquerait des `LazyInitializationException` lors de
  la sérialisation JSON. Les sessions d'un véhicule sont récupérées via
  `CanSessionRepository.findByCarId()`.

- **Soft delete** — `deletedAt` null signifie véhicule actif ; toutes les
  requêtes filtrent `WHERE deleted_at IS NULL`.

### 4.2.3 Repository — CarRepository

`CarRepository` étend `JpaRepository<CarEntity, Long>` et expose 5 méthodes :

| Méthode | Usage |
|---|---|
| `findByCarUid(String)` | Lookup API par UUID public |
| `findByOwnerUserIdAndIsActiveTrueAndDeletedAtIsNull(byte[])` | Sessions d'un utilisateur |
| `findByIsActiveTrueAndDeletedAtIsNull()` | Liste globale pour admin |
| `findAllActive()` | Liste triée par date de création (JPQL) |
| `countByIsActiveTrueAndDeletedAtIsNull()` | Statistiques dashboard |

Spring Data JPA génère automatiquement le SQL à partir des noms de méthodes —
aucune requête SQL manuelle n'est nécessaire pour les cas standards.

### 4.2.4 DTOs — Séparation entité / API

Trois DTOs séparent l'entité JPA de l'API REST :

| DTO | Rôle | Champs clés |
|---|---|---|
| `CarDto` | Réponse API | Champs calculés : `sessionCount`, `totalFrames`, `faultRate` |
| `CarCreateRequest` | Création | `@NotBlank` make/model, `@Min`/`@Max` year, `@Pattern` VIN |
| `CarUpdateRequest` | Mise à jour (PATCH) | Tous les champs optionnels |

**Validation VIN** : le pattern `^[A-HJ-NPR-Z0-9]{17}$` applique la norme
ISO 3779 — exactement 17 caractères alphanumériques en excluant I, O et Q
(confondables avec 1, 0 et 0 visuellement).

**`@JsonInclude(NON_NULL)` sur `CarDto`** : les champs calculés (`faultRate`,
`totalFrames`) sont `null` dans les réponses légères (liste de véhicules) et
remplis uniquement dans les réponses détaillées. `NON_NULL` évite que
`"faultRate": null` n'apparaisse dans le JSON.

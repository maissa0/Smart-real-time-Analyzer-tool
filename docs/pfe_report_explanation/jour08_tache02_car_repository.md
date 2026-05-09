# Jour 8 — Tâche 2 : **`CarRepository`** — accès données flotte véhicules

## Ce qui a été fait

- Vérification que le dépôt Spring Data du module CAN vit sous **`package com.example.backend.can.repository;`** (**`CanSessionRepository`**).
- Création de **`backend/src/main/java/com/example/backend/can/repository/CarRepository.java`** : interface **`extends JpaRepository<CarEntity, Long>`**, annotée **`@Repository`**, avec cinq méthodes de requête :
  - **`findByCarUid(String)`** → **`Optional<CarEntity>`** (lookup par UUID public)
  - **`findByOwnerUserIdAndIsActiveTrueAndDeletedAtIsNull(byte[])`** → liste pour un propriétaire
  - **`findByIsActiveTrueAndDeletedAtIsNull()`** → tous les véhicules actifs non supprimés
  - **`findAllActive()`** → même filtre métier avec **`ORDER BY createdAt DESC`** via **`@Query`** JPQL
  - **`countByIsActiveTrueAndDeletedAtIsNull()`** → compteur pour tableaux de bord
- **Compilation Maven** : **BUILD SUCCESS**.

## Ce que ça fait pour le projet

- Expose une **couche d’accès standardisée** à la table **`cars`** sans SQL manuel répété : les filtres **soft delete** (`deleted_at`) et **`is_active`** sont centralisés dans les signatures de méthodes.
- Prépare les **routes REST** futures (**`GET /api/cars/{carUid}`**) et les écrans **liste / sélecteur / stats** tout en respectant **`owner_user_id`** en **`BINARY(16)`**.

## Comment — explication technique

1. Spring Data JPA dérive les implémentations à partir des **préfixes** (`findBy…`, `countBy…`) et des propriétés d’**`CarEntity`** (`carUid`, `ownerUserId`, `isActive`, `deletedAt`, `createdAt`).
2. **`findAllActive`** utilise une **`@Query`** explicite car on veut un **tri** garanti (**`DESC` sur `createdAt`**) alors que **`findByIsActiveTrueAndDeletedAtIsNull`** reste sans ordre imposé par défaut.
3. **`JpaRepository<CarEntity, Long>`** : clé primaire **`Long`** = colonne **`id`** ; **`car_uid`** reste une **clé métier** pour l’API.

## Pourquoi — justification

- Sans repository dédié, chaque service devrait réécrire les mêmes conditions **`deleted_at IS NULL`** / **`is_active = TRUE`**, source d’**oublis et d’incohérences**.
- Séparer **`findByCarUid`** (API) et **`findByOwnerUserId…`** (multi-tenant léger par utilisateur) aligne les requêtes sur les cas d’usage réels décrits dans le rapport PFE.

## Explication sans background informatique

- Le programme peut maintenant **poser des questions précises à la base** sur les voitures enregistrées : « donne-moi cette voiture par son **identifiant public** », « liste les voitures **d’un utilisateur** encore **utilisables** », ou « **combien** de voitures actives », sans tout recharger ni mélanger les entrées « supprimées » en douce.

## Comment tester manuellement

Compilation (PowerShell, JDK 17) :

```powershell
$env:JAVA_HOME='C:\Users\maiss\.jdks\jbr-17.0.11'
cd C:\tools\Kpit_c\backend
.\mvnw.cmd compile 2>&1 | Select-Object -Last 5
```

**Sortie observée**

```
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  5.636 s
[INFO] Finished at: 2026-05-09T16:49:25+01:00
[INFO] ------------------------------------------------------------------------
```

Vérification des méthodes dans le fichier :

```powershell
cd C:\tools\Kpit_c
Select-String -Path `
  "backend/src/main/java/com/example/backend/can/repository/CarRepository.java" `
  -Pattern "findByCarUid|findByOwnerUserId|findAllActive|findByIsActive|countBy"
```

**Sortie observée**

```
backend\src\main\java\com\example\backend\can\repository\CarRepository.java:15: * - findByCarUid: external API lookups 
use car_uid (public UUID), not internal id
backend\src\main\java\com\example\backend\can\repository\CarRepository.java:16: * - findByOwnerUserId: list cars 
belonging to a specific user (binary(16) key)
backend\src\main\java\com\example\backend\can\repository\CarRepository.java:17: * - findAllActive / 
findByIsActiveTrue: dashboard and selector queries
backend\src\main\java\com\example\backend\can\repository\CarRepository.java:27:    Optional<CarEntity> 
findByCarUid(String carUid);
backend\src\main\java\com\example\backend\can\repository\CarRepository.java:33:    List<CarEntity> 
findByOwnerUserIdAndIsActiveTrueAndDeletedAtIsNull(byte[] ownerUserId);
backend\src\main\java\com\example\backend\can\repository\CarRepository.java:39:    List<CarEntity> 
findByIsActiveTrueAndDeletedAtIsNull();
backend\src\main\java\com\example\backend\can\repository\CarRepository.java:43:     * Equivalent to 
findByIsActiveTrueAndDeletedAtIsNull but with explicit ordering.
backend\src\main\java\com\example\backend\can\repository\CarRepository.java:46:    List<CarEntity> findAllActive();
backend\src\main\java\com\example\backend\can\repository\CarRepository.java:51:    long 
countByIsActiveTrueAndDeletedAtIsNull();
```

*(Les retours à la ligne affichés par la console PowerShell découpent parfois une ligne longue sur plusieurs lignes.)*

## Problèmes rencontrés et corrections appliquées

- Aucun : le package **`com.example.backend.can.repository`** est cohérent avec **`CanSessionRepository`**, la compilation valide que Spring Data peut interpréter les dérivations de requête sur **`CarEntity`**.

## Mots clés pour la soutenance

**Spring Data JPA**, **`JpaRepository`**, **`CarRepository`**, **méthodes dérivées** (`findBy…`, `countBy…`), **JPQL** (`@Query`, `ORDER BY`), **soft delete** (`deletedAtIsNull`), **`car_uid`**, **`owner_user_id`** / **`BINARY(16)`**, **BUILD SUCCESS**

# Chapitre 5 — Implémentation Backend

## 5.3 API Flotte Véhicule (Vehicle Fleet API)

### 5.3.1 Vue d'ensemble

L'API Vehicle Fleet expose les opérations CRUD complètes sur l'entité
Véhicule ainsi que la navigation vers les sessions CAN associées.
Elle est implémentée dans `CarController` (`/api/cars`) et s'appuie
sur `CarService` pour la logique métier et `CarRepository` pour
l'accès aux données.

Tous les endpoints requièrent une authentification JWT valide —
`SecurityConfig` applique `anyRequest().authenticated()` sur l'ensemble
des routes `/api/**` non listées dans `PUBLIC_PATHS`.

### 5.3.2 Endpoints

| Méthode | Chemin | Auth | Description | Réponse |
|---|---|---|---|---|
| `GET` | `/api/cars` | JWT | Liste les véhicules actifs de l'utilisateur authentifié. Les administrateurs (`ROLE_ADMIN`) voient tous les véhicules. | `200 OK` — `List<CarDto>` |
| `POST` | `/api/cars` | JWT | Crée un nouveau véhicule. `make`, `model` et `year` sont obligatoires. `vin` doit respecter ISO 3779 (17 chars, pas de I/O/Q) s'il est fourni. `carUid` est auto-généré. | `201 Created` — `CarDto` |
| `GET` | `/api/cars/{carUid}` | JWT + ownership | Retourne les détails du véhicule avec les **statistiques calculées** : `sessionCount`, `totalFrames`, `lastSessionAt`, `faultRate` (défauts pour 1 000 trames). | `200 OK` — `CarDto` avec stats |
| `PUT` | `/api/cars/{carUid}` | JWT + ownership | Met à jour les champs modifiables (PATCH sémantique — seuls les champs non-null sont appliqués) : `vin`, `make`, `model`, `year`, `color`, `isVirtual`, `isActive`. | `200 OK` — `CarDto` mis à jour |
| `DELETE` | `/api/cars/{carUid}` | JWT + ownership | **Soft delete** — positionne `deleted_at = NOW()` et `is_active = false`. Les sessions et trames historiques sont préservées. | `204 No Content` |
| `GET` | `/api/cars/{carUid}/sessions` | JWT + ownership | Liste toutes les sessions CAN appartenant au véhicule, ordonnées par date de création décroissante. Délègue à `CanSessionService.getSessionsByCarId()`. | `200 OK` — `List<CanSessionResponse>` |

### 5.3.3 Contrôle d'accès et ownership

Le contrôle d'accès est implémenté dans `CarController.checkOwnershipOrAdmin()` :

```java
// Vérifie que l'utilisateur authentifié est propriétaire du véhicule
// ou possède le rôle ROLE_ADMIN
carRepository.findByCarUid(carUid)
    .filter(c -> c.getDeletedAt() == null)
    .filter(c -> Arrays.equals(c.getOwnerUserId(), ownerBytes))
    .orElseThrow(() -> new ResponseStatusException(FORBIDDEN, "..."));
```

**Mécanisme :** `owner_user_id` est stocké en `BINARY(16)` dans la table
`cars`, correspondant exactement au type de `users.id`. La comparaison
utilise `Arrays.equals()` sur les tableaux de bytes — une comparaison
`==` serait incorrecte en Java pour les tableaux.

**Bypass admin :** `isAdmin()` inspecte les authorities Spring Security
(`ROLE_ADMIN`) — si vrai, `checkOwnershipOrAdmin()` retourne immédiatement
sans vérifier l'ownership. Cela permet aux administrateurs de gérer
l'ensemble de la flotte.

### 5.3.4 Statistiques calculées (CarDto computed fields)

Les champs `sessionCount`, `totalFrames`, `lastSessionAt` et `faultRate`
ne sont pas stockés en base — ils sont calculés à la demande par
`CarService.populateStats()` :

```sql
-- Requête JPQL équivalente
SELECT COUNT(s), COALESCE(SUM(s.frameCount), 0), MAX(s.createdAt)
FROM CanSessionEntity s
WHERE s.carId = :carId
```

```sql
-- Calcul du taux de défauts
SELECT COUNT(f)
FROM IntegrityFaultEntity f
JOIN CanSessionEntity s ON f.sessionId = s.sessionId
WHERE s.carId = :carId
-- faultRate = (count / totalFrames) × 1000
```

Le taux de défauts est exprimé en **défauts pour 1 000 trames** plutôt
qu'en pourcentage — une unité plus lisible pour les ingénieurs CAN où
les taux sont typiquement inférieurs à 0,1 %.

### 5.3.5 Validation des données entrantes

`CarCreateRequest` et `CarUpdateRequest` appliquent les contraintes
Jakarta Validation avant que la requête n'atteigne le service :

| Champ | Contrainte | Message d'erreur |
|---|---|---|
| `make` | `@NotBlank` | "Make is required" |
| `model` | `@NotBlank` | "Model is required" |
| `year` | `@Min(1990) @Max(2030)` | "Year must be 1990 or later / 2030 or earlier" |
| `vin` | `@Pattern(^[A-HJ-NPR-Z0-9]{17}$)` | "VIN must be exactly 17 characters..." |

Une requête invalide retourne `400 Bad Request` avec le message de
validation avant tout accès à la base de données.

### 5.3.6 Soft delete vs hard delete

Le choix du **soft delete** (`deleted_at`) plutôt que du `DELETE` SQL
est motivé par trois contraintes :

1. **Intégrité référentielle** — les sessions CAN ont une FK vers `cars.id`.
   Un hard delete violerait la contrainte ou supprimerait en cascade
   toutes les sessions et trames historiques.
2. **Traçabilité** — les données de télémétrie CAN doivent rester
   consultables même après le retrait d'un véhicule de la flotte active.
3. **Récupération** — un véhicule soft-deleted peut être réactivé
   (`is_active = true`, `deleted_at = null`) sans perte de données.

### 5.3.7 Exemple de réponse — GET /api/cars/{carUid}

```json
{
  "carUid": "4b5a5d52-a193-40fb-bdf7-c37f4b427c74",
  "make": "BMW",
  "model": "5 Series",
  "year": 2023,
  "color": "Black",
  "isVirtual": false,
  "isActive": true,
  "createdAt": "2026-05-09T19:31:52",
  "sessionCount": 0,
  "totalFrames": 0,
  "faultRate": null
}
```

`faultRate` est `null` quand `totalFrames = 0` (aucune session enregistrée).
`@JsonInclude(NON_NULL)` sur `CarDto` supprime les champs null de la
réponse JSON — le champ `faultRate` n'apparaît pas si null.

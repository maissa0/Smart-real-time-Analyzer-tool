# Postman tests Car API + route Angular Vehicles

## Ce qui a été fait

- **Tests Postman exhaustifs** des **6 endpoints** de l’API Cars avec le compte **`user@ablepro.com`** (**`User123!`**) :

  | Méthode | Route | Résultat observé |
  |---|---|---|
  | POST | `/api/cars` | **201 Created** — création d’un véhicule **BMW 5 Series** **2023** |
  | GET | `/api/cars` | **200 OK** — liste des voitures |
  | GET | `/api/cars/{carUid}` | **200 OK** avec **`sessionCount`**, **`totalFrames`**, **`faultRate`** |
  | GET | `/api/cars/{carUid}/sessions` | **200 OK** — liste des sessions CAN |
  | PUT | `/api/cars/{carUid}` | **200 OK** — couleur mise à jour (**White**) |
  | DELETE | `/api/cars/{carUid}` | **204 No Content** — soft-delete |

- **Frontend Angular** : composant **`VehicleListComponent`** (placeholder / ébauche) sous **`Frontend_angular/src/app/features/vehicles/vehicle-list/`**.
- **Routage** : entrée **vehicles** ajoutée aux **`children`** de **`app.routes.ts`** (zone admin protégée).
- **Sidebar** : lien **« Vehicles »** dans **`sidebar.component.html`** avec **icône SVG** voiture.

- **Captures d’écran** enregistrées dans **`docs/pfe_report_explanation/screenshots/`** :

  - `jour09_tache03_car_create_201.png`
  - `jour09_tache03_car_get_stats_200.png`
  - `jour09_tache03_car_delete_204.png`

## Ce que ça fait pour le projet

- **Valide de bout en bout** le périmètre backend **Cars** après implémentation (service, agrégats, contrôleur) : comportements HTTP attendus, payload JSON (`CarDto`), et droits **non-admin**.
- Donne aux examinateurs de **soutenance** une **preuve reproductible** (Postman + chemins PNG) plus une **porte d’entrée UI** (« Vehicles ») pour la suite Sprint front.

## Comment — explication technique

1. Postman envoie les requêtes avec **`Authorization: Bearer <access_token>`** après login JWT ; **`CarController`** impose **`authenticated()`** puis **`checkOwnershipOrAdmin`** sur les opérations ciblées.
2. **POST** désérialise **`CarCreateRequest`** avec Bean Validation (**`@Valid`**) ; **PUT** applique **`CarUpdateRequest`** en sémantique **PATCH** côté service.
3. **GET détail voiture** appelle **`CarService.populateStats`**, lui-même nourri par **`getCarSessionStats`** (agrégats JPQL) et **`countFaultsByCarId`**.
4. La route **`/admin/vehicles`** (exact path selon la configuration ajoutée dans **`app.routes.ts`**) charge le **`VehicleListComponent`** en **lazy loading** comme les autres fonctionnalités admin.
5. Le lien sidebar pointe vers le même préfixe admin pour garder **`authGuard`** cohérent.

## Pourquoi — justification

Tester avec **`user@ablepro.com`** évite les blocages **MFA** du compte **admin** lors d’ateliers ou de soutenance alors que les scénarios **propriété voiture / liste** fonctionnent pour un utilisateur standard.
Documenter une **erreur corrigée** (`ClassCastException` sur le résultat JPQL) matérialise la **vérité du terrain** dans le rapport sans laisser l’illusion d’un développement linéaire.

## Explication sans background informatique

On a **essayé tous les menus du « garage »** dans l’API : créer une voiture, voir la liste, ouvrir la fiche avec des **stats**, voir ses **sessions de trajet**, changer la couleur puis **« retirer »** la voiture (sans tout effacer en base).

On a aussi **ajouté l’entrée « Vehicles »** dans le menu latéral de l’appli comme **première version d’écran**, même si elle est encore **placeholder**.
Les **captures PNG** gardent une **photo** du succès dans Postman.

## Comment tester manuellement

1. **OAuth / JWT** : login **`POST /api/auth/login`** avec **`user@ablepro.com`** / **`User123!`** (éviter **`admin@ablepro.com`** si **MFA** actif sans second facteur sous la main).

2. **Postman — collection rapide**

   ```http
   POST   http://localhost:8080/api/cars           → 201
   GET    http://localhost:8080/api/cars           → 200
   GET    http://localhost:8080/api/cars/{carUid}  → 200 (+ stats)
   GET    http://localhost:8080/api/cars/{carUid}/sessions → 200
   PUT    http://localhost:8080/api/cars/{carUid}  → 200 (ex. champ color)
   DELETE http://localhost:8080/api/cars/{carUid}  → 204
   ```

   En-tête : **`Authorization: Bearer <token>`**.

3. **Screenshots de référence** :

   `docs/pfe_report_explanation/screenshots/jour09_tache03_car_create_201.png`  
   `docs/pfe_report_explanation/screenshots/jour09_tache03_car_get_stats_200.png`  
   `docs/pfe_report_explanation/screenshots/jour09_tache03_car_delete_204.png`

4. **Angular** : démarrer le front (`ng serve`), se connecter, ouvrir le menu **Vehicles** : vérifier que la route charge le **placeholder** (`VehicleListComponent`).

## Problèmes rencontrés et corrections appliquées

- **`GET /api/cars/{carUid}` → 500 `ClassCastException`** : la requête agrégée JPQL **`getCarSessionStats`** renvoie **`List<Object[]>`** alors que le code traitait une paire métier **`Object[]`**. **Correction** : type de retour **`List<Object[]>`** sur le repository et accès **`results.get(0)`** dans **`CarService.populateStats`** (avec garde‑fous **`null`/`isEmpty`** et **`try/catch`** avec log).

- **Login **`admin@ablepro.com`** → 401 / flux MFA** : pour les runs Postman, utilisation **`user@ablepro.com`** / **`User123!`** à la place (compte sans friction MFA dans le périmètre de test décrit).

## Mots clés pour la soutenance

**Car API**, **Postman**, **JWT**, **`user@ablepro.com`**, **201 / 204 / 200**, **`VehicleListComponent`**, **route Vehicles**, **`app.routes.ts`**, **sidebar SVG**, **`ClassCastException`**, **`List<Object[]>`**, **`getCarSessionStats`**, **MFA admin**, **screenshots rapport**

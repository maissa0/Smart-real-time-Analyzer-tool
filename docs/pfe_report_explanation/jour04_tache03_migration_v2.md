# Jour 4 — Tâche 3 : migration schéma V2 (`create_new_tables`)

## Ce qui a été fait

- Création du fichier **`db/migrations/V2__create_new_tables.sql`** (nouvelles entités fonctionnelles autour du véhicule, du catalogue ECU, des seuils et de l’anomalie/export/préférences).
- Application du script **uniquement sur la base de test** **`smart_analyser_test`** (la base nominale **`smart_real_time_analyser`** n’a pas été modifiée ici).
- **7 nouvelles tables** créées : **`ecu_catalogs`**, **`cars`**, **`signal_definitions`**, **`signal_thresholds`**, **`anomaly_results`**, **`export_jobs`**, **`user_preferences`** (liste complète désormais : **21** tables au total dans `SHOW TABLES`).
- Définition des **contraintes de clé étrangère** attendues dans le périmètre du script :
  - **`cars` → ecu_catalogs** (`fk_cars_ecu_catalog` sur `ecu_catalog_id`) et **`cars` → users** (`fk_cars_owner_user` sur `owner_user_id`, type **`BINARY(16)`** aligné sur `users.id`).
  - **`signal_definitions` → ecu_catalogs** (`fk_signal_def_catalog`).
  - **`signal_thresholds` → cars** (`fk_threshold_car`).
  - **`anomaly_results` → cars** (`fk_anomaly_car`; `session_id` / `frame_id` restent une **référence logique** vers les tables existantes, sans FK SQL imposée dans ce script).
  - **`user_preferences` → users** et **`user_preferences` → cars** (`fk_user_prefs_user`, `fk_user_prefs_default_car`).
- Les colonnes **`car_id`** sur **`can_sessions`** et **`log_files`** ne sont **pas** ajoutées dans cette V2 : elles sont **réservées à la V3** après mise en place et validation de l’entité JPA **`Car`** côté application.

## Ce que ça fait pour le projet

- Le schéma de données couvre désormais la **véhicule/catalogue/signaux/seuils** pour préparer Sprint 6 (IA, seuils adaptatifs) et Sprint 7 (préférences utilisateur).
- Les relations vers **`users.id`** utilisent **`BINARY(16)`**, cohérent avec le schéma existant des utilisateurs après diagnostic.
- Le dépôt contient une **migration replayable** (Flyway-compatible par nom `V2__…`) tout en gardant **`car_id` sur sessions/fichiers`** pour une étape d’implémentation applicative suivante (**V3**).

## Comment — explication technique

1. **Ordre de création** : `ecu_catalogs` est créé **avant** `cars` car `cars.ecu_catalog_id` référence `ecu_catalogs.id`.
2. **`cars`** : identifiant public `car_uid` (UUID), VIN optionnel, lien optionnel au catalogue ECU et au propriétaire, soft delete via `deleted_at`.
3. **`signal_definitions`** : métadonnées par signal rattachées à un catalogue ; suppression en cascade du catalogue supprime les définitions.
4. **`signal_thresholds`** : unicité logique **(car_id, signal_name)** ; FK vers `cars` avec `ON DELETE CASCADE`.
5. **`anomaly_results`** : stockage des scores / sévérité / algorithme ; FK optionnelle vers `cars` seulement.
6. **`export_jobs`** : suivi de jobs asynchrones ; `requested_by` en `BINARY(16)` (aligné utilisateur) — contrainte FK explicite vers `users` **non** définie dans ce script.
7. **`user_preferences`** : une ligne par utilisateur (`UNIQUE user_id`) ; `dashboard_layout` en **JSON** ; voiture par défaut optionnelle vers `cars`.
8. Toutes les nouvelles tables sont en **InnoDB**, collation **`utf8mb4_unicode_ci`**, conformément au script.

## Pourquoi — justification

- Séparer **V2 (nouvelles tables)** de **V3 (colonnes `car_id` sur tables existantes)** évite de modifier des tables déjà lourdes et couplées au code JPA **avant** que l’entité `Car` ne soit implémentée et testée.
- Les catalogues ECU et les définitions de signaux centralisent la **vérité métier** issue des XML du pipeline Python, au lieu de dupliquer la configuration en dur.
- Les index sur clés de filtrage (session, voiture, statut, dates) anticipent les requêtes de listes et tableaux de bord.

## Explication sans background informatique

On a ajouté de **nouveaux tableaux** dans la base de données pour représenter des objets du monde réel : **catalogues de signaux**, **voitures**, **paramètres par signal et par voiture**, **résultats d’anomalies**, **demandes d’export de rapports** et **réglages personnels** de l’utilisateur. Rien n’a encore été branché sur les anciennes feuilles de session pour la voiture : ce sera une **étape suivante** quand l’application saura gérer l’objet « voiture » de bout en bout.

## Comment tester manuellement

Variable utile :

```powershell
$mysql = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
```

### Appliquer V2 sur `smart_analyser_test`

```powershell
Get-Content "C:\tools\Kpit_c\db\migrations\V2__create_new_tables.sql" | `
  & $mysql -u root --password="M28d05&" smart_analyser_test
```

**Sortie observée lors de cette tâche :** avertissement MySQL sur le mot de passe en ligne de commande uniquement ; **code de sortie 0** ; pas d’erreur SQL affichée.

---

### Lister toutes les tables (attendu : **21** tables)

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "SHOW TABLES;"
```

**Sortie observée (ordre alphabétique MySQL) :**

```
Tables_in_smart_analyser_test
anomaly_results
audit_logs
can_frames
can_sessions
cars
ecu_catalogs
export_jobs
integrity_faults
log_files
mfa_recovery_codes
otp_codes
permissions
refresh_tokens
role_permissions
roles
sessions
signal_definitions
signal_thresholds
user_preferences
user_roles
users
```

---

### Clés étrangères sur `cars`

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "
SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME,
       REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'smart_analyser_test'
AND TABLE_NAME = 'cars'
AND REFERENCED_TABLE_NAME IS NOT NULL;"
```

**Sortie observée :**

```
CONSTRAINT_NAME	COLUMN_NAME	REFERENCED_TABLE_NAME	REFERENCED_COLUMN_NAME
fk_cars_ecu_catalog	ecu_catalog_id	ecu_catalogs	id
fk_cars_owner_user	owner_user_id	users	id
```

---

### Clés étrangères sur `user_preferences`

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "
SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME,
       REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'smart_analyser_test'
AND TABLE_NAME = 'user_preferences'
AND REFERENCED_TABLE_NAME IS NOT NULL;"
```

**Sortie observée :**

```
CONSTRAINT_NAME	COLUMN_NAME	REFERENCED_TABLE_NAME	REFERENCED_COLUMN_NAME
fk_user_prefs_default_car	default_car_id	cars	id
fk_user_prefs_user	user_id	users	id
```

---

### Moteur et collation des 7 nouvelles tables

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'smart_analyser_test'
AND TABLE_NAME IN (
    'cars','ecu_catalogs','signal_definitions',
    'signal_thresholds','anomaly_results',
    'export_jobs','user_preferences'
)
ORDER BY TABLE_NAME;"
```

**Sortie observée :** les 7 lignes avec **`InnoDB`** et **`utf8mb4_unicode_ci`**.

---

### `DESCRIBE cars;`

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "DESCRIBE cars;"
```

**Sortie observée :**

```
Field	Type	Null	Key	Default	Extra
id	bigint	NO	PRI	NULL	auto_increment
car_uid	varchar(36)	NO	UNI	NULL	
vin	varchar(17)	YES	UNI	NULL	
make	varchar(100)	NO		NULL	
model	varchar(100)	NO		NULL	
year	smallint	NO		NULL	
color	varchar(50)	YES		NULL	
ecu_catalog_id	bigint	YES	MUL	NULL	
owner_user_id	binary(16)	YES	MUL	NULL	
is_virtual	tinyint(1)	NO		0	
is_active	tinyint(1)	NO	MUL	1	
created_at	datetime	NO		CURRENT_TIMESTAMP	DEFAULT_GENERATED
updated_at	datetime	NO		CURRENT_TIMESTAMP	DEFAULT_GENERATED on update CURRENT_TIMESTAMP
deleted_at	datetime	YES		NULL	
```

---

### `DESCRIBE anomaly_results;`

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "DESCRIBE anomaly_results;"
```

**Sortie observée :**

```
Field	Type	Null	Key	Default	Extra
id	bigint	NO	PRI	NULL	auto_increment
session_id	varchar(255)	NO	MUL	NULL	
car_id	bigint	YES	MUL	NULL	
frame_id	bigint	YES		NULL	
signal_name	varchar(128)	YES		NULL	
algorithm	enum('isolation_forest','random_forest','zscore','manual')	NO	MUL	isolation_forest	
anomaly_score	double	YES		NULL	
is_anomaly	tinyint(1)	NO	MUL	0	
severity	enum('low','medium','high','critical')	YES	MUL	NULL	
description	varchar(500)	YES		NULL	
detected_at	datetime	NO	MUL	CURRENT_TIMESTAMP	DEFAULT_GENERATED
reviewed_by	binary(16)	YES		NULL	
reviewed_at	datetime	YES		NULL	
```

---

### Compte sur `ecu_catalogs`

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "SELECT COUNT(*) FROM ecu_catalogs;"
```

**Sortie observée :**

```
COUNT(*)
0
```

---

### Vérifier que le fichier de migration n’est pas ignoré par Git

```powershell
git -C C:/tools/Kpit_c check-ignore -v db/migrations/V2__create_new_tables.sql
```

**Résultat attendu :** **aucune sortie** ; code de sortie **`1`** (fichier non ignoré).

## Problèmes rencontrés et corrections appliquées

1. **Erreurs pendant l’exécution** — L’application de V2 sur `smart_analyser_test` s’est terminée **sans erreur SQL** ; seul l’avertissement standard du client MySQL sur le mot de passe en ligne de commande est apparu. Aucune correction corrective n’a été nécessaire.

2. **Ordre de création : `ecu_catalogs` avant `cars`** — La table **`cars`** référence **`ecu_catalogs.id`** ; le script respecte la **dépendance FK** en créant d’abord **`ecu_catalogs`**. Sans cet ordre, la création de `cars` échouerait.

3. **Contrainte `UNIQUE` sur `vin` avec valeurs NULL** — Le VIN est **optionnel** (`DEFAULT NULL`). En MySQL/InnoDB, plusieurs lignes avec **`vin IS NULL`** peuvent coexister sous un index **UNIQUE** car chaque NULL est traité comme **distinct** pour l’unicité — ce qui convient aux véhicules virtuels ou sans VIN renseigné.

4. **Report de `car_id` sur `can_sessions` / `log_files` à la V3** — Évite d’altérer des tables déjà utilisées par l’application **avant** existence et validation de l’entité JPA **`Car`** et de la couche service ; la V2 pose les **tables** et relations autour de `cars`, la V3 pourra ajouter les **colonnes de lien** sur les tables existantes.

## Mots clés pour la soutenance

Migration MySQL V2, `ecu_catalogs`, entité véhicule `cars`, `signal_definitions`, `signal_thresholds`, `anomaly_results`, `export_jobs`, `user_preferences`, clés étrangères InnoDB, `BINARY(16)` vs `users.id`, utf8mb4, report V3 `car_id`, Flyway `V2__…`, test sur `smart_analyser_test`.

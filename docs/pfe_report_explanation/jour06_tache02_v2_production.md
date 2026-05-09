# Jour 6 — Tâche 2 : application de la migration **V2** sur la base **production** (`smart_real_time_analyser`)

## Ce qui a été fait

- Contrôle pré-migration : **`14`** tables dans le schéma production **avant** V2 ; aucune des **7** tables ciblées n’existait encore (résultat de la requête de contrôle **sans ligne de données** après l’en-tête).
- Application sur **`smart_real_time_analyser`** du script versionné **`db/migrations/V2__create_new_tables.sql`** (pipeline **`Get-Content` → `mysql`**), **sans erreur**.
- Vérifications post-migration : **`21`** tables au total ; liste complète via **`SHOW TABLES`** incluant **`cars`**, **`ecu_catalogs`**, **`signal_definitions`**, **`signal_thresholds`**, **`anomaly_results`**, **`export_jobs`**, **`user_preferences`** ; **`DESCRIBE`** sur **`cars`** et **`anomaly_results`** ; FKs sur **`cars`** vers **`ecu_catalogs`** et **`users`** ; moteur **`InnoDB`** et collation **`utf8mb4_unicode_ci`** pour les 7 nouvelles tables ; comptages **`can_frames`**, **`can_sessions`**, **`users`** inchangés par rapport à l’état post-V1 (**371 854**, **88**, **2**).

## Ce que ça fait pour le projet

- La base **de production** dispose désormais des **même 7 tables métier** que sur la base de test, prêtes pour les **Sprints 6–7** (voiture, catalogue ECU, seuils, anomalies, exports, préférences).
- Les tables **historiques** (**trames, sessions, utilisateurs**) conservent leurs **effectifs** après V2 : V2 est **additive** (nouvelles tables + contraintes FK), sans toucher aux lignes existantes des tables CAN/IAM existantes.

## Comment — explication technique

1. **Pré-check** : décompte des tables dans **`information_schema.TABLES`** puis anti-doublon nominatif des 7 tables V2.
2. **V2** : suite de **`CREATE TABLE IF NOT EXISTS`** avec **`ENGINE=InnoDB`**, **`utf8mb4_unicode_ci`**, contraintes FK respectant l’ordre de dépendance (**`ecu_catalogs`** → **`cars`** → tables filles).
3. **Post-check** : **`DESCRIBE`** / **`KEY_COLUMN_USAGE`** / **`information_schema.TABLES`** pour le moteur, et **`COUNT(*)`** sur les tables à risque de régression volume.

## Pourquoi — justification

- Rejouer **V2 en production** après validation sur **`smart_analyser_test`** garantit un **comportement prévisible** et évite d’écart schéma prod vs test pour le backend et les futures couches JPA.
- La vérification **`COUNT(*)`** sur les tables critiques prouve que V2 **n’a pas tronqué** les données applicatives existantes.

## Explication sans background informatique

On a ajouté **de nouveaux dossiers vides** dans l’armoire de données (les **7 nouvelles tables**) pour les futurs usages (voitures, signaux, anomalies, etc.), **sans modifier** le contenu des dossiers déjà remplis (trames, sessions, comptes utilisateurs).

## Comment tester manuellement

```powershell
$mysql = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
$prod  = "smart_real_time_analyser"
```

**Avant V2 — nombre de tables (attendu : 14)**

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT COUNT(*) as table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = '$prod';"
```

**Avant V2 — absence des 7 tables**

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = '$prod'
AND TABLE_NAME IN (
    'cars','ecu_catalogs','signal_definitions',
    'signal_thresholds','anomaly_results',
    'export_jobs','user_preferences'
);"
```

**Appliquer V2**

```powershell
Get-Content "C:\tools\Kpit_c\db\migrations\V2__create_new_tables.sql" | `
  & $mysql -u root --password="<MOT_DE_PASSE>" smart_real_time_analyser
```

**Après V2 — `table_count` = 21**, **`SHOW TABLES`** liste 21 noms, puis par exemple :

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "DESCRIBE cars;"
& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "DESCRIBE anomaly_results;"
```

**FKs sur `cars`** (attendu : `fk_cars_ecu_catalog`, `fk_cars_owner_user`) :

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT CONSTRAINT_NAME, COLUMN_NAME,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = '$prod'
AND TABLE_NAME = 'cars'
AND REFERENCED_TABLE_NAME IS NOT NULL;"
```

**InnoDB sur les 7 tables** :

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = '$prod'
AND TABLE_NAME IN (
    'cars','ecu_catalogs','signal_definitions',
    'signal_thresholds','anomaly_results',
    'export_jobs','user_preferences'
)
ORDER BY TABLE_NAME;"
```

**Données inchangées** (attendu après V1+V2 sur cette machine : **371 854** / **88** / **2**) :

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT COUNT(*) as frame_count FROM can_frames;
SELECT COUNT(*) as session_count FROM can_sessions;
SELECT COUNT(*) as user_count FROM users;"
```

## Problèmes rencontrés et corrections appliquées

- **Aucune erreur lors de l’exécution de l’étape 2** — sortie client MySQL limitée à l’avertissement sur le mot de passe en ligne de commande ; **code de sortie 0**. Aucune correction n’a été nécessaire.

## Mots clés pour la soutenance

Migration V2 production, **7 nouvelles tables**, **`ecu_catalogs`**, **`cars`**, **`signal_definitions`**, **`signal_thresholds`**, **`anomaly_results`**, **`export_jobs`**, **`user_preferences`**, InnoDB utf8mb4, FK **`cars`**, schéma **21 tables**, non-régression **`COUNT(*)`**.

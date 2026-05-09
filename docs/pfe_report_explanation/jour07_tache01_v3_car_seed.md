# Jour 7 — Tâche 1 : migration **V3** — `car_id`, véhicules seed et rattachement des sessions

## Ce qui a été fait

- Ajout du script **`db/migrations/V3__car_seed_and_assignment.sql`** :
  - colonne **`car_id`** + index **`idx_can_sessions_car_id`** sur **`can_sessions`** ;
  - colonne **`car_id`** + index **`idx_log_files_car_id`** sur **`log_files`** ;
  - insertion de **deux** véhicules seed (**Legacy — Pre-Migration Sessions**, **KPIT — CAN Simulator**), tous deux **virtuels** et **actifs** ;
  - **`UPDATE`** de toutes les sessions existantes vers l’identifiant interne (**`LAST_INSERT_ID()`**) du véhicule **Legacy** ;
  - ajout des contraintes FK **`fk_can_sessions_car`** et **`fk_log_files_car`** vers **`cars(id)`** avec **`ON DELETE SET NULL`**.
- Exécution **réussie** sur **`smart_analyser_test`** puis, après validation des post-contrôles, sur **`smart_real_time_analyser`** (production).
- Contrôles : **`null_car_id = 0`**, **`88`** sessions attribuées au **`car_id = 1`** (Legacy), **`2`** lignes dans **`cars`** sur les deux bases.

## Ce que ça fait pour le projet

- Chaque ligne **`can_sessions`** porte désormais un lien logique (**`car_id`**) vers l’entité véhicule, ce qui permet d’associer futures analyses, exports ou UI à une **voiture** plutôt qu’à une session isolée.
- Les fichiers de log peuvent également être reliés à un véhicule (**`log_files.car_id`**) lorsque la pipeline les enrichira.
- Les **sessions historiques** sont regroupées sous un véhicule **placeholder Legacy**, ce qui évite les **`NULL`** bloquants pour les filtres métier « par voiture ».

## Comment — explication technique

1. **Ordre des opérations** : **`ALTER`** colonnes nullable sans FK → **seed** **`cars`** → **`UPDATE can_sessions`** → **`ALTER ADD CONSTRAINT`**. Cela respecte InnoDB (**pas de FK vers lignes inexistantes** avant remplissage de **`car_id`**).
2. **`SET @legacy_id = LAST_INSERT_ID()`** après le premier **`INSERT`** capture l’**`id`** auto-incrémenté du véhicule Legacy pour l’**`UPDATE`** en masse.
3. **`UUID()`** renseigne **`car_uid`** (obligatoire, unique) pour chaque véhicule inséré.
4. Les index **`idx_can_sessions_car_id`** / **`idx_log_files_car_id`** préparent les filtres **`WHERE car_id = ?`**.

## Pourquoi — justification

Reporter **`car_id`** à **V3** permettait de s’aligner sur l’introduction de l’**entité Car** côté applicatif (**Sprint 5**) tout en gardant **V2** centrée sur la **création de tables**. Le véhicule **Legacy** matérialise explicitement les données **anterieures au modèle Car** sans perdre la traçabilité.

## Explication sans background informatique

On a relié **toutes les anciennes séances CAN** à une **« voiture fictive »** nommée Legacy dans l’ordinateur qui gère la base, puis on a créé une **deuxième voiture fictive** pour les futurs tests simulateur KPIT. Ainsi, aucune ancienne séance ne reste **sans groupe « véhicule »**.

## Comment tester manuellement

Variables :

```powershell
$mysql = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
```

### Appliquer V3 sur une base cible `MYDB`

```powershell
Get-Content "C:\tools\Kpit_c\db\migrations\V3__car_seed_and_assignment.sql" | `
  & $mysql -u root --password="<MOT_DE_PASSE>" MYDB
```

**Sortie observée sur cette tâche (test puis prod)** : uniquement l’avertissement MySQL sur le mot de passe ; **EXIT=0**.

### Contrôles (remplacer le nom de base)

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" MYDB -e "
SELECT COUNT(*) as null_car_id FROM can_sessions WHERE car_id IS NULL;
SELECT COUNT(*) as total_sessions FROM can_sessions;
SELECT car_id, COUNT(*) as cnt FROM can_sessions GROUP BY car_id;
SELECT COUNT(*) as total_cars FROM cars;
SELECT id, make, model, is_virtual FROM cars;"
```

**Résultats observés sur `smart_analyser_test` après V3**

```
null_car_id
0
total_sessions
88
car_id	cnt
1	88
total_cars
2
id	make	model	is_virtual
1	Legacy	Pre-Migration Sessions	1
2	KPIT	CAN Simulator	1
```

Métadonnées **`car_id`** + FK :

```
COLUMN_NAME	COLUMN_TYPE
car_id	bigint
CONSTRAINT_NAME	REFERENCED_TABLE_NAME
fk_can_sessions_car	cars
```

**Résultats observés sur `smart_real_time_analyser` après V3**

```
null_car_id
0
total_sessions
88
car_id	session_count
1	88
id	make	model	is_virtual	is_active
1	Legacy	Pre-Migration Sessions	1	1
2	KPIT	CAN Simulator	1	1
```

## Problèmes rencontrés et corrections appliquées

1. **Aucune erreur SQL** lors des exécutions sur **`smart_analyser_test`** et **`smart_real_time_analyser`** (**exit code 0**). **Aucune correction de script** n’a été nécessaire.
2. **Note** — Si V3 était **rejouée** sur une base déjà migrée (**colonnes **`car_id`** ou contraintes existantes**, ou **véhicules déjà présents**), **`ALTER`** / **`INSERT`** peuvent échouer (**doublons**, **`Duplicate column`**). Dans ce dépôt, la migration n’a été exécutée **qu’une fois** par base.

## Mots clés pour la soutenance

Migration V3, **`car_id`**, **`can_sessions`**, **`log_files`**, seed **`cars`**, véhicule **Legacy**, **KPIT CAN Simulator**, **`LAST_INSERT_ID`**, FK **`fk_can_sessions_car`**, rattachement **88 sessions**, test **`smart_analyser_test`** puis production.

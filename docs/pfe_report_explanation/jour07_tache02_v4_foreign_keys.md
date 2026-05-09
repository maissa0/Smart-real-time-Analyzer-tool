# Jour 7 — Tâche 2 : migration **V4** — clés étrangères **`can_frames`** / **`integrity_faults`** → **`can_sessions`**

## Ce qui a été fait

- Création du script **`db/migrations/V4__add_foreign_keys.sql`** ajoutant :
  - **`fk_can_frames_session`** : **`can_frames.session_id` → `can_sessions.session_id`** avec **`ON DELETE CASCADE`** et **`ON UPDATE CASCADE`** ;
  - **`fk_integrity_faults_session`** : **`integrity_faults.session_id` → `can_sessions.session_id`** avec la même politique de cascade.
- Exécution **réussie** sur **`smart_analyser_test`** puis sur **`smart_real_time_analyser`** (sortie client : avertissement mot de passe uniquement, **code 0**).
- Vérification **`information_schema.KEY_COLUMN_USAGE`** : **2 lignes** nommées comme attendu sur chaque base pour les deux contraintes.
- En production : **`total_fk_count = 20`** (soit **18** relations déjà présentes **+ 2** nouvelles) ; comptages après migration **sans suppression de test** : **`can_frames` = 371 854**, **`can_sessions` = 88**, **`integrity_faults` = 153**.

## Ce que ça fait pour le projet

- Impossible d’insérer des **trames** ou des **fautes d’intégrité** pointant vers une **session inexistante** : la base **refuse** les orphelins à l’origine.
- En **supprimant une session**, MySQL peut **cascade** vers les trames et les fautes associées, ce qui évite l’accumulation de **lignes zombies** et garde les volumes cohérents (`session → frames/faults`).
- Les FK **`car_id`** (**V3**) restent inchangées ; **V4** complète le graphe **CAN** autour de **`session_id`** (clé métier textuelle partagée).

## Comment — explication technique

1. **Prérequis** : `session_id` même type/collation sur les trois tables (**`varchar(255) utf8mb4_unicode_ci`**), **0** orphelin vérifié avant exécution.
2. **`REFERENCES can_sessions (session_id)`** : la cible FK est une colonne **`UNIQUE`** (clé métier session), acceptable comme parent InnoDB même si ce n’est pas la clé primaire numérique **`id`**.
3. **`ON DELETE CASCADE`** : propagation de suppression **session → frames/faults** ; **`ON UPDATE CASCADE`** : renommage/thrash rare sur **`session_id`** propagé sans cassure.
4. **Comptage des FK dans `information_schema`** : une ligne **par colonne** participant à une FK ; le total **20** agrège bien l’ensemble des usages référencés sur le schéma.

## Pourquoi — justification

Sans FK, l’application et les pipelines pouvaient théoriquement recréer des **données incohérentes** après V1 (nettoyage ponctuel). **V4** **verrouille le modèle** au niveau SGBDR : prévention pérenne et comportement défini sur suppression de session pour la démo soutenance et la production.

## Explication sans background informatique

On a ajouté des **règles automatiques dans la base** : une trame CAN ou une alerte ne peut plus être enregistrée si la **session** à laquelle elle pretend appartenir **n’existe pas**. Si on **supprime une session**, les lignes qui en dépendent peuvent être **nettoyées en chaîne**, pour éviter des dossiers incomplets qui traînent.

## Comment tester manuellement

```powershell
Get-Content "C:\tools\Kpit_c\db\migrations\V4__add_foreign_keys.sql" | `
  & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" `
  -u root --password="<MOT_DE_PASSE>" smart_analyser_test
```

Puis même commande avec **`smart_real_time_analyser`**.

Contrôle des deux contraintes nommées (exemple **`MYDB`**) :

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" MYDB -e "
SELECT TABLE_NAME, CONSTRAINT_NAME,
       COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'MYDB'
AND CONSTRAINT_NAME IN (
    'fk_can_frames_session',
    'fk_integrity_faults_session'
);"
```

**Résultat observé (`smart_analyser_test` et production)**

```
TABLE_NAME	CONSTRAINT_NAME	COLUMN_NAME	REFERENCED_TABLE_NAME	REFERENCED_COLUMN_NAME
can_frames	fk_can_frames_session	session_id	can_sessions	session_id
integrity_faults	fk_integrity_faults_session	session_id	can_sessions	session_id
```

Compteur global FK en production après V4 :

```
total_fk_count
20
```

Comptages post-migration (**production**, sans jeu de suppression) :

```
frame_count
371854
session_count
88
fault_count
153
```

## Problèmes rencontrés et corrections appliquées

**Aucune erreur SQL** sur **`smart_analyser_test`** ni sur **`smart_real_time_analyser`** (**EXIT 0`). Aucune modification corrective du fichier V4 n’a été nécessaire.

## Mots clés pour la soutenance

Migration V4, clé étrangère **`fk_can_frames_session`**, **`fk_integrity_faults_session`**, **`ON DELETE CASCADE`**, **`ON UPDATE CASCADE`**, intégrité référentielle CAN, **`session_id`**, prévention **orphan frames**, **`information_schema.KEY_COLUMN_USAGE`.

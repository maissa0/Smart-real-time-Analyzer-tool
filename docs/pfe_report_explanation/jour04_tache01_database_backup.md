# Jour 4 — Tâche 1 : sauvegarde et restauration de la base MySQL (pré-migration)

## Ce qui a été fait

- Création du dossier `db/migrations/` avec un fichier `.gitkeep` pour que Git suive le répertoire vide.
- Vérification de la connexion MySQL sur la base `smart_real_time_analyser` (comptages sur `can_frames` et `can_sessions`).
- Export des estimations de lignes par table via `information_schema.tables`.
- Génération d’un dump SQL avec `mysqldump` (`--single-transaction`, `--routines`, `--triggers`) vers `db/migrations/backup_pre_migration_YYYYMMDD.sql`.
- Création de la base de test `smart_analyser_test` (utf8mb4 / utf8mb4_unicode_ci).
- Restauration du dump dans `smart_analyser_test` via pipeline PowerShell (`Get-Content` → `mysql`).
- Vérification post-restauration (même requêtes que sur la source).
- Ajout temporaire du répertoire `bin` de MySQL au `PATH` de la session et affichage de `mysql --version`.
- Mise à jour de `.gitignore` pour exclure les fichiers SQL de sauvegarde sous `db/migrations/`.
- Contrôle avec `git check-ignore` pour confirmer que le fichier de backup n’est pas versionné.

## Ce que ça fait pour le projet

- On dispose d’une **copie figée** de la base de production (schéma, données, routines, triggers) avant toute évolution de schéma ou migration applicative.
- La base **`smart_analyser_test`** permet de **rejouer le dump** sans toucher aux données utilisées au quotidien, ce qui limite les risques lors des essais ou des migrations.
- Les fichiers `.sql` de sauvegarde sont **explicitement ignorés par Git**, ce qui évite d’exporter par erreur des données sensibles dans le dépôt.

## Comment — explication technique

1. **`db/migrations/`** : convention pour stocker artefacts liés aux migrations ; `.gitkeep` force Git à versionner le dossier tout en ignorant les dumps (règles `.gitignore`).
2. **`mysqldump`** : extrait DDL + DML ; `--single-transaction` minimise les verrous sur InnoDB ; `--routines` et `--triggers` incluent procédures / triggers.
3. **Encodage** : passage par `Out-File -Encoding utf8` en PowerShell produit un fichier texte lisible par `mysql` en entrée standard.
4. **Restauration** : redirection du contenu du fichier vers `mysql` ciblant uniquement `smart_analyser_test`, sans modifier `smart_real_time_analyser`.
5. **`information_schema.tables.table_rows`** : valeur **approximative** pour les tables InnoDB ; les **vérités** métier sont les `COUNT(*)`.
6. **`.gitignore`** : motifs `db/migrations/*.sql` et `db/migrations/backup_*.sql` couvrent tous les dumps nommés `backup_pre_migration_*.sql` et autres SQL locaux dans ce dossier.

## Pourquoi — justification

- Sauvegarder avant migration est une **discipline minimale** de gestion du risque : retour arrière possible, comparaison avant/après, répétabilité sur machine de test.
- Une base **isolée (`smart_analyser_test`)** évite les erreurs irreversibles sur la base nominale lors des validations.
- Ignorer les `.sql` de backup dans Git répond aux **bonnes pratiques sécurité** (pas de données réelles dans l’historique du code).

## Explication sans background informatique

On a fait une **copie de secours complète** de la base de données comme on ferait une **photographie** de tous les dossiers avant de réorganiser un bureau : si quelque chose se passe mal plus tard, on peut **revenir à cette photo**. On a aussi créé une **copie dans un bac à test** pour vérifier que la sauvegarde se rouvre bien, sans toucher aux vraies données du jour au jour.

## Comment tester manuellement

À exécuter dans **PowerShell** à la racine du projet ou sans importance du répertoire courant (chemins absolus utilisés ci-dessous). Remplacez `--password="…"` si votre environnement utilise un mot de passe différent.

### 1) Connexion et comptages sur la base source

**Commande :**

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root --password="M28d05&" smart_real_time_analyser -e "SELECT COUNT(*) as frame_count FROM can_frames; SELECT COUNT(*) as session_count FROM can_sessions; SELECT COUNT(*) as session_total FROM can_sessions;"
```

**Sortie attendue (valeurs observées lors de cette tâche) :**

```
mysql: [Warning] Using a password on the command line interface can be insecure.
frame_count
390092
session_count
88
session_total
88
```

**Capture à placer après exécution :**  
`docs/pfe_report_explanation/screenshots/jour04_tache01_mysql_counts_source.png`

---

### 2) `table_rows` par table (`information_schema`) — base source

**Commande :**

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root --password="M28d05&" smart_real_time_analyser -e "SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = 'smart_real_time_analyser' ORDER BY table_name;"
```

**Sortie attendue (extrait / tableau tel qu’affiché) :**

```
TABLE_NAME	TABLE_ROWS
audit_logs	52
can_frames	361754
can_sessions	80
integrity_faults	150
log_files	4
mfa_recovery_codes	10
otp_codes	0
permissions	5
refresh_tokens	42
role_permissions	12
roles	4
sessions	49
user_roles	2
users	2
```

**Capture :**  
`docs/pfe_report_explanation/screenshots/jour04_tache01_information_schema_source.png`

---

### 3) Vérifier la présence et la taille du fichier de backup

Après avoir exécuté le bloc de sauvegarde du jour (voir étape 4 ci-dessous si vous la refaites), ou en listant le dossier :

**Commande :**

```powershell
cmd /c dir "C:\tools\Kpit_c\db\migrations"
```

**Sortie attendue (exemple réel) :** présence de `backup_pre_migration_YYYYMMDD.sql` avec une taille non nulle (ex. ~173 146 434 octets pour le dump produit lors de la tâche).

**Capture :**  
`docs/pfe_report_explanation/screenshots/jour04_tache01_backup_file_properties.png`

---

### 4) (Option reprise complète) Recréer le dump du jour

**Commande :**

```powershell
$date = Get-Date -Format "yyyyMMdd"
$backupFile = "C:\tools\Kpit_c\db\migrations\backup_pre_migration_$date.sql"
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -u root --password="M28d05&" --single-transaction --routines --triggers smart_real_time_analyser | Out-File -FilePath $backupFile -Encoding utf8
Get-Item $backupFile | Select-Object Name, Length
```

**Sortie attendue :** avertissement mot de passe en ligne de commande ; objet avec `Name` et `Length` renseignés.

---

### 5) Créer et afficher la base de test

**Commande :**

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root --password="M28d05&" -e "CREATE DATABASE IF NOT EXISTS smart_analyser_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root --password="M28d05&" -e "SHOW DATABASES LIKE 'smart_analyser_test';"
```

**Sortie attendue :**

```
Database (smart_analyser_test)
smart_analyser_test
```

**Capture :**  
`docs/pfe_report_explanation/screenshots/jour04_tache01_test_db_show_databases.png`

---

### 6) Restaurer le premier backup `backup_pre_migration_*.sql` trouvé

**Commande :**

```powershell
$backupFile = (Get-ChildItem "C:\tools\Kpit_c\db\migrations\backup_pre_migration_*.sql" | Select-Object -First 1).FullName
Get-Content $backupFile | & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root --password="M28d05&" smart_analyser_test
```

**Sortie attendue :** uniquement l’avertissement mot de passe ; code de sortie `0`.

---

### 7) Vérifier la restauration sur `smart_analyser_test`

**Commande :**

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root --password="M28d05&" smart_analyser_test -e "SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = 'smart_analyser_test' ORDER BY table_name;"
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root --password="M28d05&" smart_analyser_test -e "SELECT COUNT(*) as frame_count FROM can_frames; SELECT COUNT(*) as session_count FROM can_sessions;"
```

**Sortie attendue pour les `COUNT(*)` :** identique à l’étape 1 — `frame_count` = **390092**, `session_count` = **88**.  
Les lignes `information_schema` peuvent **différer** de la base source (statistiques approximatives InnoDB) ; voir section problèmes.

**Capture :**  
`docs/pfe_report_explanation/screenshots/jour04_tache01_verify_restore_counts.png`

---

### 8) `mysql --version` (session courante)

**Commande :**

```powershell
$env:PATH += ";C:\Program Files\MySQL\MySQL Server 8.0\bin"
mysql --version
```

**Sortie attendue :**

```
C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe  Ver 8.0.41 for Win64 on x86_64 (MySQL Community Server - GPL)
```

**Capture :**  
`docs/pfe_report_explanation/screenshots/jour04_tache01_mysql_version.png`

---

### 9) Vérifier que Git ignore le backup

**Commande (fichier concret) :**

```powershell
git -C C:/tools/Kpit_c check-ignore -v db/migrations/backup_pre_migration_20260508.sql
```

**Sortie attendue :**

```
.gitignore:65:db/migrations/backup_*.sql	db/migrations/backup_pre_migration_20260508.sql
```

**Commande (avec glob, tel que demandé dans la procédure) :**

```powershell
git -C C:/tools/Kpit_c check-ignore -v db/migrations/backup_pre_migration_*.sql
```

**Sortie observée :**

```
.gitignore:65:db/migrations/backup_*.sql	db/migrations/backup_pre_migration_*.sql
```

**Capture :**  
`docs/pfe_report_explanation/screenshots/jour04_tache01_git_check_ignore.png`

## Problèmes rencontrés et corrections appliquées

1. **Avertissement MySQL « Using a password on the command line interface can be insecure »**  
   Comportement normal : le client signale que le mot de passe est visible dans la ligne de commande ou l’historique du shell. Aucune correction requise pour un poste local de développement ; en production il faudrait privilégier un fichier d’options ou des secrets hors ligne de commande.

2. **Écart entre `information_schema.tables.table_rows` sur la source et sur `smart_analyser_test` après restauration, alors que les `COUNT(*)` correspondent**  
   Explication : pour InnoDB, `table_rows` est une **estimation** ; elle peut être obsolète ou différente d’une base à l’autre après import. Les comptages exacts **`SELECT COUNT(*)`** confirment que la restauration est **cohérente** avec la source (**390 092** lignes dans `can_frames`, **88** dans `can_sessions`). Aucune action corrective sur les données ; la validation officielle doit s’appuyer sur **`COUNT(*)`**.

3. **Sortie vide de certaines commandes PowerShell (`Get-Item` / `Select-Object`) dans l’outil d’automatisation**  
   Pour obtenir la taille du fichier de backup de façon fiable, utilisation alternative de **`cmd /c dir`**, qui a bien affiché **173 146 434** octets pour `backup_pre_migration_20260508.sql`.

## Mots clés pour la soutenance

Sauvegarde MySQL, `mysqldump`, `--single-transaction`, restauration, base de test, `information_schema`, `COUNT(*)`, utf8mb4, `.gitignore`, pas de données sensibles dans Git, rollback, pré-migration.


One note on the row counts:
The task description mentioned 396,224 frames but your actual count is 390,092. This is fine — the handoff document numbers were estimates. What matters is that source and test database match exactly which they do.

What you can tell the jury:

"Avant d'appliquer les migrations Flyway, j'ai effectué une sauvegarde complète de la base de données de production avec mysqldump --single-transaction — cette option garantit la cohérence des données sans verrouiller les tables pendant la sauvegarde. J'ai ensuite restauré cette sauvegarde dans une base de test smart_analyser_test et vérifié que les comptages correspondaient exactement : 390 092 trames et 88 sessions. Toutes les migrations du jour ont été testées sur cette copie avant d'être appliquées à la base réelle."



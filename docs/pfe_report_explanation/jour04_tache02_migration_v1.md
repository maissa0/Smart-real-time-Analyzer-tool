# Jour 4 — Tâche 2 : migration schéma V1 (`fix_existing_tables`)

## Ce qui a été fait

- Création du fichier versionné de migration : `db/migrations/V1__fix_existing_tables.sql` (nettoyage des orphelins, ajustements de types sur `can_frames`, extension de `can_sessions`, index sur `integrity_faults` et `log_files`).
- Exécution et validation **uniquement sur la base de test** `smart_analyser_test` (la base de production `smart_real_time_analyser` n’a **pas** été modifiée dans cette tâche).
- **18 238** trames orphelines supprimées de `can_frames` (plus de ligne `can_sessions` correspondante).
- Colonne `signals` : **TEXT → JSON**.
- Colonne `raw_bytes` : **TEXT → VARCHAR(30)**.
- Colonne `direction` : **VARCHAR(255) → ENUM('Rx','Tx','Unknown')** avec valeur par défaut **`Unknown`**.
- Colonnes `msg_id`, `msg_name`, `channel_name` : réduction aux tailles **VARCHAR(20)**, **VARCHAR(100)**, **VARCHAR(64)**.
- Table `can_sessions` : ajout de **`user_id` (BINARY(16))**, **`status` (ENUM)**, **`updated_at` (DATETIME ON UPDATE)** et des index associés **`idx_can_sessions_user_id`**, **`idx_can_sessions_status`**.
- Table `integrity_faults` : index **`idx_integrity_faults_session_id`**, **`idx_integrity_faults_fault_type`**, **`idx_integrity_faults_frame_id`**, **`idx_integrity_faults_created_at`**.
- Table `log_files` : index **`idx_log_files_status`**.
- Vérification post-migration via requêtes SQL (effectifs, orphelins, métadonnées `information_schema`, `SHOW INDEX`, répartition des directions).

## Ce que ça fait pour le projet

- Les données CAN restent exploitables avec un schéma **plus strict** (types adaptés aux contenus réels, JSON natif pour `signals`).
- Les requêtes par session, utilisateur ou statistiques d’intégrité peuvent **s’appuyer sur des index** au lieu de parcourir des tables entières.
- La table `can_sessions` est prête pour le **périmètre Sprint 5** (propriétaire, cycle de vie de session) tout en gardant **`car_id` pour une V2** avec la future table `cars`.
- La base de test reflète désormais le **comportement attendu** avant d’appliquer la même migration en production après validation métier et sauvegarde.

## Comment — explication technique

1. **Suppression des orphelins** : `DELETE ... WHERE session_id NOT IN (SELECT session_id FROM can_sessions)` retire les lignes de `can_frames` sans parent ; les jointures applicatives cessent alors de ramener des « fantômes ».
2. **ALTER sur `can_frames`** : conversions successives compatibles avec les données présentes (pré-validation JSON_INVALID = 0, longueurs max observées pour `raw_bytes` et les VARCHAR).
3. **ENUM direction** : confine les valeurs à `Rx`, `Tx` ou `Unknown` ; la valeur par défaut couvre les futurs inserts sans sens logique précisé.
4. **`can_sessions`** : colonnes et index orientés filtres utilisateur (`user_id`) et filtre métier (`status`) ; horodatage de dernière modification automatique via `ON UPDATE CURRENT_TIMESTAMP`.
5. **Index secondaires** : accélération des filtres/`JOIN` sur `integrity_faults` (session, type de faute, trame concernée, date) et sur `log_files.status`.
6. **Exécution** : script appliqué via client MySQL avec **`SOURCE`** (chemin fichier) ; fonctionne également en pipe **`Get-Content ... | mysql`** si besoin hors mode interactif Windows.

## Pourquoi — justification

- **Données orphelines** : sans session parente, ces trames ne peuvent pas être présentées dans un flux session → trames ; les conserver complique les requêtes et fausse les agrégats. La suppression après diagnostic est une décision traçable (Option A).
- **Types colonnes** : réduire le stockage et activer les capacités SQL sur JSON sécurise le modèle et clarifie les contrats API / persistance.
- **Index** : alignés sur les accès prévisibles (session, utilisateur, type de faute) pour limiter la charge lorsque les volumes augmentent.
- **Test sur `smart_analyser_test` d’abord** : évite tout impact sur les utilisateurs jusqu’à relecture et fenêtre de maintenance sur la base nominale.

## Explication sans background informatique

On a préparé une **liste d’instructions** pour « ranger et étiqueter » mieux les enregistrements dans les tableaux qui stockent les sessions CAN et les trames associées : on enlève les lignes qui ne rattachent plus à aucune session, on choisit des formats de colonnes plus précis pour le texte et les signaux, et on ajoute des **repères alphabétiques** (index) pour retrouver vite les lignes comme dans un fichier avec un bon sommaire. Tout cela a d’abord été **essayé sur une copie de test**, pas encore sur la base réelle utilisée par l’application.

## Comment tester manuellement

Toutes les commandes ci‑dessous utilisent :

```powershell
$mysql = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
```

### Appliquer V1 sur `smart_analyser_test`

**Option A — `SOURCE` (celle utilisée lors de cette tâche)**

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test `
  -e "SOURCE C:/tools/Kpit_c/db/migrations/V1__fix_existing_tables.sql"
```

**Sortie observée lors de cette tâche** : uniquement l’avertissement habituel du client MySQL concernant le mot de passe sur la ligne de commande ; **aucune erreur** ; **code de sortie 0**. Durée environ **~70 s** sur l’environnement de test.

**Option B — pipeline PowerShell**

```powershell
Get-Content "C:\tools\Kpit_c\db\migrations\V1__fix_existing_tables.sql" | `
  & $mysql -u root --password="M28d05&" smart_analyser_test
```

À utiliser si `SOURCE` via `-e` n’est pas pris en charge dans un contexte donné.

### Appliquer sur la production **quand ce sera décidé** (après sauvegarde et validation)

Remplacer le nom de la base cible :

```powershell
Get-Content "C:\tools\Kpit_c\db\migrations\V1__fix_existing_tables.sql" | `
  & $mysql -u root --password="M28d05&" smart_real_time_analyser
```

**(Important :** faire une sauvegarde complète avant, et éviter les mots de passe en clair en production lorsque possible.)

---

### Vérifications post-migration (sorties observées après exécution sur `smart_analyser_test`)

**3a — nombre de trames après suppression des orphelins**

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "SELECT COUNT(*) as frame_count FROM can_frames;"
```

**Sortie attendue :**

```
frame_count
371854
```

**(390 092 − 18 238 = 371 854.)**

---

**3b — plus aucune trame orpheline**

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "
SELECT COUNT(*) as orphan_frames
FROM can_frames cf
LEFT JOIN can_sessions cs ON cf.session_id = cs.session_id
WHERE cs.session_id IS NULL;"
```

**Sortie attendue :**

```
orphan_frames
0
```

---

**3c — types des colonnes de `can_frames`**

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'smart_analyser_test'
AND TABLE_NAME = 'can_frames'
ORDER BY ORDINAL_POSITION;"
```

**Sortie attendue (résumé des types modifiés) :**  
`signals` → **json**, `raw_bytes` → **varchar(30)**, `direction` → **enum('Rx','Tx','Unknown')** avec défaut **Unknown**, `msg_id` / `msg_name` / `channel_name` tailles comme ci‑dessous :

```
COLUMN_NAME … channel_name varchar(64) …
msg_id varchar(20) …
msg_name varchar(100) …
direction enum('Rx','Tx','Unknown') … Unknown …
raw_bytes varchar(30) …
signals json …
```

---

**3d — nouvelles colonnes `can_sessions`**

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'smart_analyser_test'
AND TABLE_NAME = 'can_sessions'
ORDER BY ORDINAL_POSITION;"
```

**Sortie attendue :** présence en fin de liste de **`user_id`**, **`status`**, **`updated_at`** avec défaut **`completed`** pour `status` et défaut **`CURRENT_TIMESTAMP`** pour `updated_at`.

---

**3e / 3f — index**

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "SHOW INDEX FROM integrity_faults;"
& $mysql -u root --password="M28d05&" smart_analyser_test -e "SHOW INDEX FROM log_files;"
```

**Sortie attendue :** lignes pour **`idx_integrity_faults_session_id`** (et les trois autres préfixés **`idx_integrity_faults_*`**) ainsi que **`idx_log_files_status`** en plus du primaire et de l’unique `session_id` existant sur `log_files`.

---

**3g — répartition ENUM direction**

```powershell
& $mysql -u root --password="M28d05&" smart_analyser_test -e "
SELECT direction, COUNT(*) as cnt
FROM can_frames
GROUP BY direction;"
```

**Sortie observée :**

```
direction	cnt
Rx	371616
Tx	238
```

**(Somme = 371 854, aucune valeur rejetée par l’ENUM.)**

---

### Contrôle Git (script de migration)

```powershell
git -C C:/tools/Kpit_c check-ignore -v db/migrations/V1__fix_existing_tables.sql
```

**Après correction du `.gitignore` (préfixe `backup_*` uniquement) :** cette commande **ne doit afficher aucune sortie** et se termine avec un **code de sortie 1** (fichier non ignoré). Les dumps `backup_pre_migration_*.sql` restent exclus par `db/migrations/backup_*.sql`.

### Captures d’écran (à prendre après exécution locale)

Chemens suggérés sous `docs/pfe_report_explanation/screenshots/` (dossier déjà utilisé dans le projet) :

- `jour04_tache02_source_migration_output.png` — fenêtre après `SOURCE` ou pipe `mysql`
- `jour04_tache02_verify_frame_orphan.png` — résultats des requêtes 3a et 3b
- `jour04_tache02_verify_columns_indexes.png` — résultats 3c–3f et 3g
- `jour04_tache02_git_check_ignore_v1.png` — résultat de `git check-ignore -v`

## Problèmes rencontrés et corrections appliquées

1. **Trames orphelines (18 238)** — Lors du diagnostic précédent, environ **18 238** lignes de `can_frames` avaient un `session_id` sans équivalent dans `can_sessions`. Elles ont été **supprimées par la SECTION 1** du script ; le compte final **371 854** et **`orphan_frames = 0`** confirment l’état attendu après migration.

2. **Casse des directions `Rx` / `Tx` (et non `RX` / `TX`)** — Les données réelles groupement **`Rx`** et **`Tx`**. Définir l’ENUM en majuscules seules aurait provoqué une erreur de conversion ou aurait forcé une normalisation lourde. L’ENUM a donc été choisi avec **`'Rx','Tx','Unknown'`** après audit.

3. **`car_id` absent de la V1** — Conformément au plan du script et au périmètre Sprint/entités : la liaison véhicule **`car_id`** est reportée à **V2** avec la création de la table **`cars`**.

4. **Durée / verbosité de l’exécution** — L’application de V1 via `SOURCE` a pris **une minute environ** sans message d’erreur ; seul l’avertissement standard MySQL sur le mot de passe en ligne de commande est apparu. Aucune correction technique n’a été nécessaire.

### Problème — V1 script gitignored par la règle db/migrations/*.sql

- **Cause :** la règle ajoutée en Jour 4 Tâche 1 pour ignorer les backups SQL utilisait le glob **`*.sql`** qui ignorait **tous** les fichiers `.sql` dans **`db/migrations/`** — y compris les scripts de migration Flyway.
- **Correction :** remplacement de **`db/migrations/*.sql`** par **`db/migrations/backup_*.sql`** dans `.gitignore`. Les scripts **`Vx__`** sont désormais versionnés ; seuls les fichiers **`backup_*`** restent ignorés.
- **Règle générale retenue :** ignorer par **préfixe (`backup_*`)** plutôt que par **extension (`*.sql`)** quand les deux types de fichiers coexistent dans le même dossier.

## Mots clés pour la soutenance

Migration MySQL V1, trames CAN orphelines, ENUM direction Rx/Tx, JSON `signals`, index `integrity_faults`, index `log_files`, `can_sessions.user_id`, statut de session Sprint 5, test sur `smart_analyser_test`, Flyway-compatible naming (`V1__…`), `.gitignore` par préfixe `backup_*` pour les dumps tout en versionnant les scripts `Vx__*.sql`.

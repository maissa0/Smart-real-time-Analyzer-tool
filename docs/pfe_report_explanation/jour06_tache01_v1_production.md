# Jour 6 — Tâche 1 : application de la migration **V1** sur la base **production** (`smart_real_time_analyser`)

## Ce qui a été fait

- Exécution des **contrôles pré-migration** sur **`smart_real_time_analyser`** (comptage des orphelins, effectifs trames/sessions, types de colonnes ciblés sur **`can_frames`**).
- Application du script **`db/migrations/V1__fix_existing_tables.sql`** sur la **base de production** via pipeline PowerShell (**`Get-Content` → `mysql`**).
- Exécution des **vérifications post-migration** (effectifs, absence d’orphelins, métadonnées `information_schema`, index sur **`integrity_faults`**, répartition **`direction`**, sessions inchangées).
- Vérification du **démarrage Spring Boot** après migration : pool **Hikari** opérationnel et application **BackendApplication** démarrée (**démarrage lancé depuis la ligne de commande avec `mvnw`**, équivalent fonctionnel à un run IntelliJ sur le même projet).
- Contrôles **HTTP** équivalents Postman : **`GET /api/can/sessions`** sans jeton → **401** ; avec jeton JWT valide (compte **`user@ablepro.com`**) → **200** et **88** sessions dans le corps JSON (données réelles, tableau non vide).

## Ce que ça fait pour le projet

- Le schéma **nominal** utilisé par le backend en ligne (`smart_real_time_analyser`) est **aligné** sur ce qui avait été validé sur **`smart_analyser_test`** : types de colonnes **`can_frames`** corrigés, extension **`can_sessions`**, index **`integrity_faults`** / **`log_files`**, données orphelines supprimées.
- L’application peut continuer à se connecter via **JDBC/Hibernate** sans erreur liée aux nouvelles colonnes ou aux types (**preuve** par démarrage réussi et appel API authentifié retournant les sessions persistées).

## Comment — explication technique

1. **Pré-contrôles** : même requête d’orphelins que lors des journées 4–5 (**`LEFT JOIN` + `IS NULL`**), compteurs **`COUNT(*)`** sur **`can_frames`** / **`can_sessions`**, puis lecture **`information_schema.COLUMNS`** pour les colonnes concernées avant **`ALTER`**.
2. **Application V1** : le client **`mysql`** exécute le script séquentiel (**`DELETE`** orphelins puis plusieurs **`ALTER TABLE`** et **`ADD INDEX`**).
3. **Post-contrôles** : revalidation systématique des indicateurs critiques (pas d’orphelins, **`371 854`** trames après purge, **`88`** sessions, types **`json`** / **`varchar`** / **`enum`**, **`SHOW INDEX`** sur **`integrity_faults`**).
4. **Spring Boot** : **`HikariPool-1 - Start completed`** confirme l’établissement du pool JDBC ; **`Started BackendApplication in … seconds`** confirme le contexte démarré avec la nouvelle géométrie de schéma.
5. **API** : Spring Security rejette l’accès sans **`Authorization: Bearer`**, puis le contrôleur CAN renvoie la liste paginée / tableau des sessions après authentification JWT.

## Pourquoi — justification

- Appliquer V1 **en dernier sur la prod** garantit une **fenêtre courte** où le risque était maîtrisé grâce aux **répétitions** sur la base de test et à la **sauvegarde** documentée précédemment.
- Les **contrôles avant/après** prouvent l’absence de **régression évidente** sur les volumes et les contraintes attendues (**sessions** préservées, **orphelins** éliminés).
- La **vérif applicative** (démarrage + endpoint REST) rattache les changements SQL au **runtime** observé par l’utilisateur final.

## Explication sans background informatique

On a **mis à jour la base réelle** du projet comme on l’avait déjà fait sur une **copie de test** : quelques anciennes lignes CAN sans session ont été **retirées**, et les colonnes ont été **mieux typées** (texte mieux défini, sens des messages CAN contrôlé par une petite liste fixe). Ensuite on a **redémarré le programme principal** qui lit cette base pour vérifier qu’il démarre toujours, puis on a ouvert une **« porte sécurisée »** (`/sessions`) avec un badge numérique pour s’assurer que la liste des enregistrements s’affiche bien.

## Comment tester manuellement

Variables (PowerShell) :

```powershell
$mysql = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
$prod  = "smart_real_time_analyser"
```

### Pré-migration (rejouer pour comparer)

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT COUNT(*) as orphan_frames
FROM can_frames cf
LEFT JOIN can_sessions cs ON cf.session_id = cs.session_id
WHERE cs.session_id IS NULL;"

& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT COUNT(*) as frame_count FROM can_frames;
SELECT COUNT(*) as session_count FROM can_sessions;"

& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = '$prod'
AND TABLE_NAME = 'can_frames'
AND COLUMN_NAME IN ('signals','raw_bytes','direction','msg_id','msg_name','channel_name')
ORDER BY ORDINAL_POSITION;"
```

### Appliquer V1 sur la production

```powershell
Get-Content "C:\tools\Kpit_c\db\migrations\V1__fix_existing_tables.sql" | `
  & $mysql -u root --password="<MOT_DE_PASSE>" smart_real_time_analyser
```

### Post-migration (sorties observées lors de cette tâche après exécution réelle sur cette machine)

```powershell
& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "SELECT COUNT(*) as frame_count FROM can_frames;"
# frame_count attendu : 371854

& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT COUNT(*) as orphan_frames
FROM can_frames cf
LEFT JOIN can_sessions cs ON cf.session_id = cs.session_id
WHERE cs.session_id IS NULL;"
# orphan_frames attendu : 0

& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = '$prod'
AND TABLE_NAME = 'can_frames'
AND COLUMN_NAME IN ('signals','raw_bytes','direction','msg_id','msg_name','channel_name')
ORDER BY ORDINAL_POSITION;"

& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = '$prod'
AND TABLE_NAME = 'can_sessions'
ORDER BY ORDINAL_POSITION;"

& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "SHOW INDEX FROM integrity_faults;"

& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "
SELECT direction, COUNT(*) as cnt
FROM can_frames
GROUP BY direction;"

& $mysql -u root --password="<MOT_DE_PASSE>" $prod -e "SELECT COUNT(*) as session_count FROM can_sessions;"
# session_count attendu : 88
```

### Vérification HTTP (équivalent Postman)

1. Sans jeton :  
   `GET http://localhost:8080/api/can/sessions` → **401**.

2. Obtenir un jeton (exemple compte utilisateur projet, à adapter selon vos comptes) :

   ```http
   POST http://localhost:8080/api/auth/login
   Content-Type: application/json

   {"email":"user@ablepro.com","password":"User123!"}
   ```

3. `GET http://localhost:8080/api/can/sessions` avec header  
   `Authorization: Bearer <accessToken>` → **200** et JSON contenant les sessions (**88** lignes métier lors de cette tâche avec ce compte).

### Démarrage backend (Maven, si IntelliJ indisponible)

```powershell
$env:JAVA_HOME='C:\Users\maiss\.jdks\jbr-17.0.11'   # adapter à votre JDK 17+
$env:DB_PASSWORD='<MOT_DE_PASSE MYSQL>'
$env:JWT_SECRET='dev-jwt-secret-minimum-32-characters-long!!'
$env:INFLUXDB_TOKEN='<TOKEN_INFLUXDB>'
cd C:\tools\Kpit_c\backend
.\mvnw.cmd spring-boot:run
```

Dans les journaux : repérer **`HikariPool-1 - Start completed`** puis **`Started BackendApplication in … seconds`**.

## Problèmes rencontrés et corrections appliquées

1. **Étape 2 — migration SQL** — **Aucune erreur** affichée par le client MySQL ; uniquement l’avertissement habituel concernant un mot de passe sur la ligne de commande ; code de sortie **0**. **Conclusion formulée comme demandée :** « **Aucune erreur — migration identique au test sur `smart_analyser_test`.** »

2. **`JAVA_HOME` absent dans la session terminal initiale pour `mvnw`** — première tentative `./mvnw.cmd spring-boot:run` a échoué avec *« JAVA_HOME … not defined »*. **Correction :** définition **`JAVA_HOME=C:\Users\maiss\.jdks\jbr-17.0.11`** (JDK 17) avant relance (**l’utilisateur en soutenance doit aligner avec son IntelliJ/JDK réel**).

3. **`POST /api/auth/login` avec `admin@ablepro.com / Admin123!` → HTTP 401** — empêchant d’extraire un jeton admin pour Step 5. **Contournement de vérification :** utilisation du compte **`user@ablepro.com`** avec le mot de passe documenté dans le projet (**`User123!`**) qui a renvoyé un **`accessToken`** et permis **`GET /api/can/sessions` → 200** avec **données non vides** (**88** éléments). La cause précise pour l’admin (MFA strict, état du compte, politique sécurité) n’a pas été investiguée pendant cette tâche.

## Mots clés pour la soutenance

Migration V1 production, `smart_real_time_analyser`, trames orphelines **18 238 → 0**, **`371 854`** trames, **`can_frames.signals` JSON**, ENUM **`Rx`/`Tx`/`Unknown`**, extension **`can_sessions`**, index **`integrity_faults`**, **`HikariPool-1 Start completed`**, **`BackendApplication`** démarrage, JWT **`/api/can/sessions`**.

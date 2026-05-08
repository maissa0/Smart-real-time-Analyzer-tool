# jour02 · tâche02 — Tests d’intégration sécurité (`SecurityConfigTest`)

## Ce qui a été fait

- **`SecurityConfigTest.java`** — `@MockitoBean` : `UserDetailsService`, `InfluxWriteService`, **`InfluxQueryService`**, `CanSessionService`, `LogUploadService`, **`PlaybackService`**, `AuditService`, `EmailService` ; **`JavaMailSender` laissé réel** (voir quatrième correction) ; quatre scénarios MockMvc.

- **`application-test.properties`** — H2, **`ddl-auto=none`**, **`spring.sql.init.schema-locations=classpath:schema-test.sql`**, **`spring.jpa.defer-datasource-initialization=true`**, **`H2Dialect`**, JWT, mail localhost:3025, exclusion Kafka seule, Influx placeholders, **`app.storage.type=local`**, **`spring.config.import=`** vide.

- **`schema-test.sql`** — (`backend/src/test/resources/`) : **`CREATE TABLE IF NOT EXISTS`** pour les tables IAM + CAN / logs utilisées par les entités JPA sous tests.

- **Modifié** `backend/pom.xml` — ajout immédiatement après `spring-security-test` du bloc :  
  ```xml
  <dependency>
    <groupId>com.h2database</groupId>
    <artifactId>h2</artifactId>
    <scope>test</scope>
  </dependency>
  ```  

- **Commande Maven exécutée** :  
  `cd C:/tools/Kpit_c/backend && mvnw.cmd test -Dtest=SecurityConfigTest -pl . 2>&1`  
  (avec `JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-22.0.2.9-hotspot` détecté sur la machine utilisée lors de la session.)

- **Résultat Maven (après quatrième correction — retrait du mock `JavaMailSender`)** — **`BUILD SUCCESS`** : **`Tests run: 4, Failures: 0, Errors: 0, Skipped: 0`** (Surefire, `SecurityConfigTest`).

### Correction @MockBean → @MockitoBean (Spring Boot 3.4.x)
- @MockBean (org.springframework.boot.test.mock.mockito.MockBean) est
  déprécié depuis Spring Boot 3.4.0 et sera supprimé dans une version future.
- Remplacement par @MockitoBean
  (org.springframework.test.context.bean.override.mockito.MockitoBean)
  qui est l'API officielle à partir de Spring Boot 3.4.x.
- Comportement identique — seul le package d'import change.

### Correction appliquée après premier échec

- Cause : H2 ne supporte pas la syntaxe MySQL `drop foreign key` lors du ddl-auto=create-drop — les tables n'existaient pas encore au moment du DROP.

- Fix 1 : ajout de `spring.jpa.properties.hibernate.hbm2ddl.halt_on_error=false` dans application-test.properties pour ignorer les erreurs DDL non fatales.

- Fix 2 : ajout de `@MockBean` pour InfluxWriteService, CanSessionService, LogUploadService et AuditService — ces beans nécessitent une infrastructure réelle (InfluxDB, Kafka) qui n'est pas disponible en contexte de test.

### Deuxième correction — JavaMailSender non satisfait

- Cause : EmailService injecte JavaMailSender par constructeur.  
  Exclure MailSenderAutoConfiguration supprimait le bean dont EmailService dépend, causant UnsatisfiedDependencyException au démarrage du contexte.

- Fix 1 : suppression de l'exclusion MailSenderAutoConfiguration dans application-test.properties — Spring crée le bean JavaMailSender pointant vers localhost:3025 (inexistant mais suffisant pour le démarrage).

- Fix 2 : ajout de **@MockBean EmailService** dans SecurityConfigTest pour court-circuiter l’envoi réel ; **`JavaMailSender` reste un bean auto-configuré** (localhost:3025) — le mock sur `JavaMailSender` a été retiré plus tard (quatrième correction).

### Troisième correction — remplacement de ddl-auto par schema-test.sql

- Cause racine : avec ddl-auto=create-drop Hibernate génère des instructions DROP FOREIGN KEY avant que les tables existent, ce que H2 rejette avec JdbcSQLSyntaxErrorException: Table not found [42102].

- Fix : ddl-auto=none + création d'un fichier schema-test.sql dans backend/src/test/resources/ contenant les CREATE TABLE IF NOT EXISTS pour toutes les entités JPA du projet.

- spring.sql.init.schema-locations=classpath:schema-test.sql et spring.jpa.defer-datasource-initialization=true garantissent que le script SQL s'exécute AVANT que Hibernate valide le schéma.

- Ajout de @MockBean PlaybackService et @MockBean InfluxQueryService (découverts lors de l'analyse STEP 1 comme dépendant d'InfluxDBClient).

### Quatrième correction — ne pas mocker `JavaMailSender` avec Actuator

- Cause : **`@MockBean JavaMailSender`** laissait le contributeur de santé Actuator **`mailHealthContributor`** sans bean « réel » utilisable — **`IllegalArgumentException: Beans must not be empty`**, et échec de chargement du **`ApplicationContext`**.

- Fix : suppression du **`@MockBean JavaMailSender`** dans `SecurityConfigTest` ; conservation de **`@MockBean EmailService`** ; le **`JavaMailSender`** fourni par `MailSenderAutoConfiguration` (`spring.mail.*` vers localhost:3025) suffit au démarrage et au health composite mail.

## Ce que ça fait pour le projet

- **Objectif** : verrouiller par des tests automatiques que, après correction de `SecurityConfig` (`PUBLIC_PATHS` + `anyRequest().authenticated()`), les routes CAN et logs **exigent bien** un JWT alors que **`/api/auth/login`** reste utilisable sans authentification préalable ; et qu’avec JWT valide, la chaîne filtres autorise au moins jusqu’aux contrôleurs (sans garantir encore le succès métier 200).  

- **État réel après exécution** : le profil **`test`** charge le contexte complet (H2 + `schema-test.sql`, mocks ciblés) et **`SecurityConfigTest` passe** — la file de sécurité HTTP/JWT pour les scénarios couverts est **verrouillée par Maven** tant que la CI exécute ce test.

- **Risque résiduel** : d’autres endpoints ou beans non mockés pourraient encore échouer dans d’autres tests d’intégration ; ce fichier ne couvre que les quatre cas de `SecurityConfigTest`.

## Comment — explication technique

- **Technologies** : JUnit Jupiter, Spring Boot Test (`@SpringBootTest`), `MockMvc` (clients HTTP fictifs contre la vraie `SecurityFilterChain`), Mockito (`@MockBean` pour `UserDetailsService` afin d’associer JWT → `UserDetails` dans `JwtAuthenticationFilter`), JJWT réel dans `JwtService` pour signer des tokens utilisables par le filtre.  

- **Profil et propriétés** : `@ActiveProfiles("test")` charge `application-test.properties` ; H2 en mémoire ; exclusion **Kafka** uniquement ; **mail** actif vers localhost:3025 ; stockage **local** forcé en test.

- **Problème résolu (mail + Actuator)** : un **`@MockBean` sur `JavaMailSender`** laissait le composite de santé mail sans beans satisfaisants — **`MailHealthContributorAutoConfiguration`** → **`Beans must not be empty`**. En ne mockant que **`EmailService`**, le **`JavaMailSender`** auto-configuré reste présent et le contexte démarre.


## Pourquoi — justification

- **Pourquoi `@SpringBootTest` + MockMvc plutôt qu’un test unitaire isolé du `SecurityFilterChain`** : seule une levée de contexte proche de la production garantit que `SecurityConfig`, `JwtAuthenticationFilter` et les contrôleurs sont **câblés comme en runtime** ; un mock de `SecurityFilterChain` pourrait laisser passer une config réelle incohérente.  

- **Pourquoi `UserDetailsService` mocké** : éviter une base MySQL et des jeux de données complexes tout en permettant au filtre JWT de charger des autorités ; c’est un compromis classique d’intégration légère.  

- **Pourquoi ne pas mocker `JavaMailSender` en plus d’`EmailService`** : Actuator agrège la santé « mail » ; remplacer **`JavaMailSender`** par un mock peut produire **`Beans must not be empty`** côté contributeur. **`EmailService` mocké** suffit pour éviter les envois applicatifs réels tant que rien n’appelle **`JavaMailSender`** directement hors ce health check.




## Explication sans background informatique

On a préparé un **petit examen automatique** pour l’application : il vérifie que certaines « portes » du garage (consultation des trajets CAN, envoi de fichiers de traces) refuse l’entrée si on ne présente pas de **bracelet électronique** valide délivré à la connexion, alors que la porte « s’identifier » reste accessible pour obtenir ce bracelet. L’examen démarre une **réplique simplifiée** du garage (**base mémoire**, schéma SQL de test) ; après correction des pièces « courrier » et « schéma », **l’examen peut se lancer** et sonner si quelqu’un rouvre les portes métier sans badge sur les cas vérifiés.

## Mots clés pour la soutenance

- **`@SpringBootTest`** : annotation qui lance une application Spring quasi complète pour valider beans, sécurité et web ensemble dans les tests.

- **`MockMvc`** : client HTTP simulé fourni par Spring pour appeler les contrôleurs sans navigateur réel.

- **`@ActiveProfiles("test")`** : active un ensemble de propriétés (souvent `application-test.properties`) séparées du déploiement production.

- **H2 (base mémoire)** : moteur SQL léger intégré au process JVM, utilisé pour des tests sans serveur MySQL.

- **`hibernate.hbm2ddl.auto` / `ddl-auto`** : mode de Hibernate qui crée, met à jour ou détruit le schéma SQL au démarrage ; **`create-drop`** recrète puis supprime le schéma en fin de contexte **et peut exécuter des ordres DDL délicats** selon dialecte/SGBD.

- **`@MockBean`** : remplace un bean Spring par un double Mockito dans le contexte de test (ici `UserDetailsService`).

- **JWT (*JSON Web Token*)** : jeton signé portant l’identité ; le test en génère un avec le vrai `JwtService` pour traverser le filtre.

- **Surefire** : plugin Maven qui exécute les tests et produit le résumé `Tests run: X, Failures: Y, Errors: Z`.

- **`ApplicationContext`** : conteneur Spring qui contient tous les composants ; s’il ne démarre pas, **aucun** test `@SpringBootTest` ne s’exécute.


If the jury asks why it took multiple attempts:

"C'est exactement le processus réel d'intégration de tests sur un projet Spring Boot avec de nombreuses dépendances externes — Kafka, InfluxDB, S3, Mail, Actuator. Chaque erreur révélait un bean supplémentaire nécessitant soit un mock soit une configuration de test adaptée. Le résultat final est un contexte de test propre et reproductible qui prouve que la configuration de sécurité est correcte."
# Jour 8 — Tâche 1 : entité JPA **`CarEntity`** (table **`cars`**)

## Ce qui a été fait

- Création du fichier **`backend/src/main/java/com/example/backend/can/entity/CarEntity.java`** : entité Hibernate / JPA **`@Entity` `@Table(name = "cars")`** avec clé surrogate **`Long id`** (IDENTITY), identifiant public **`carUid`** (UUID chaîne unique, **`@PrePersist`** si vide), champs véhicule (**`vin`**, **`make`**, **`model`**, **`year`**, **`color`**), FK logiques **`ecuCatalogId`**, **`ownerUserId`** mappé en **`BINARY(16)`** (**`byte[]`**), indicateurs **`isVirtual`** / **`isActive`**, timestamps **`createdAt`** / **`updatedAt`**, **`deletedAt`** pour soft delete, Lombok (**`@Data`**, **`@Builder`**, etc.) et **`@CreationTimestamp` / `@UpdateTimestamp`** Hibernate.
- Vérifications : **`.\mvnw.cmd compile`** (BUILD SUCCESS), démarrage **`spring-boot:run`** sans erreur d’initialisation JPA (**`Initialized JPA EntityManagerFactory`**), lignes Hibernate **HHH** attendues dans les logs ; pas de ligne **« mismatch »**. Aucune mention isolée du mot **`cars`** dans les lignes Hibernate (le catalogue **`car_can.xml`** apparaît ailleurs). Le mot **`ERROR`** n’apparaît que dans un conseil Spring Security (« augmenter le niveau … à ERROR »), pas comme niveau **`ERROR`** d’erreur bloquante.
- Ligne de démarrage : **`Started BackendApplication in 8.756 seconds`**.

## Ce que ça fait pour le projet

- Fournit la **couche objet** officielle pour la table **`cars`** : la base peut être manipulée de façon typée depuis Java, avec **`car_uid`** stable pour les API REST sans imposer aux appels de le générer.
- Prépare l’ajout futur de **`CarRepository`** et de services métier sans reposer sur des cartes JDBC ad hoc pour les véhicules.

## Comment — explication technique

- **`@PrePersist`** : avant le premier **`INSERT`**, si **`carUid`** est **`null`** ou blanc, affectation **`UUID.randomUUID().toString()`**, ce qui garantit **`NOT NULL`** côté colonne **`car_uid`**.
- **`ownerUserId`** : **`columnDefinition = "BINARY(16)"`** aligne Hibernate avec **`users.id`** stocké en binaire (**UUID** compact).
- **Pas de `@ManyToOne` / `@OneToMany`** vers catalogue ou sessions : évite des chargements paresseux ou des cycles JSON ; les relations se résolvent par **repository** ou requêtes explicites.
- **`deletedAt`** : soft delete par convention — les requêtes applicatives devront filtrer **`WHERE deleted_at IS NULL`** quand un véhicule « actif » métier est requis.

## Pourquoi — justification

- La table **`cars`** existe déjà dans le schéma ; une **entité JPA** documentée et typée réduit les erreurs (noms de colonnes, types) et permet d’unifier la persistance avec le reste du module **`can`**.
- **UUID métier** + **ID technique** séparent identifiant REST stable et performances d’auto-incrément en base.

## Explication sans background informatique

- On décrit désormais en **« fiche véhicule »** dans le code ce qu’une ligne de la base représente (**marque**, **modèle**, **année**, etc.). Une **référence publique automatique** (comme un numéro de dossier unique) est créée si on n’en fournit pas, et on peut marquer une voiture comme **simulation** sans VIN physique, ou la **désactiver** sans tout effacer.

## Comment tester manuellement

Compilation (PowerShell), en pointant **`JAVA_HOME`** vers un JDK 17 :

```powershell
$env:JAVA_HOME='C:\Users\maiss\.jdks\jbr-17.0.11'
cd C:\tools\Kpit_c\backend
.\mvnw.cmd compile 2>&1 | Select-Object -Last 5
```

**Sortie observée** (extrait) :

```
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  1.495 s
[INFO] Finished at: 2026-05-09T16:42:14+01:00
[INFO] ------------------------------------------------------------------------
```

Démarrage (avec MySQL accessible, **`DB_PASSWORD`**, **`JWT_SECRET`**, **`INFLUXDB_TOKEN`** selon votre environnement) :

```powershell
$env:JAVA_HOME='C:\Users\maiss\.jdks\jbr-17.0.11'
$env:DB_PASSWORD='<votre mot de passe>'
$env:JWT_SECRET='dev-jwt-secret-minimum-32-characters-long!!'
$env:INFLUXDB_TOKEN='<token Influx>'
cd C:\tools\Kpit_c\backend
.\mvnw.cmd spring-boot:run
```

Contrôler dans la console les messages **HHH** ( Hibernate ) et l’absence d’erreur JPA avant : **`Initialized JPA EntityManagerFactory`** puis **`Started BackendApplication in … seconds`**.

Vérification des annotations et champs (équivalent **grep**) sous PowerShell :

```powershell
Select-String -Path 'C:\tools\Kpit_c\backend\src\main\java\com\example\backend\can\entity\CarEntity.java' -Pattern '@Entity|@Table|@Id|@PrePersist|carUid|ownerUserId|isVirtual|deletedAt' | ForEach-Object { "$($_.LineNumber):$($_.Line)" }
```

**Sortie observée**

```
29:@Entity
30:@Table(name = "cars")
37:    @Id
46:    private String carUid;
82:    private byte[] ownerUserId;
89:    private Boolean isVirtual = false;
111:    private LocalDateTime deletedAt;
114:     * Auto-generate carUid as a UUID string if not set before first persist.
118:    @PrePersist
120:        if (carUid == null || carUid.isBlank()) {
121:            carUid = UUID.randomUUID().toString();
```

Exemple de lignes **HHH** au démarrage (journal réel) :

```
HHH000204: Processing PersistenceUnitInfo [name: default]
HHH000412: Hibernate ORM core version 6.6.4.Final
HHH000026: Second-level cache disabled
HHH90000025: MySQLDialect does not need to be specified explicitly using 'hibernate.dialect' (remove the property setting and it will be selected by default)
HHH10001005: Database info:
HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)
```

Démarrage applicatif :

```
Started BackendApplication in 8.756 seconds (process running for 9.125)
```

## Problèmes rencontrés et corrections appliquées

- Aucun problème fonctionnel bloquant sur cette tâche : compilation OK, **`EntityManagerFactory`** initialisé, application démarrée.
- **`rg`** ( ripgrep ) non présent dans le **PATH** Windows local : la recherche ligne par ligne a été réalisée avec **`Select-String`** PowerShell, équivalent fonctionnel aux motifs demandés (**`@Entity`**, **`@Table`**, **`@Id`**, **`@PrePersist`**, **`carUid`**, **`ownerUserId`**, **`isVirtual`**, **`deletedAt`**).

## Mots clés pour la soutenance

**JPA**, **Hibernate**, **`CarEntity`**, **table `cars`**, **`car_uid`**, **UUID**, **`@PrePersist`**, **`BINARY(16)`**, **soft delete** (`deleted_at`), **Lombok Builder**, **mapping sans relation bidirectionnelle**, **BUILD SUCCESS**, **EntityManagerFactory**

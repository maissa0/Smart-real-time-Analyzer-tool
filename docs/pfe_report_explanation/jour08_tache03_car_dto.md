# Jour 8 — Tâche 3 : **`CarDto`**, **`CarCreateRequest`**, **`CarUpdateRequest`** (DTOs flotte véhicules)

## Ce qui a été fait

- Inventaire du dossier **`backend/src/main/java/com/example/backend/can/dto/`** : DTOs existants **`CanFrameResponse.java`**, **`CanSessionResponse.java`** — déclaration de package commune **`package com.example.backend.can.dto;`** (ligne 1 de chaque fichier).
- Ajout de **`CarDto.java`** : DTO de **réponse** avec Lombok **`@Data` / `@Builder`**, **`@JsonInclude(NON_NULL)`** pour omettre les champs calculés absents, champs alignés sur l’API publique (**`carUid`**, **`vin`**, **`make`**, **`model`**, **`year`**, **`color`**, **`isVirtual`**, **`isActive`**, **`createdAt`**) plus champs calculés documentés (**`sessionCount`**, **`lastSessionAt`**, **`totalFrames`**, **`faultRate`**) à remplir côté **`CarService`** (futur).
- Ajout de **`CarCreateRequest.java`** : DTO de **création** avec **`@NotBlank`** sur **`make`** / **`model`**, **`@Min` / `@Max`** sur **`year`** (1990–2030), **`@Pattern`** ISO 3779 simplifié sur **`vin`** (17 caractères sans I/O/Q), **`vin`** et **`color`** / **`isVirtual`** optionnels.
- Ajout de **`CarUpdateRequest.java`** : DTO de **mise à jour** type **PATCH** (tous les champs optionnels), mêmes contraintes **`@Pattern`** / **`@Min` / `@Max`** quand une valeur est envoyée, plus **`isActive`**.
- **Compilation Maven** : **BUILD SUCCESS**.

## Ce que ça fait pour le projet

- **Isole l’entité JPA** du contrat HTTP : les contrôleurs pourront exposer **`CarDto`** et accepter **`CarCreateRequest`** / **`CarUpdateRequest`** sans fuite de détails de persistance (**`id`** interne, **`owner_user_id`**, **`deleted_at`**, etc. restent côté service/entité).

- **Valide les entrées avant la couche métier** : VIN et année sont contrôlés dès la désérialisation JSON, ce qui limite les données invalides en base.

## Comment — explication technique

- **`JsonInclude.Include.NON_NULL`** sur **`CarDto`** : évite d’émettre des **`null`** pour les agrégats (**`sessionCount`**, **`faultRate`**, …) lorsqu’ils ne sont pas calculés.
- **Bean Validation (`jakarta.validation`)** sur les *requests* : déclenchée typiquement via **`@Valid`** sur les paramètres de contrôleur (à brancher lors de l’implémentation REST).
- **Regex VIN** : **`^[A-HJ-NPR-Z0-9]{17}$`** — alphabet sans **I**, **O**, **Q** comme dans la pratique courante ISO 3779 pour la lisibilité.

## Pourquoi — justification

- **Création** et **mise à jour** ont des règles différentes : à la création, **`make` / `model` / `year`** sont obligatoires ; à la mise à jour, tout est facultatif (**sémantique PATCH**).

- Séparer **`CarDto`** des requêtes évite que le client puisse modifier des champs **système** (timestamps, identifiants) en les réutilisant par erreur pour l’entrée et la sortie.

## Explication sans background informatique

- On définit trois **« formulaires »** décrivant une voiture : un pour **afficher** les infos (+ statistiques possibles sans les montrer si on ne les calcule pas), un pour **enregistrer** une nouvelle voiture avec des **champs obligatoires et des règles** sur le numéro de chassis, et un pour **modifier seulement** ce qu’on envoie, sans tout renvoyer.

## Comment tester manuellement

Compilation :

```powershell
$env:JAVA_HOME='C:\Users\maiss\.jdks\jbr-17.0.11'
cd C:\tools\Kpit_c\backend
.\mvnw.cmd compile 2>&1 | Select-Object -Last 5
```

**Sortie observée**

```
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  6.043 s
[INFO] Finished at: 2026-05-09T16:54:53+01:00
[INFO] ------------------------------------------------------------------------
```

Liste des fichiers du dossier DTO :

```powershell
cd C:\tools\Kpit_c
Get-ChildItem backend/src/main/java/com/example/backend/can/dto/ |
  Select-Object Name
```

Avec **`Format-Table`** (pour forcer l’affichage texte dans certains environnements) :

```powershell
Get-ChildItem backend/src/main/java/com/example/backend/can/dto/ | Select-Object Name | Format-Table -AutoSize | Out-String
```

**Sortie observée**

```
Name                   
----                   
CanFrameResponse.java  
CanSessionResponse.java
CarCreateRequest.java  
CarDto.java            
CarUpdateRequest.java
```

## Problèmes rencontrés et corrections appliquées

- Aucun problème bloquant : le package **`com.example.backend.can.dto`** existait déjà ; la compilation confirme les imports (**`jackson`**, **`lombok`**, **`jakarta.validation`**) disponibles dans le projet.
- La commande **`Get-ChildItem … | Select-Object Name`** seule peut ne rien imprimer selon la configuration PowerShell ; **`Format-Table`** / **`Out-String`** permet de capturer la liste des fichiers clairement.

## Mots clés pour la soutenance

**DTO**, **`CarDto`**, **`CarCreateRequest`**, **`CarUpdateRequest`**, **Bean Validation**, **VIN ISO 3779**, **`@Pattern`**, **`@JsonInclude(NON_NULL)`**, **PATCH sémantique**, **séparation entité / API**, **BUILD SUCCESS**

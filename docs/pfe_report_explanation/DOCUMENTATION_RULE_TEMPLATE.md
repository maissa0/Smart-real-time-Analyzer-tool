# Règle de documentation PFE — template obligatoire

**À appliquer après chaque tâche documentée — aucune exception.**

---

## Nom de fichier et emplacement

- **Chemin :** `C:/tools/Kpit_c/docs/pfe_report_explanation/<FILENAME>.md`
- **Format du nom :** `jourXX_tacheYY_<task_name>.md`  
  *(exemples : `jour03_tache01_angular_jwt_interceptor.md`, `jour02_tache02_security_tests.md`)*

Si le dossier `docs/pfe_report_explanation/` n’existe pas, le **créer**.  
Si le dossier `docs/pfe_report_explanation/screenshots/` n’existe pas, le **créer**.

Si le fichier **existe déjà** pour cette tâche : **mettre à jour ce fichier** — ne **pas** créer de doublon.

---

## Ordre exact des sections (toutes obligatoires)

```text
# <Task Title>

## Ce qui a été fait
## Ce que ça fait pour le projet
## Comment — explication technique
## Pourquoi — justification
## Explication sans background informatique
## Comment tester manuellement
## Problèmes rencontrés et corrections appliquées
## Mots clés pour la soutenance
```

La **dernière étape de chaque tâche** doit être cette documentation (création ou mise à jour du `.md`).

---

## `## Comment tester manuellement` — contenu obligatoire

La section doit inclure :

- soit les **requêtes Postman exactes** (méthode, URL, headers, corps JSON),
- soit les **étapes DevTools / navigateur** détaillées ;
- pour chaque scénario : **codes HTTP attendus**, résultat **réussi** vs **échouant** ;
- des **chemins de captures d’écran** sous :

  `docs/pfe_report_explanation/screenshots/jourXX_tacheYY_<desc>.png`

  *(réutiliser le même `jourXX_tacheYY` que dans le nom du fichier `.md`, avec un `<desc>` court pour chaque image).*

---

## `## Problèmes rencontrés et corrections appliquées` — contenu obligatoire

Cette section documente :

- **chaque erreur**, comportement imprévu ou **décision de conception** rencontrée pendant la tâche ;
- **la cause**, **comment cela a été diagnostiqué** ;
- **exactement ce qui a été changé** pour corriger ;

Si aucun problème n’a été rencontré, une **seule** puce :

- `Aucun problème — implémentation correcte du premier coup.`

---

*Ce fichier fait foi pour les futures tâches ; les agents et contributeurs doivent s’y conformer.*

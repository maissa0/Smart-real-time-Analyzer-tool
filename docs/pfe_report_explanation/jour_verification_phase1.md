# Vérification Phase 1 — Système complet

## Résultats du checklist

| Vérification | Résultat | Notes |
|---|---|---|
| Docker kafka + influxdb healthy | ✅ | 3 consumers connectés au démarrage |
| Spring Boot démarrage sans erreur Hibernate | ✅ | 10.8 secondes, zero erreur |
| 13 repositories JPA détectés | ✅ | CarRepository inclus |
| signals column = json | ✅ | Converti par V1 |
| direction column = enum('Rx','Tx','Unknown') | ✅ | Appliqué manuellement après constat |
| raw_bytes column = varchar(30) | ✅ | Converti par V1 |
| can_sessions: 88 sessions | ✅ | Inchangé depuis backup |
| can_sessions: 0 null car_id | ✅ | V3 a assigné toutes les sessions |
| Direction values valides (Rx/Tx uniquement) | ✅ | 371616 Rx + 238 Tx |
| Kafka consumers connectés | ✅ | decoded-signals, session-meta, log-file-events |
| Catalogs CAN chargés | ✅ | 73 signaux, 2 messages cycliques |
| DataInitializer ran | ✅ | admin + user accounts initialisés |

## Problèmes identifiés et corrections appliquées

### Problème 1 — direction encore varchar(255) en production
- **Cause** : V1 avait bien converti `direction` sur `smart_analyser_test`
  mais la colonne de production restait `varchar(255)`.
- **Diagnostic** : `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_NAME = 'can_frames' AND COLUMN_NAME = 'direction'`
  → varchar(255) au lieu de enum('Rx','Tx','Unknown').
- **Vérification préalable** : `SELECT COUNT(*) FROM can_frames
  WHERE direction NOT IN ('Rx','Tx','Unknown')` → 0 (aucune valeur invalide).
- **Correction** : `ALTER TABLE can_frames MODIFY COLUMN direction
  ENUM('Rx','Tx','Unknown') DEFAULT 'Unknown'` appliqué directement
  sur `smart_real_time_analyser` — exit 0, sans erreur.
- **Vérification post** : COLUMN_TYPE = enum('Rx','Tx','Unknown') ✅

### Problème 2 — Port 8080 déjà utilisé au redémarrage
- **Cause** : processus Spring Boot précédent (PID 24620) encore actif.
- **Correction** : arrêt du processus, relance → Started in 10.8 secondes.

### Problème 3 — ClassCastException dans CarService.populateStats()
- **Cause** : JPQL aggregate retourne `List<Object[]>` — le code traitait
  le résultat comme `Object[]` directement → ClassCastException.
- **Correction** : changement du type de retour de `getCarSessionStats()`
  en `List<Object[]>`, utilisation de `results.get(0)` pour la première ligne.
  Commit : `673f4282`.

## Warnings non bloquants

| Warning | Explication | Action |
|---|---|---|
| `HHH90000025: MySQLDialect does not need to be specified` | Hibernate 6.6 auto-détecte MySQL | Optionnel: supprimer la propriété |
| `MailHealthIndicator took 11481ms` | Actuator tente de contacter Mailtrap localhost:3025 | Attendu en dev |
| `spring.jpa.open-in-view is enabled` | Warning standard Spring Boot | Optionnel: ajouter `spring.jpa.open-in-view=false` |

## Conclusion

Phase 1 complète — schéma migré (V1→V4), entité Car opérationnelle,
pipeline CAN existant inchangé, Spring Boot démarre proprement.

Prochain sprint : détection d'anomalies IA/ML (IsolationForest, RandomForest,
Z-score) + interface Angular Vehicle Fleet complète.

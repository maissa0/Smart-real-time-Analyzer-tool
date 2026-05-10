# Chapitre 7 — Couche Python : Simulateur et Pipeline de traitement

## 7.1 Architecture de la couche Python

La couche Python du projet KPIT Smart Real-Time CAN Analyser comprend
trois composants principaux :

| Composant | Fichier | Rôle |
|---|---|---|
| Simulateur CAN | `can_simulator.py` | Génère des trames CAN synthétiques et les publie sur Kafka |
| Pipeline de décodage | `pipeline.py` | Consomme les trames brutes, décode les signaux via les catalogues XML |
| Parseur de logs | `log_parser.py` | Parse les fichiers de logs CAN au format texte |

Tous les composants communiquent via **Apache Kafka** (topics `raw-can-frames`,
`decoded-signals`, `session-meta`) — aucune dépendance directe entre eux.

---

## 7.2 Simulateur CAN — can_simulator.py

### 7.2.1 Modes de fonctionnement

Le simulateur supporte deux modes :

**Mode Random** — génère des trames CAN synthétiques en continu à partir
des définitions du catalogue XML. Chaque message est émis à sa fréquence
de bus (ex. `Powertrain_CAN` : 500ms, `Car_CAN` : 2s). Les valeurs de
signaux varient aléatoirement dans les plages valides définies par le
catalogue.

**Mode Replay** — rejoue un fichier de log CAN existant en respectant
les timestamps originaux. La vitesse de lecture est contrôlable via
`--speed` (0.5x à 5x).

### 7.2.2 Liaison véhicule — --car-uid

Depuis le jour 17, le simulateur accepte l'argument `--car-uid` qui lie
la session créée à un véhicule de la flotte :

```python
# session-meta Kafka message inclut car_uid si fourni
if getattr(self.args, 'car_uid', None):
    meta["car_uid"] = self.args.car_uid
```

Côté backend, `CanSessionService.saveSession()` résout le `car_uid` en
`car_id` via `CarRepository.findByCarUid()` et persiste la liaison en base.
La session apparaît automatiquement dans l'historique du véhicule sans
action manuelle.

### 7.2.3 Injection de fautes

Le simulateur peut injecter trois types de fautes contrôlables :

| Faute | Flag | Effet |
|---|---|---|
| Value errors | `--inject-value-errors` | Corrompt une valeur de signal (raw_value=99, label="INJECTED_ERROR") |
| Timing gaps | `--inject-timing-gaps` | Supprime l'émission de trames pendant 16–20 secondes |
| Counter errors | `--inject-counter-errors` | Saute des numéros de séquence de frames |

Le taux de fautes est configurable via `--fault-rate` (défaut : 5%).

---

## 7.3 Fix critique — Timing gap non-bloquant

### 7.3.1 Problème original

L'implémentation initiale de `inject_timing_gap()` utilisait un appel
bloquant `time.sleep(16-20)` dans la boucle principale de simulation :

```python
# AVANT — bloquant (problématique)
def inject_timing_gap(self):
    gap = random.uniform(16.0, 20.0)
    time.sleep(gap)  # bloque le thread entier pendant 16-20 secondes
```

Cet appel bloquant causait trois problèmes majeurs :

1. **Aucune trame envoyée** pendant 16-20 secondes — le thread principal
   était suspendu, Kafka ne recevait rien.
2. **Impossible d'arrêter le simulateur** pendant le gap — `SIGTERM` n'était
   pas traité car le thread était bloqué dans `sleep`.
3. **Pas de flush Kafka** — les messages en attente dans le buffer Kafka
   n'étaient pas envoyés pendant la durée du sleep.

### 7.3.2 Solution — Flag temporel non-bloquant

L'implémentation initiale a été remplacée par un mécanisme de flag
temporel vérifié à chaque itération de la boucle :

```python
# APRÈS — non-bloquant
def trigger_timing_gap(self) -> None:
    gap = random.uniform(16.0, 20.0)
    self.gap_active_until = time.time() + gap  # timestamp futur
    self.fault_stats["timing_gaps"] += 1
    print(f"  [FAULT] Timing gap triggered: {gap:.1f}s suppression window started")
```

La boucle principale vérifie ce flag au début de chaque itération :

```python
while True:
    now = time.time()

    # Vérification non-bloquante du gap
    if now < self.gap_active_until:
        time.sleep(0.001)  # cède 1ms — thread reste réactif
        continue           # aucune trame émise pendant le gap

    # ... émission normale des trames
```

### 7.3.3 Comparaison avant / après

| Critère | Avant (`time.sleep`) | Après (flag temporel) |
|---|---|---|
| Blocage du thread | 16-20 secondes | 1ms par itération |
| Arrêt pendant le gap | Impossible | Immédiat (`SIGTERM` traité) |
| Flush Kafka pendant gap | Non | Oui |
| Comportement observable | Identique — absence de trames 16-20s | Identique |
| Complexité | O(1) sleep | O(1) check par itération |

### 7.3.4 Compatibilité replay

La méthode bloquante `inject_timing_gap()` est conservée pour le mode
replay où le timing exact doit être respecté. Le mode random utilise
exclusivement `trigger_timing_gap()`.

---

## 7.4 Architecture Kafka du simulateur
can_simulator.py
│
├── topic: session-meta      ← métadonnées session (sessionId, carUid, timestamps)
│
└── topic: raw-can-frames    ← trames CAN brutes (msgId, rawBytes, signals JSON)
│
└── pipeline.py (décodeur)
│
└── topic: decoded-signals  ← signaux décodés avec valeurs physiques

Le simulateur utilise `confluent_kafka.Producer` avec :
- `linger.ms: 1` — latence minimale pour les tests temps réel
- `compression.type: lz4` — compression légère pour réduire la bande passante

---

## 7.5 Points clés pour la soutenance

- **Non-blocking I/O** : le timing gap utilise un flag temporel au lieu
  de `time.sleep()` — le thread reste réactif aux signaux système
- **Liaison véhicule** : `--car-uid` → Kafka → `CanSessionService` →
  `car_id` en base — traçabilité complète de la session au véhicule
- **Injection de fautes contrôlée** : trois types de fautes, taux
  configurable, détectées par `IntegrityAnalyzerService` côté backend
- **Mode dual** : replay pour les tests avec données réelles, random pour
  les démos en continu

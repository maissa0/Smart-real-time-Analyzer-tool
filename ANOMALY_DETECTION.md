# Anomaly Detection Engine — Complete Implementation Guide

> **Status:** Planning / Not started  
> **Owner:** You  
> **Prerequisite reading:** `context/progress-tracker.md` — Architecture Decisions section  
> **Do NOT code anything until you have finished Phase 0 and Phase 1.** The ML model is only as
> good as the features you feed it. Read the data first.

---

## Table of Contents

1. [What We're Building and Why](#1-what-were-building-and-why)
2. [Architecture Overview](#2-architecture-overview)
3. [Domain Knowledge — What Does a CAN Anomaly Look Like](#3-domain-knowledge)
4. [Data Inventory — What We Already Have](#4-data-inventory)
5. [ML Design Decisions](#5-ml-design-decisions)
6. [New Project Layout](#6-new-project-layout)
7. [Phase 0 — Exploratory Data Analysis](#7-phase-0--exploratory-data-analysis)
8. [Phase 1 — Dataset Export and Preparation](#8-phase-1--dataset-export-and-preparation)
9. [Phase 2 — Feature Engineering](#9-phase-2--feature-engineering)
10. [Phase 3 — Model Candidates](#10-phase-3--model-candidates)
11. [Phase 4 — Training Pipeline](#11-phase-4--training-pipeline)
12. [Phase 5 — Evaluation and Benchmarking](#12-phase-5--evaluation-and-benchmarking)
13. [Phase 6 — Model Selection](#13-phase-6--model-selection)
14. [Phase 7 — Online Inference (Kafka Consumer)](#14-phase-7--online-inference-kafka-consumer)
15. [Phase 8 — Spring Boot Integration](#15-phase-8--spring-boot-integration)
16. [Phase 9 — Angular Integration](#16-phase-9--angular-integration)
17. [MLOps — Retraining, Versioning, Monitoring](#17-mlops)
18. [Testing Strategy](#18-testing-strategy)
19. [Implementation Checklist](#19-implementation-checklist)

---

## 1. What We're Building and Why

### The Problem with Rule-Based Detection

`IntegrityAnalyzerService.java` already flags structural faults — missing signals, out-of-range
individual values, timing violations. That is **integrity checking**: verifying the CAN bus
behaves according to the catalog specification.

Anomaly detection is a fundamentally different problem. Consider:

- `EngineSpeed = 1200 rpm` — perfectly valid on its own.
- `BrakePressure = 85 bar` — perfectly valid on its own.
- **Both simultaneously**, sustained for 30 seconds while the vehicle is stationary — deeply
  abnormal. No catalog rule catches this because both signals are within their defined ranges.

This is what ML-based anomaly detection solves. A model trained on hundreds of real sessions
learns the **joint distribution** of signals over time — the co-occurrence patterns, the
temporal rhythms, the correlations. It flags frames that are individually valid but collectively
anomalous: statistically improbable given everything the model has seen.

### Business Value

| Detection Type | Tool | Catches |
|---|---|---|
| Out-of-range values | IntegrityAnalyzerService | `Speed > 300 km/h` |
| Missing expected messages | IntegrityAnalyzerService | `ABS_STATUS not seen in 200ms` |
| Unusual joint signal patterns | **Anomaly Engine (this)** | Normally-correlated signals diverge |
| Temporal rhythm breaks | **Anomaly Engine (this)** | Message appears 10x faster than normal |
| Novel attack signatures | **Anomaly Engine (this)** | Injection of well-formed but contextually impossible frames |

---

## 2. Architecture Overview

```
                 ┌──────────────────────────────────────────────────────────┐
                 │  python_parser/                                           │
                 │                                                           │
  .log / live ──►│  file_worker.py / can_simulator.py                        │
                 │          │                                               │
                 │          ▼ Kafka: decoded-signals                        │
                 │  ┌───────────────────────┐                               │
                 │  │  anomaly_engine/       │  ← NEW (separate process)    │
                 │  │  detector.py           │                               │
                 │  │   ├── loads model.pkl  │                               │
                 │  │   ├── builds features  │                               │
                 │  │   └── scores frames    │                               │
                 │  └────────┬──────────────┘                               │
                 │           │ Kafka: anomaly-events                        │
                 └───────────┼──────────────────────────────────────────────┘
                             │
                             ▼
                 ┌─────────────────────────────────┐
                 │  Spring Boot backend             │
                 │                                  │
                 │  AnomalyEventConsumer.java   ◄───┘
                 │          │
                 │          ├── MySQL: anomaly_events table
                 │          └── WS: /topic/anomaly-events/{sessionId}
                 │                                  │
                 │  AnomalyController.java          │
                 │  GET /api/can/sessions/{id}/      │
                 │       anomaly-events             │
                 └──────────────────────────────────┘
                             │
                             ▼
                 ┌─────────────────────────────────┐
                 │  Angular Frontend                │
                 │  Anomaly filter in sniffer       │
                 │  Anomaly timeline in charts tab  │
                 └─────────────────────────────────┘
```

The detector runs in its own process with its own Kafka consumer group
(`anomaly-engine-group`). This is the same isolation pattern already used by the existing
pipeline — decoding never blocks anomaly scoring, and anomaly scoring never blocks frame
persistence. See Architecture Decision #4 in `context/progress-tracker.md`.

---

## 3. Domain Knowledge

Before writing a single line of ML code, understand what CAN anomalies actually look like in
your domain. There are four classes:

### Class A — Value Anomalies (contextual)
A value is within its catalog range but wrong given the current vehicle state.
- Engine RPM = 5000 while gear = Park and ignition off
- Battery voltage = 13.8V while charging circuit is disabled

### Class B — Temporal Anomalies (frequency / rhythm)
A message arrives too fast, too slow, or in bursts inconsistent with historical patterns.
- `WheelSpeed_FL` normally arrives at 10 Hz; suddenly arriving at 100 Hz
- `AIRBAG_STATUS` missing for 500ms when it normally arrives every 20ms

### Class C — Correlation Anomalies (joint distribution)
Two or more signals that historically move together start diverging.
- `AccelPedal` and `ThrottlePosition` normally have near-perfect correlation; they diverge
- Left and right wheel speeds differ by 40% on a straight road

### Class D — Sequence Anomalies (order)
A message appears in the wrong context — valid value, valid frequency, wrong time.
- `GearPosition = 5` seen before the vehicle has reached 15 km/h
- `DOOR_LOCK = UNLOCKED` toggled 8 times in 2 seconds

Your feature engineering in Phase 2 must capture all four of these classes.

---

## 4. Data Inventory

### Public Training Datasets

You have no labeled in-house dataset yet, so you train on public CAN bus datasets first.
This is actually better than using your own sessions — public datasets come with **real
labeled attack traffic**, so you get genuine AUC-ROC scores instead of relying on synthetic
injection.

| Dataset | Source | Format | Best for | Label column |
|---|---|---|---|---|
| **SynCAN** ⭐ | `github.com/etas/SynCAN` | CSV, signal-level | Signal-value + correlation anomalies | `label` (0=normal, 1=attack) |
| **Car-Hacking** | `ocslab.hksyst.com/Datasets/car-hacking-dataset` | CSV, raw bytes | Timing/burst anomalies (DoS, Fuzzy) | `Flag` (R=normal, T=attack) |
| **ROAD** | `github.com/ORNL/ROAD-dataset` | CSV, raw bytes | Realistic fabrication attacks | `label` column |

**Start with SynCAN** — it is already at the decoded signal level, which matches your
feature pipeline exactly. The Car-Hacking dataset works at the raw byte / CAN ID level
(useful for timing anomalies but needs adaptation for signal-level features).

Download strategy:
```bash
mkdir -p python_parser/anomaly_engine/data/public
cd python_parser/anomaly_engine/data/public
git clone https://github.com/etas/SynCAN syncan
# Car-Hacking: download ZIP from ocslab.hksyst.com → extract here as car_hacking/
```

### What You Have in Production (used later for live inference)

| Store | Measurement / Table | Key Fields |
|---|---|---|
| InfluxDB `ecu_telemetry` | `can_signals` | `session_id`, `signal_name`, `value`, `_time` |
| MySQL | `can_sessions` | `session_id`, `start_ts`, `end_ts`, `frame_count`, `status` |
| MySQL | `integrity_faults` | `session_id`, `msg_id`, `fault_type` |
| `catalogues/*.xml` | XML | Message → Signal → Range definitions |

### What You Will Create

| Store | What | Purpose |
|---|---|---|
| `anomaly_engine/data/public/` | Downloaded datasets | Training source, gitignored |
| `anomaly_engine/data/raw/` | Normalised Parquet per session | Unified format for all loaders |
| `anomaly_engine/data/features/` | Parquet feature matrices | Reusable across model runs |
| `anomaly_engine/models/` | `.joblib` + metadata JSON | Versioned model artifacts |
| MySQL `anomaly_events` | `session_id`, `frame_timestamp`, `score`, `top_signals` | Inference output for API |

---

## 5. ML Design Decisions

### 5.1 Supervised vs Unsupervised

**Decision: Unsupervised training, supervised evaluation.**

- **Training:** All model candidates (four core + optional LSTM) are trained on the
  **normal (label=0) rows only** from the public dataset. No attack samples are seen during
  training. This is the unsupervised / one-class learning approach: the model learns what
  "normal" looks like, and anything that deviates is anomalous.
- **Evaluation:** Because the public datasets include real labeled attacks (`label=1`), you
  evaluate with genuine AUC-ROC — no synthetic injection needed. This gives you a real,
  honest comparison between all model candidates.
- **Production:** Once deployed against your live InfluxDB sessions, the model runs in
  fully unsupervised mode — it scores every frame against the learned normal distribution.

This two-phase approach (unsupervised train → labeled eval → unsupervised production) gives
you the best of both worlds: no need for labeled training data, but still a rigorous model
comparison before choosing a winner.

### 5.2 Online (Stream) vs Offline (Batch)

**Decision: Offline training, Online inference.**

- **Training** runs offline on the downloaded public dataset. Once you have your own sessions
  you can retrain on those too (see Phase 17 — MLOps). Produces `.joblib` artifact files.
- **Inference** runs online: the `detector.py` process consumes `decoded-signals` from Kafka
  in real time, applies the loaded model, and publishes scored events to `anomaly-events`.

This matches how the existing pipeline works (Python script processes stream).

### 5.3 Per-Signal vs Per-Frame

**Decision: Per-signal features, aggregated at frame level.**

A CAN frame contains multiple signals. We extract features for each signal within a sliding
window, then aggregate across all signals in the frame to produce a single anomaly score per
frame. This lets the model detect correlation anomalies (signal A and B diverge) as well as
value anomalies (signal A alone is suspicious).

### 5.4 Feature Window Size

**Decision: Configurable via `config.yaml`, default W=20 frames.**

A window of the last 20 frames per `(session_id, msg_id)` pair captures ~0.3s of temporal
context at 60Hz. Adjust based on EDA findings in Phase 0.

### 5.5 Model Dimensionality

Because each CAN message has a different number of signals (1-12 in your catalogs), you
build one model **per message type** (`msg_id`). This avoids the curse of dimensionality and
makes each model small and fast. A session with 15 distinct message types has 15 models —
each focused on one message's "normal" behavior.

---

## 6. New Project Layout

```
python_parser/
│
├── anomaly_engine/                    ← NEW MODULE
│   ├── __init__.py
│   ├── config.yaml                    ← all tunable parameters
│   │
│   ├── data/
│   │   ├── __init__.py
│   │   ├── syncan_loader.py           ← loads SynCAN CSV → normalised Parquet
│   │   ├── car_hacking_loader.py      ← loads Car-Hacking CSV → normalised Parquet
│   │   ├── influx_exporter.py         ← (Phase 17) pulls your live sessions from InfluxDB
│   │   └── preprocessor.py            ← cleans, validates, normalises raw data
│   │
│   ├── features/
│   │   ├── __init__.py
│   │   ├── signal_features.py         ← per-signal rolling statistics
│   │   ├── message_features.py        ← inter-arrival, frequency, payload
│   │   └── feature_matrix.py         ← assembles final feature DataFrame
│   │
│   ├── training/
│   │   ├── __init__.py
│   │   ├── trainer.py                 ← trains all 5 model candidates per msg_id
│   │   ├── evaluator.py               ← real-label AUC-ROC + latency benchmark
│   │   └── model_selector.py          ← compares all candidates, saves best per msg_id
│   │
│   ├── models/                        ← runtime artifacts (gitignored)
│   │   └── .gitkeep
│   │
│   ├── inference/
│   │   ├── __init__.py
│   │   ├── window_buffer.py           ← maintains per-(session, msg_id) ring buffer
│   │   └── scorer.py                  ← loads model, scores incoming frame
│   │
│   ├── detector.py                    ← entrypoint: Kafka consumer + scorer + publisher
│   ├── train.py                       ← entrypoint: offline training pipeline
│   └── tests/
│       ├── test_feature_engineering.py
│       ├── test_scorer.py
│       └── test_detector_integration.py
│
├── anomaly_engine/data/raw/           ← gitignored Parquet exports
└── anomaly_engine/data/features/     ← gitignored feature matrices
```

Add to `python_parser/.gitignore`:
```
anomaly_engine/data/public/
anomaly_engine/data/raw/
anomaly_engine/data/features/
anomaly_engine/models/*.joblib
anomaly_engine/models/*.json
anomaly_engine/models/*.pkl
```

### 6.1 `config.yaml` — All Tunable Parameters

```yaml
# anomaly_engine/config.yaml
window:
  size: 20                   # rolling window length (frames)

training:
  contamination: auto        # IsolationForest / LOF contamination setting
  ocsvm_max_samples: 50000   # downsample OCSVM training if dataset exceeds this
  pca_variance: 0.95         # variance to retain for PCA (n_components=0.95)
  random_seed: 42

evaluation:
  threshold: 0.85            # decision threshold for precision/recall metrics
  min_auc: 0.70              # reject a model if AUC falls below this
  max_latency_us: 200.0      # reject a model if inference > this µs/frame

selection:
  weights:
    auc: 0.40
    precision: 0.20
    latency: 0.30
    recall: 0.10

inference:
  score_topic: anomaly-events
  consumer_group: anomaly-engine-group
  anomaly_threshold: 0.7     # frames with score > this are published as events
```

---

## 7. Phase 0 — Exploratory Data Analysis

**Do this before anything else.** Run this notebook on the downloaded SynCAN dataset.
Every feature engineering and window-size decision in Phases 1–6 depends on this.

### 7.1 Setup

```bash
cd python_parser
pip install jupyterlab pandas matplotlib seaborn scipy
jupyter lab
```

### 7.2 Load SynCAN

SynCAN ships as multiple CSVs: one per scenario (e.g. `ambient_dyno_drive_basic_long.csv`).
Each file has columns: `Time`, `Label`, then one column per signal.

```python
import pandas as pd
from pathlib import Path

syncan_dir = Path("anomaly_engine/data/public/syncan/")

# Load one scenario to start
df_raw = pd.read_csv(syncan_dir / "ambient_dyno_drive_basic_long.csv")
print(df_raw.head())
print(df_raw.shape)
print(f"Normal rows: {(df_raw['Label'] == 0).sum()}")
print(f"Attack rows: {(df_raw['Label'] == 1).sum()}")
```

Melt from wide (one col per signal) to long (one row per signal reading):
```python
signal_cols = [c for c in df_raw.columns if c not in ("Time", "Label")]
df = df_raw.melt(id_vars=["Time", "Label"], value_vars=signal_cols,
                 var_name="signal_name", value_name="value")
df = df.rename(columns={"Time": "timestamp"})
df["timestamp"] = pd.to_datetime(df["timestamp"], unit="s")
df_normal = df[df["Label"] == 0].copy()
```

### 7.3 Questions to Answer

**Q1: How many signals are there? What are their value ranges?**
```python
df_normal.groupby("signal_name")["value"].describe().round(3)
```

**Q2: What is the inter-arrival time distribution per signal?**
```python
import matplotlib.pyplot as plt
for sig, grp in df_normal.groupby("signal_name"):
    ia = grp["timestamp"].diff().dt.total_seconds() * 1000  # ms
    print(f"{sig}: mean={ia.mean():.1f}ms  std={ia.std():.2f}ms")
```
This tells you the nominal period per signal → sets the window size W.

**Q3: Which signal pairs are highly correlated?**
```python
import seaborn as sns
pivot = df_normal.pivot_table(index="timestamp", columns="signal_name", values="value")
sns.heatmap(pivot.corr(), annot=True, fmt=".2f", cmap="RdBu_r")
plt.title("Signal correlation — normal data only")
```
High correlation pairs (r > 0.85) are your best candidates for catching correlation
anomalies with PCA and LSTM.

**Q4: What do the attack rows look like?**
```python
df_attack = df[df["Label"] == 1]
df_attack.groupby("signal_name")["value"].describe().round(3)
# Compare to normal ranges — which signals deviate most?
```

**Q5: What is the attack class distribution?**
```python
# SynCAN has 5 attack types encoded in separate scenario files:
# plateau, continuous_change, playback, suppress, flooding
# Check each file's Label column
for f in sorted(syncan_dir.glob("*.csv")):
    tmp = pd.read_csv(f, usecols=["Label"])
    print(f"{f.name}: {tmp['Label'].value_counts().to_dict()}")
```

### 7.4 EDA Outputs — Write to `anomaly_engine/eda_notes.md`

- [ ] List of signal names and their normal value ranges
- [ ] Nominal inter-arrival time per signal (ms) → use this to set window W
- [ ] High-correlation signal pairs (r > 0.85)
- [ ] Which attack types create the clearest signal-level deviation
- [ ] Chosen window size W (default 20 — adjust if nominal period > 200ms)

---

## 8. Phase 1 — Dataset Loading and Preparation

The goal of this phase is to produce a **unified Parquet format** regardless of the data
source. Every downstream step (features, training, evaluation) reads only from this format.

### Unified schema

Every Parquet file in `anomaly_engine/data/raw/` must have these columns:

| Column | Type | Notes |
|---|---|---|
| `timestamp` | datetime64[ns, UTC] | Frame/sample time |
| `session_id` | str | Unique per file/scenario |
| `msg_id` | str | CAN message ID (e.g. `"0x170"`) or signal group |
| `signal_name` | str | Decoded signal name |
| `value` | float64 | Decoded signal value |
| `label` | int | `0` = normal, `1` = attack/anomaly |

The `label` column is **only used in Phase 5 evaluation** — never seen during training.

---

### 8.1 `data/syncan_loader.py`

SynCAN ships as wide CSVs: one column per signal, one row per time step.

```python
"""
syncan_loader.py
Loads SynCAN scenario CSVs → unified Parquet files.

Usage:
    python -m anomaly_engine.data.syncan_loader \
        --input  anomaly_engine/data/public/syncan/ \
        --output anomaly_engine/data/raw/
"""
import argparse
from pathlib import Path
import pandas as pd


def load_syncan_file(csv_path: Path, output_dir: Path) -> None:
    out_path = output_dir / f"syncan_{csv_path.stem}.parquet"
    if out_path.exists():
        print(f"  SKIP {csv_path.name}")
        return

    df_wide = pd.read_csv(csv_path)
    signal_cols = [c for c in df_wide.columns if c not in ("Time", "Label")]

    # Wide → long: one row per (timestamp, signal)
    df = df_wide.melt(
        id_vars=["Time", "Label"],
        value_vars=signal_cols,
        var_name="signal_name",
        value_name="value",
    )
    df = df.rename(columns={"Time": "timestamp", "Label": "label"})
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["value"])

    # SynCAN groups signals by scenario file — use filename as msg_id proxy
    df["msg_id"]     = csv_path.stem
    df["session_id"] = f"syncan_{csv_path.stem}"
    df["label"]      = df["label"].astype(int)

    df = df[["timestamp", "session_id", "msg_id", "signal_name", "value", "label"]]
    df = df.sort_values("timestamp").reset_index(drop=True)
    df.to_parquet(out_path, index=False, compression="snappy")
    print(f"  {csv_path.name}: {len(df):,} rows "
          f"(normal={( df['label']==0).sum():,}  attack={(df['label']==1).sum():,})"
          f" → {out_path.name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",  default="anomaly_engine/data/public/syncan/")
    parser.add_argument("--output", default="anomaly_engine/data/raw/")
    args = parser.parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    for csv_path in sorted(Path(args.input).glob("*.csv")):
        load_syncan_file(csv_path, output_dir)


if __name__ == "__main__":
    main()
```

> **Production gap — msg_id mismatch:** SynCAN uses the scenario filename as `msg_id`
> (e.g. `"ambient_dyno_drive_basic_long"`). Your live CAN bus uses numeric IDs
> (e.g. `"0x170"`). Models trained on SynCAN **will not match** incoming live frames
> because no registry entry exists for the live msg_id names. Before going to production,
> retrain on your own captured sessions (see Phase 17 `influx_exporter.py`). Until then,
> SynCAN training is useful only for validating the pipeline end-to-end.

### 8.2 `data/car_hacking_loader.py`

Car-Hacking CSVs have raw byte columns. Map the CAN ID to `msg_id` and treat each
DATA byte as a separate "signal" (signal_name = `"DATA_0"` … `"DATA_7"`).

```python
"""
car_hacking_loader.py
Loads Car-Hacking Dataset CSVs → unified Parquet files.

CSV columns: Timestamp, CAN_ID, DLC, DATA[0], ..., DATA[7], Flag
Flag: R = normal, T = attack

Usage:
    python -m anomaly_engine.data.car_hacking_loader \
        --input  anomaly_engine/data/public/car_hacking/ \
        --output anomaly_engine/data/raw/
"""
import argparse
from pathlib import Path
import pandas as pd


DATA_COLS = [f"DATA[{i}]" for i in range(8)]


def load_car_hacking_file(csv_path: Path, output_dir: Path) -> None:
    out_path = output_dir / f"carhack_{csv_path.stem}.parquet"
    if out_path.exists():
        print(f"  SKIP {csv_path.name}")
        return

    df_raw = pd.read_csv(csv_path,
                         names=["Timestamp", "CAN_ID", "DLC"] + DATA_COLS + ["Flag"])
    df_raw = df_raw.dropna(subset=["Timestamp", "CAN_ID"])

    # Melt DATA bytes → long format
    df = df_raw.melt(
        id_vars=["Timestamp", "CAN_ID", "Flag"],
        value_vars=DATA_COLS,
        var_name="signal_name",
        value_name="value",
    )
    df["value"] = df["value"].apply(
        lambda x: int(str(x).strip(), 16) if pd.notna(x) else None
    )
    df = df.dropna(subset=["value"])
    df["value"] = df["value"].astype(float)

    df["timestamp"]  = pd.to_datetime(df["Timestamp"].astype(float), unit="s", utc=True)
    df["msg_id"]     = df["CAN_ID"].astype(str).str.strip()
    df["label"]      = (df["Flag"].astype(str).str.strip() == "T").astype(int)
    df["session_id"] = f"carhack_{csv_path.stem}"

    df = df[["timestamp", "session_id", "msg_id", "signal_name", "value", "label"]]
    df = df.sort_values("timestamp").reset_index(drop=True)
    df.to_parquet(out_path, index=False, compression="snappy")
    print(f"  {csv_path.name}: {len(df):,} rows "
          f"(normal={(df['label']==0).sum():,}  attack={(df['label']==1).sum():,})"
          f" → {out_path.name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",  default="anomaly_engine/data/public/car_hacking/")
    parser.add_argument("--output", default="anomaly_engine/data/raw/")
    args = parser.parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    for csv_path in sorted(Path(args.input).glob("*.csv")):
        load_car_hacking_file(csv_path, output_dir)


if __name__ == "__main__":
    main()
```

### 8.3 `data/preprocessor.py`

Shared loader used by all downstream steps. Keeps the `label` column intact so
`evaluator.py` can use real attack labels without any extra work.

```python
"""
preprocessor.py
Reads unified Parquet files from data/raw/, validates, returns clean DataFrame.
"""
from pathlib import Path
import pandas as pd

REQUIRED_COLS = ["timestamp", "session_id", "msg_id", "signal_name", "value", "label"]


def load_all(
    source: Path | list[Path],
    label_filter: int | None = None,
) -> pd.DataFrame:
    """
    source        → directory (all *.parquet) or an explicit list of Parquet paths
    label_filter=0    → normal rows only  (training split)
    label_filter=None → all rows          (evaluation split)
    """
    paths = sorted(source.glob("*.parquet")) if isinstance(source, Path) else list(source)
    if not paths:
        raise FileNotFoundError(f"No parquet files in {source}")
    frames = []
    for p in paths:
        df = pd.read_parquet(p)
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.dropna(subset=REQUIRED_COLS)
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
        df = df.dropna(subset=["value"])
        if label_filter is not None:
            df = df[df["label"] == label_filter]
        frames.append(df)
    return (pd.concat(frames, ignore_index=True)
            .sort_values(["session_id", "msg_id", "signal_name", "timestamp"])
            .reset_index(drop=True))
```

---

## 9. Phase 2 — Feature Engineering

This is the most important phase. Bad features → bad model, regardless of which algorithm
you choose. Take your time here.

### 9.1 `features/signal_features.py`

```python
"""
signal_features.py
Computes rolling per-signal features within a sliding window.

All features are computed per (session_id, msg_id, signal_name) group,
preserving temporal ordering.

Window W is the number of prior frames (same msg_id) to include.
"""
import pandas as pd
import numpy as np


def compute_signal_features(df: pd.DataFrame, window: int = 20) -> pd.DataFrame:
    """
    Input columns: timestamp, session_id, msg_id, signal_name, value
    Output: adds feature columns to df, returns copy.
    """
    df = df.copy().sort_values(["session_id", "msg_id", "signal_name", "timestamp"])
    grp = df.groupby(["session_id", "msg_id", "signal_name"])

    # ── Value features ───────────────────────────────────────────────────────────
    df["value_lag1"]      = grp["value"].shift(1)
    df["delta"]           = df["value"] - df["value_lag1"]
    df["delta_abs"]       = df["delta"].abs()

    df["rolling_mean"]    = grp["value"].transform(
        lambda x: x.shift(1).rolling(window, min_periods=2).mean())
    df["rolling_std"]     = grp["value"].transform(
        lambda x: x.shift(1).rolling(window, min_periods=2).std())
    df["rolling_min"]     = grp["value"].transform(
        lambda x: x.shift(1).rolling(window, min_periods=2).min())
    df["rolling_max"]     = grp["value"].transform(
        lambda x: x.shift(1).rolling(window, min_periods=2).max())

    df["z_score"]         = (df["value"] - df["rolling_mean"]) / (df["rolling_std"] + 1e-8)

    observed_range = df["rolling_max"] - df["rolling_min"] + 1e-8
    df["range_position"]  = (df["value"] - df["rolling_min"]) / observed_range

    df["delta_lag1"]      = grp["delta"].shift(1)
    df["acceleration"]    = df["delta"] - df["delta_lag1"]

    # ── Temporal features ────────────────────────────────────────────────────────
    df["timestamp_ns"]    = df["timestamp"].astype(np.int64)
    df["inter_arrival_ns"] = grp["timestamp_ns"].diff()
    df["inter_arrival_ms"] = df["inter_arrival_ns"] / 1_000_000

    df["ia_rolling_mean"] = grp["inter_arrival_ms"].transform(
        lambda x: x.shift(1).rolling(window, min_periods=2).mean())
    df["ia_rolling_std"]  = grp["inter_arrival_ms"].transform(
        lambda x: x.shift(1).rolling(window, min_periods=2).std())

    df["ia_z_score"]      = (df["inter_arrival_ms"] - df["ia_rolling_mean"]) / \
                             (df["ia_rolling_std"] + 1e-8)

    df = df.drop(columns=["value_lag1", "delta_lag1", "timestamp_ns", "inter_arrival_ns"])
    return df
```

### 9.2 `features/message_features.py`

```python
"""
message_features.py
Computes per-message (msg_id) features — burst behavior, payload size,
signal count per frame timestamp.
"""
import pandas as pd
import numpy as np


def compute_message_features(df: pd.DataFrame, freq_window: int = 50) -> pd.DataFrame:
    df = df.copy().sort_values(["session_id", "msg_id", "timestamp"])
    grp_frame = df.groupby(["session_id", "msg_id", "timestamp"])

    signal_count = grp_frame["signal_name"].transform("count")
    df["signal_count_in_frame"] = signal_count

    grp_msg = df.groupby(["session_id", "msg_id"])
    df["_ts_ns"] = df["timestamp"].astype(np.int64)
    df["_ia_ns"] = grp_msg["_ts_ns"].diff()
    df["_ia_ms"] = df["_ia_ns"] / 1_000_000
    df["_ia_roll"] = grp_msg["_ia_ms"].transform(
        lambda x: x.shift(1).rolling(freq_window, min_periods=5).mean())

    df["msg_freq_hz"] = 1000.0 / (df["_ia_roll"] + 1e-8)
    df = df.drop(columns=["_ts_ns", "_ia_ns", "_ia_ms", "_ia_roll"])
    return df
```

### 9.3 `features/feature_matrix.py`

```python
"""
feature_matrix.py
Assembles the final feature DataFrame for training or inference.

One row = one (session_id, timestamp, msg_id, signal_name) observation.
"""
from pathlib import Path

import pandas as pd
import numpy as np

from anomaly_engine.features.signal_features import compute_signal_features

# 14 features — all computable from a single-signal sliding window.
# message_features.py (signal_count_in_frame, msg_freq_hz) is intentionally excluded:
# those two features require cross-signal frame context unavailable in online inference.
FEATURE_COLS = [
    "value", "delta", "delta_abs", "rolling_mean", "rolling_std",
    "rolling_min", "rolling_max", "z_score", "range_position", "acceleration",
    "inter_arrival_ms", "ia_rolling_mean", "ia_rolling_std", "ia_z_score",
]

INDEX_COLS = ["session_id", "timestamp", "msg_id", "signal_name"]


def build_feature_matrix(df: pd.DataFrame, window: int = 20) -> pd.DataFrame:
    df = compute_signal_features(df, window=window)
    df = df.dropna(subset=FEATURE_COLS)
    return df[INDEX_COLS + FEATURE_COLS]


def pivot_to_frame_vectors(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """
    Returns one DataFrame per msg_id.
    Rows = frames (timestamps). Columns = feature__signal_name.
    e.g. "z_score__EngineSpeed", "rolling_std__BrakePressure"
    If df has a 'label' column, carries it through as max per frame
    (1 if any signal in the frame is labeled as attack).
    """
    result = {}
    for msg_id, grp in df.groupby("msg_id"):
        pivoted = grp.pivot_table(
            index=["session_id", "timestamp"],
            columns="signal_name",
            values=FEATURE_COLS,
            aggfunc="first",
        )
        pivoted.columns = [f"{feat}__{sig}" for feat, sig in pivoted.columns]
        if "label" in grp.columns:
            frame_labels = grp.groupby(["session_id", "timestamp"])["label"].max()
            pivoted = pivoted.join(frame_labels)
        pivoted = pivoted.reset_index().dropna(
            subset=[c for c in pivoted.columns if c != "label"])
        result[msg_id] = pivoted
    return result


def save_features(df: pd.DataFrame, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(output_path, index=False, compression="snappy")
    print(f"Saved {len(df):,} rows → {output_path}")


def load_features(path: Path) -> pd.DataFrame:
    return pd.read_parquet(path)
```

---

## 10. Phase 3 — Model Candidates

You will train four core models for each `msg_id`. LSTM autoencoder is optional (add it with `--with-lstm` if AUC < 0.8 on temporal anomalies). The winner is selected in Phase 6.

### Model 1 — Isolation Forest

**What it does:** Randomly partitions the feature space. Anomalies are isolated in fewer
splits — shorter path length = higher anomaly score.

**Why use it:** Fast, scalable, works well with tabular data, naturally handles high
dimensionality, no assumption about data distribution.

**Weakness:** Does not model temporal sequences; treats each frame independently.

```python
from sklearn.ensemble import IsolationForest

model = IsolationForest(
    n_estimators=200,
    contamination="auto",  # let sklearn estimate the fraction; training set is label=0 only
    max_features=0.8,
    random_state=42,
    n_jobs=-1,
)
```

### Model 2 — One-Class SVM (OCSVM)

**What it does:** Learns a hypersphere in the kernel-mapped feature space that encloses the
normal data. Points outside the sphere are anomalies.

**Why use it:** Excellent at tight boundary modeling; good when anomalies cluster in specific
feature subspaces.

**Weakness:** O(n²) training complexity → slow on large datasets; kernel choice is critical.

```python
from sklearn.svm import OneClassSVM

model = OneClassSVM(
    kernel="rbf",
    nu=0.01,       # upper bound on fraction of training outliers
    gamma="scale",
)
# For datasets > 50,000 samples per msg_id, use SGDOneClassSVM from sklearn.linear_model.
```

### Model 3 — Local Outlier Factor (LOF)

**What it does:** Measures the local density deviation of a point relative to its neighbors.
Points in low-density regions compared to their neighbors are anomalies.

**Why use it:** Excellent for detecting **local** anomalies — a point normal globally but
anomalous in its local neighborhood. Catches Class C (correlation) anomalies well.

**Weakness:** Must use `novelty=True` for online inference; slow on high-dimensional data.

```python
from sklearn.neighbors import LocalOutlierFactor

model = LocalOutlierFactor(
    n_neighbors=20,
    contamination="auto",
    novelty=True,      # REQUIRED for online inference
    n_jobs=-1,
)
```

### Model 4 — PCA Reconstruction Error

**What it does:** Projects the feature vector to a lower-dimensional space and reconstructs it.
The reconstruction error is the anomaly score — anomalous frames have high error because their
variance is not captured by the principal components of normal data.

**Why use it:** Extremely fast at inference (matrix multiply), interpretable, robust to noise.

**Weakness:** Linear — cannot capture non-linear normal manifolds.

```python
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
import numpy as np

scaler = StandardScaler()
pca = PCA(n_components=0.95, random_state=42)   # retain 95% of variance

# Training:
X_scaled = scaler.fit_transform(X_train)
X_reduced = pca.fit_transform(X_scaled)
X_reconstructed = pca.inverse_transform(X_reduced)
train_errors = np.mean((X_scaled - X_reconstructed) ** 2, axis=1)

# Threshold = 99th percentile of training reconstruction errors
threshold = np.percentile(train_errors, 99)
# Inference: anomaly score = reconstruction_error / threshold
# Score > 1.0 means anomalous
```

### Model 5 — LSTM Autoencoder

**What it does:** An LSTM encoder compresses a sequence of W frames into a latent vector;
an LSTM decoder reconstructs the sequence. High reconstruction error = anomaly.

**Why use it:** The only model here that explicitly models temporal sequences — captures Class B
(temporal) and Class D (sequence order) anomalies at the sequence level.

**Weakness:** Requires significant training data (>50 sessions); much slower to train and infer
than the sklearn models. Only add this if sklearn models show high false-positive rates on
temporal anomalies in your Phase 5 evaluation.

```python
# Architecture — PyTorch
import torch
import torch.nn as nn

class LSTMAutoencoder(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int = 64, num_layers: int = 2):
        super().__init__()
        self.encoder = nn.LSTM(input_dim, hidden_dim, num_layers,
                               batch_first=True, dropout=0.1)
        self.decoder = nn.LSTM(hidden_dim, input_dim, num_layers,
                               batch_first=True, dropout=0.1)

    def forward(self, x):
        encoded, _ = self.encoder(x)
        context = encoded[:, -1:, :].repeat(1, x.size(1), 1)
        decoded, _ = self.decoder(context)
        return decoded

# Loss function: F.mse_loss(decoded, x)
# Anomaly score = mean MSE per frame across all signals in the sequence
# Threshold = 99th percentile of training reconstruction errors
```

---

## 11. Phase 4 — Training Pipeline

### 11.1 `training/trainer.py`

```python
"""
trainer.py
Trains all model candidates for each msg_id found in the feature data.
Saves trained models to anomaly_engine/models/{msg_id}/{model_name}.joblib
"""
import json
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.svm import OneClassSVM

MODELS_DIR = Path("anomaly_engine/models")


@dataclass
class TrainedModel:
    msg_id: str
    model_name: str
    model: Any
    scaler: StandardScaler
    n_features: int
    feature_cols: list[str]
    train_samples: int
    train_time_s: float
    metadata: dict


def train_isolation_forest(X: np.ndarray) -> tuple[Any, dict]:
    t0 = time.time()
    m = IsolationForest(n_estimators=200, contamination="auto",
                        max_features=0.8, random_state=42, n_jobs=-1)
    m.fit(X)
    return m, {"train_time_s": round(time.time() - t0, 2)}


def train_ocsvm(X: np.ndarray) -> tuple[Any, dict]:
    downsampled = False
    if len(X) > 50_000:
        X = X[np.random.choice(len(X), 50_000, replace=False)]
        downsampled = True
    t0 = time.time()
    m = OneClassSVM(kernel="rbf", nu=0.01, gamma="scale")
    m.fit(X)
    return m, {"train_time_s": round(time.time() - t0, 2), "downsampled": downsampled}


def train_lof(X: np.ndarray) -> tuple[Any, dict]:
    t0 = time.time()
    m = LocalOutlierFactor(n_neighbors=20, contamination="auto", novelty=True, n_jobs=-1)
    m.fit(X)
    return m, {"train_time_s": round(time.time() - t0, 2)}


def train_pca(X: np.ndarray) -> tuple[Any, dict]:
    t0 = time.time()
    pca = PCA(n_components=0.95, random_state=42)
    X_reduced = pca.fit_transform(X)
    X_recon = pca.inverse_transform(X_reduced)
    errors = np.mean((X - X_recon) ** 2, axis=1)
    threshold = float(np.percentile(errors, 99))
    return (pca, threshold), {
        "train_time_s": round(time.time() - t0, 2),
        "n_components": int(pca.n_components_),
        "threshold_99pct": threshold,
    }


def train_all_for_msg(msg_id: str, X: np.ndarray, feature_cols: list[str],
                      models_dir: Path) -> list[TrainedModel]:
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    results = []
    for name, fn in [
        ("isolation_forest", train_isolation_forest),
        ("ocsvm",            train_ocsvm),
        ("lof",              train_lof),
        ("pca",              train_pca),
    ]:
        print(f"  Training {name} for {msg_id}...")
        model_obj, meta = fn(X_scaled)
        tm = TrainedModel(
            msg_id=msg_id, model_name=name, model=model_obj, scaler=scaler,
            n_features=X.shape[1], feature_cols=feature_cols,
            train_samples=len(X), train_time_s=meta.get("train_time_s", 0),
            metadata=meta,
        )
        _save(tm, models_dir)
        results.append(tm)
    return results


def _save(tm: TrainedModel, models_dir: Path) -> None:
    msg_dir = models_dir / tm.msg_id
    msg_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": tm.model, "scaler": tm.scaler}, msg_dir / f"{tm.model_name}.joblib")
    meta = {k: v for k, v in asdict(tm).items() if k not in ("model", "scaler")}
    (msg_dir / f"{tm.model_name}.meta.json").write_text(json.dumps(meta, indent=2))
    print(f"    Saved → {msg_dir / tm.model_name}.joblib")
```

### 11.2 `train.py` — Entrypoint

```python
"""
train.py — Offline training pipeline entrypoint

Run from python_parser/ directory:
    python -m anomaly_engine.train --window 20

Steps:
  1. 80/20 split of scenario Parquet files (reproducible, seed=42)
  2. Load label=0 rows from train split for unsupervised training
  3. Build feature matrices (train split)
  4. Train all model candidates per msg_id
  5. Evaluate on eval split with real attack labels (AUC-ROC + latency)
  6. Select and register winning models
"""
import argparse
import random
from pathlib import Path

from anomaly_engine.data.preprocessor import load_all
from anomaly_engine.features.feature_matrix import (
    build_feature_matrix, save_features, pivot_to_frame_vectors
)
from anomaly_engine.training.trainer import train_all_for_msg
from anomaly_engine.training.evaluator import evaluate_all
from anomaly_engine.training.model_selector import select_and_register_winners

RAW_DIR     = Path("anomaly_engine/data/raw")
FEATURE_DIR = Path("anomaly_engine/data/features")
MODELS_DIR  = Path("anomaly_engine/models")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--window", type=int, default=20)
    args = parser.parse_args()

    # ── Step 1: 80/20 scenario split (by file, not by row) ───────────────────────
    all_parquets = sorted(RAW_DIR.glob("*.parquet"))
    if len(all_parquets) < 5:
        raise RuntimeError(f"Need ≥5 scenario files in {RAW_DIR}, found {len(all_parquets)}")
    random.seed(42)
    random.shuffle(all_parquets)
    n_train      = max(1, int(len(all_parquets) * 0.8))
    train_files  = all_parquets[:n_train]
    eval_files   = all_parquets[n_train:]
    print(f"Scenarios — train: {len(train_files)}, eval: {len(eval_files)}")

    # ── Step 2: Load NORMAL rows only for training ───────────────────────────────
    print("Loading normal (label=0) rows for training...")
    train_df = load_all(train_files, label_filter=0)

    # ── Step 2: Build features on normal data ────────────────────────────────────
    print("Building feature matrices...")
    feat_train = build_feature_matrix(train_df, window=args.window)
    save_features(feat_train, FEATURE_DIR / "features_train.parquet")

    # ── Step 3: Train all 5 candidates per msg_id ────────────────────────────────
    per_msg = pivot_to_frame_vectors(feat_train)
    for msg_id, df_msg in per_msg.items():
        print(f"\n=== {msg_id} ({len(df_msg):,} normal frame vectors) ===")
        feat_cols = [c for c in df_msg.columns
                     if c not in ("session_id", "timestamp", "label")]
        X = df_msg[feat_cols].values
        train_all_for_msg(msg_id, X, feat_cols, MODELS_DIR)

    # ── Step 4: Evaluate on eval split (normal + attack) — real labels ───────────
    print("\nRunning evaluation on eval scenarios (real attack labels)...")
    eval_df  = load_all(eval_files, label_filter=None)
    feat_eval = build_feature_matrix(eval_df, window=args.window)
    scores = evaluate_all(feat_eval, MODELS_DIR)

    # ── Step 5: Pick best model per msg_id ───────────────────────────────────────
    select_and_register_winners(scores, MODELS_DIR)
    print("\nTraining complete.")


if __name__ == "__main__":
    main()
```

---

## 12. Phase 5 — Evaluation and Benchmarking

Because you are using public datasets with **real labeled attacks**, evaluation is
straightforward: run every trained model candidate against the full dataset (normal +
attack rows), compute AUC-ROC against the real `label` column, and benchmark latency.
No synthetic injection needed.

### 12.1 What the Evaluation Measures Per Model Candidate

| Metric | How computed | What it tells you |
|---|---|---|
| **AUC-ROC** | `roc_auc_score(real_labels, model_scores)` | Overall discriminative power across all thresholds |
| **Latency µs/frame** | `time.perf_counter()` over test set / n | Whether the model fits inside the 60Hz budget |
| **Precision@threshold** | At score ≥ 0.85, what fraction are real attacks | False-positive cost in production |
| **Recall@threshold** | At score ≥ 0.85, what fraction of attacks are caught | Miss rate |

### 12.2 `training/evaluator.py`

```python
"""
evaluator.py
Evaluates all trained model candidates against real labeled attack data.
Uses the label column from the public dataset — no synthetic injection.

Called by train.py after trainer.py completes.
"""
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, precision_score, recall_score

from anomaly_engine.features.feature_matrix import pivot_to_frame_vectors

SCORE_THRESHOLD = 0.85   # normalised score above which a frame is flagged


def _raw_score(model_obj, scaler, X: np.ndarray) -> np.ndarray:
    X_scaled = scaler.transform(X)
    if hasattr(model_obj, "decision_function"):
        return -model_obj.decision_function(X_scaled)   # higher = more anomalous
    elif isinstance(model_obj, tuple):                  # PCA tuple
        pca, _ = model_obj
        X_recon = pca.inverse_transform(pca.transform(X_scaled))
        return np.mean((X_scaled - X_recon) ** 2, axis=1)
    raise ValueError(f"Unknown model type: {type(model_obj)}")


def _normalise(raw: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-raw))   # sigmoid → [0, 1]


def evaluate_all(feat_df: pd.DataFrame, models_dir: Path) -> dict:
    """
    feat_df must contain ALL rows (normal + attack) with a 'label' column.
    Pass load_all(raw_dir, label_filter=None) to get this.
    """
    results = {}

    # pivot_to_frame_vectors preserves the label column at the frame level
    per_msg = pivot_to_frame_vectors(feat_df)

    for msg_id, df_msg in per_msg.items():
        msg_dir = models_dir / msg_id
        if not msg_dir.exists():
            continue
        results[msg_id] = {}

        feat_cols = [c for c in df_msg.columns
                     if c not in ("session_id", "timestamp", "label")]
        X = df_msg[feat_cols].values
        y = df_msg["label"].values.astype(int) if "label" in df_msg.columns \
            else np.zeros(len(df_msg), dtype=int)

        n_normal = (y == 0).sum()
        n_attack = (y == 1).sum()
        print(f"\n  {msg_id}: {n_normal:,} normal  {n_attack:,} attack frames")

        for joblib_path in sorted(msg_dir.glob("*.joblib")):
            model_name = joblib_path.stem
            loaded = joblib.load(joblib_path)
            model, scaler = loaded["model"], loaded["scaler"]

            t0 = time.perf_counter()
            raw   = _raw_score(model, scaler, X)
            scores = _normalise(raw)
            elapsed_us = (time.perf_counter() - t0) * 1e6 / max(len(X), 1)

            try:
                auc = float(roc_auc_score(y, scores))
            except ValueError:
                auc = 0.5   # only one class present in this msg_id

            preds = (scores >= SCORE_THRESHOLD).astype(int)
            try:
                prec = float(precision_score(y, preds, zero_division=0))
                rec  = float(recall_score(y, preds, zero_division=0))
            except Exception:
                prec = rec = 0.0

            results[msg_id][model_name] = {
                "auc":         round(auc,        4),
                "precision":   round(prec,       4),
                "recall":      round(rec,        4),
                "latency_us":  round(elapsed_us, 2),
                "n_normal":    int(n_normal),
                "n_attack":    int(n_attack),
            }
            print(f"    {model_name:20s}  AUC={auc:.4f}  "
                  f"P={prec:.3f}  R={rec:.3f}  lat={elapsed_us:.1f}µs")

    eval_path = models_dir / "evaluation_report.json"
    eval_path.write_text(json.dumps(results, indent=2))
    print(f"\nEvaluation report → {eval_path}")
    return results
```

### 12.3 Evaluation Output

After `train.py` finishes, inspect `anomaly_engine/models/evaluation_report.json`.
All trained candidates are compared side-by-side per `msg_id`:

```json
{
  "ambient_dyno_drive_basic_long": {
    "isolation_forest": { "auc": 0.94, "precision": 0.81, "recall": 0.76, "latency_us": 12.3 },
    "ocsvm":            { "auc": 0.91, "precision": 0.78, "recall": 0.70, "latency_us": 8.1  },
    "lof":              { "auc": 0.96, "precision": 0.88, "recall": 0.82, "latency_us": 45.2 },
    "pca":              { "auc": 0.88, "precision": 0.72, "recall": 0.68, "latency_us": 3.1  }
  }
}
```

---

## 13. Phase 6 — Model Selection

### 13.1 Selection Criteria

Use this decision matrix for each `msg_id`:

| Priority | Criterion | Weight |
|---|---|---|
| 1 | AUC-ROC on real labeled eval set | 40% |
| 2 | Precision@0.85 threshold | 20% |
| 3 | Inference latency (µs/frame) | 30% |
| 4 | Recall@0.85 threshold | 10% |

**Hard constraints:**
- AUC < 0.7 → reject all models for this msg_id (not enough data or signal)
- Latency > 200µs per frame → disqualify (at 60Hz there are ~16ms between batches)

### 13.2 `training/model_selector.py`

```python
"""
model_selector.py
Selects the best model per msg_id and writes registry.json.
The registry is loaded by detector.py at startup.
"""
import json
from pathlib import Path

LATENCY_BUDGET_US = 200.0
MIN_AUC           = 0.70


def select_and_register_winners(scores: dict, models_dir: Path) -> None:
    registry = {}

    for msg_id, model_scores in scores.items():
        candidates = []
        for model_name, m in model_scores.items():
            if m["auc"] < MIN_AUC:
                continue
            if m["latency_us"] > LATENCY_BUDGET_US:
                continue
            latency_score = 1.0 - min(m["latency_us"] / LATENCY_BUDGET_US, 1.0)
            composite = (0.4 * m["auc"]
                         + 0.2 * m.get("precision", 0.0)
                         + 0.3 * latency_score
                         + 0.1 * m.get("recall", 0.0))
            candidates.append((composite, model_name, m))

        if not candidates:
            print(f"  WARNING: No qualified model for {msg_id} — using PCA fallback")
            winner_name = "pca"
        else:
            candidates.sort(reverse=True)
            winner_name = candidates[0][1]

        registry[msg_id] = {
            "model":      winner_name,
            "model_path": str(models_dir / msg_id / f"{winner_name}.joblib"),
            "scores":     model_scores,
        }
        auc = model_scores.get(winner_name, {}).get("auc", 0)
        print(f"  ✓ {msg_id} winner: {winner_name} (AUC={auc:.3f})")

    registry_path = models_dir / "registry.json"
    registry_path.write_text(json.dumps(registry, indent=2))
    print(f"\nRegistry saved → {registry_path}")
```

---

## 14. Phase 7 — Online Inference (Kafka Consumer)

### 14.1 `inference/window_buffer.py`

```python
"""
window_buffer.py
Maintains a per-(session_id, msg_id, signal_name) sliding window
for real-time feature computation.
"""
from collections import deque
from dataclasses import dataclass, field
from typing import Optional
import numpy as np


@dataclass
class SignalWindow:
    values:        deque = field(default_factory=lambda: deque(maxlen=20))
    timestamps_ms: deque = field(default_factory=lambda: deque(maxlen=20))


class WindowBuffer:
    def __init__(self, window: int = 20):
        self._window = window
        self._buffers: dict[tuple, SignalWindow] = {}

    def update(self, session_id: str, msg_id: str,
               signal_name: str, value: float, timestamp_ms: float) -> None:
        key = (session_id, msg_id, signal_name)
        if key not in self._buffers:
            self._buffers[key] = SignalWindow(
                values=deque(maxlen=self._window),
                timestamps_ms=deque(maxlen=self._window),
            )
        self._buffers[key].values.append(value)
        self._buffers[key].timestamps_ms.append(timestamp_ms)

    def get_features(self, session_id: str, msg_id: str,
                     signal_name: str, value: float,
                     timestamp_ms: float) -> Optional[dict]:
        key = (session_id, msg_id, signal_name)
        buf = self._buffers.get(key)
        if buf is None or len(buf.values) < 3:
            return None

        vals = np.array(buf.values)
        times = np.array(buf.timestamps_ms)
        mean = vals.mean()
        std  = vals.std() + 1e-8
        mn, mx = vals.min(), vals.max()
        obs_range = mx - mn + 1e-8
        prev_val = vals[-1]
        delta = value - prev_val
        prev_delta = (vals[-1] - vals[-2]) if len(vals) >= 2 else 0.0
        ia_ms = np.diff(times)
        ia_mean = ia_ms.mean() if len(ia_ms) > 0 else 0.0
        ia_std  = ia_ms.std()  + 1e-8
        current_ia = (timestamp_ms - times[-1]) if len(times) > 0 else 0.0

        return {
            "value":            value,
            "delta":            delta,
            "delta_abs":        abs(delta),
            "rolling_mean":     mean,
            "rolling_std":      std,
            "rolling_min":      mn,
            "rolling_max":      mx,
            "z_score":          (value - mean) / std,
            "range_position":   (value - mn) / obs_range,
            "acceleration":     delta - prev_delta,
            "inter_arrival_ms": current_ia,
            "ia_rolling_mean":  ia_mean,
            "ia_rolling_std":   ia_std,
            "ia_z_score":       (current_ia - ia_mean) / ia_std,
        }

    def evict_session(self, session_id: str) -> None:
        keys = [k for k in self._buffers if k[0] == session_id]
        for k in keys:
            del self._buffers[k]
```

### 14.2 `inference/scorer.py`

```python
"""
scorer.py
Loads the model registry and scores an incoming frame's signals.
Returns a single anomaly score [0, 1] plus top contributing signals.
"""
import json
import time
from pathlib import Path
from typing import Optional

import joblib
import numpy as np


class AnomalyScorer:
    def __init__(self, registry_path: Path, feature_cols: list[str]):
        self._registry = json.loads(registry_path.read_text())
        self._models: dict[str, tuple] = {}
        self._feature_cols = feature_cols
        self._load_all()

    def _load_all(self) -> None:
        for msg_id, entry in self._registry.items():
            artifact = joblib.load(entry["model_path"])
            self._models[msg_id] = (artifact["model"], artifact["scaler"])

    def score_frame(
        self,
        msg_id: str,
        signal_features: dict[str, dict],   # {signal_name: feature_dict}
    ) -> Optional[dict]:
        if msg_id not in self._models:
            return None
        model, scaler = self._models[msg_id]

        row = {
            f"{feat}__{sig}": val
            for sig, feats in signal_features.items()
            for feat, val in feats.items()
        }
        x = np.array([[row.get(col, 0.0) for col in self._feature_cols]])
        x_scaled = scaler.transform(x)

        t0 = time.perf_counter()
        if hasattr(model, "decision_function"):
            raw_score = float(-model.decision_function(x_scaled)[0])
        elif isinstance(model, tuple):
            pca, threshold = model
            x_recon = pca.inverse_transform(pca.transform(x_scaled))
            raw_score = float(np.mean((x_scaled - x_recon) ** 2)) / threshold
        else:
            raw_score = 0.0
        latency_us = (time.perf_counter() - t0) * 1e6

        normalised = float(1.0 / (1.0 + np.exp(-raw_score)))
        z_scores = sorted(
            [{"name": s, "z_score": round(float(f.get("z_score", 0)), 3)}
             for s, f in signal_features.items()],
            key=lambda x: abs(x["z_score"]),
            reverse=True,
        )
        return {
            "score":       round(normalised, 4),
            "raw_score":   round(raw_score, 4),
            "top_signals": z_scores[:3],
            "latency_us":  round(latency_us, 1),
        }
```

### 14.3 `detector.py` — Online Kafka Consumer

```python
"""
detector.py — Online anomaly detection entrypoint

Consumes decoded-signals from Kafka, scores each frame,
publishes anomaly events to anomaly-events topic.

Consumer group: anomaly-engine-group  (separate from kpit-backend group)

Run:
    cd python_parser
    INFLUXDB_URL=... INFLUXDB_TOKEN=... python -m anomaly_engine.detector
"""
import json
import logging
import os
import sys
from pathlib import Path

from kafka import KafkaConsumer, KafkaProducer

from anomaly_engine.inference.window_buffer import WindowBuffer
from anomaly_engine.inference.scorer import AnomalyScorer
from anomaly_engine.features.feature_matrix import FEATURE_COLS

KAFKA_BOOTSTRAP   = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
INPUT_TOPIC       = "decoded-signals"
OUTPUT_TOPIC      = "anomaly-events"
CONSUMER_GROUP    = "anomaly-engine-group"
MODELS_DIR        = Path("anomaly_engine/models")
ANOMALY_THRESHOLD = float(os.environ.get("ANOMALY_THRESHOLD", "0.85"))

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [ANOMALY] %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _load_feature_cols(models_dir: Path) -> list[str]:
    for meta_path in models_dir.rglob("*.meta.json"):
        meta = json.loads(meta_path.read_text())
        if "feature_cols" in meta:
            return meta["feature_cols"]
    return FEATURE_COLS


def main() -> None:
    registry_path = MODELS_DIR / "registry.json"
    if not registry_path.exists():
        log.error("No registry.json found. Run: python -m anomaly_engine.train first.")
        sys.exit(1)

    scorer = AnomalyScorer(registry_path, _load_feature_cols(MODELS_DIR))
    buffer = WindowBuffer(window=20)

    consumer = KafkaConsumer(
        INPUT_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP,
        group_id=CONSUMER_GROUP,
        auto_offset_reset="latest",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        enable_auto_commit=True,
    )
    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        key_serializer=lambda k: k.encode("utf-8") if k else None,
    )

    log.info("Anomaly detector started. Threshold=%.2f", ANOMALY_THRESHOLD)

    for message in consumer:
        try:
            frame        = message.value
            session_id   = frame.get("session_id") or message.key
            msg_id       = frame.get("msg_id") or frame.get("msgId", "")
            timestamp_ms = float(frame.get("timestamp", 0)) * 1000
            signals      = frame.get("signals", [])

            if not session_id or not msg_id or not signals:
                continue

            signal_features = {}
            for sig in (signals if isinstance(signals, list) else []):
                sig_name = sig.get("signal_name")
                raw_val  = sig.get("raw_value")
                if sig_name is None or raw_val is None:
                    continue
                try:
                    val = float(raw_val)
                except (TypeError, ValueError):
                    continue
                buffer.update(session_id, msg_id, sig_name, val, timestamp_ms)
                feats = buffer.get_features(session_id, msg_id, sig_name,
                                            val, timestamp_ms)
                if feats:
                    signal_features[sig_name] = feats

            if not signal_features:
                continue

            result = scorer.score_frame(msg_id, signal_features)
            if result is None:
                continue

            if result["score"] >= ANOMALY_THRESHOLD:
                event = {
                    "session_id":   session_id,
                    "msg_id":       msg_id,
                    "timestamp":    frame.get("timestamp"),
                    "score":        result["score"],
                    "top_signals":  result["top_signals"],
                    "msg_name":     frame.get("msg_name") or frame.get("msgName", ""),
                    "channel_name": frame.get("channel_name") or frame.get("channelName", ""),
                }
                producer.send(OUTPUT_TOPIC, key=session_id, value=event)
                log.info("ANOMALY session=%s msg=%s score=%.3f signals=%s",
                         session_id[:8], msg_id, result["score"],
                         [s["name"] for s in result["top_signals"]])

        except Exception:
            log.exception("Error processing frame")


if __name__ == "__main__":
    main()
```

---

## 15. Phase 8 — Spring Boot Integration

Follow the exact same patterns as `IntegrityFaultEntity` / `IntegrityAnalyzerService`.
The `anomaly-events` Kafka topic is already declared in `KafkaTopicConfig.java`.

### 15.1 MySQL Migration

```sql
-- V10__create_anomaly_events.sql
CREATE TABLE anomaly_events (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id      VARCHAR(64)   NOT NULL,
    msg_id          VARCHAR(32)   NOT NULL,
    msg_name        VARCHAR(128),
    channel_name    VARCHAR(64),
    frame_timestamp DOUBLE,
    score           FLOAT         NOT NULL,
    top_signals     VARCHAR(500),          -- JSON: [{"name":"EngineSpeed","z_score":4.1}]
    created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_session (session_id),
    INDEX idx_session_ts (session_id, frame_timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 15.2 `AnomalyEventEntity.java`

```java
package com.example.backend.can.entity;

import jakarta.persistence.*;
import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;
import java.time.LocalDateTime;

@Entity
@Table(name = "anomaly_events")
@EntityListeners(AuditingEntityListener.class)
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AnomalyEventEntity {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false)
    private String sessionId;

    @Column(name = "msg_id", nullable = false)
    private String msgId;

    @Column(name = "msg_name")
    private String msgName;

    @Column(name = "channel_name")
    private String channelName;

    @Column(name = "frame_timestamp")
    private Double frameTimestamp;

    @Column(name = "score", nullable = false)
    private Float score;

    @Column(name = "top_signals", length = 500)
    private String topSignals;

    @CreatedDate
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
```

### 15.3 `AnomalyEventRepository.java`

```java
package com.example.backend.can.repository;

import com.example.backend.can.entity.AnomalyEventEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AnomalyEventRepository
        extends JpaRepository<AnomalyEventEntity, Long> {

    List<AnomalyEventEntity> findBySessionIdOrderByFrameTimestampAsc(String sessionId);
    long countBySessionId(String sessionId);
}
```

### 15.4 `AnomalyEventDto.java`

```java
package com.example.backend.can.dto;

public record AnomalyEventDto(
        Long id, String sessionId, String msgId, String msgName,
        String channelName, Double frameTimestamp, Float score, String topSignals) {

    public static AnomalyEventDto from(
            com.example.backend.can.entity.AnomalyEventEntity e) {
        return new AnomalyEventDto(
                e.getId(), e.getSessionId(), e.getMsgId(), e.getMsgName(),
                e.getChannelName(), e.getFrameTimestamp(), e.getScore(),
                e.getTopSignals());
    }
}
```

### 15.5 `AnomalyService.java`

```java
package com.example.backend.can.service;

import com.example.backend.can.dto.AnomalyEventDto;
import com.example.backend.can.entity.AnomalyEventEntity;
import com.example.backend.can.repository.AnomalyEventRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class AnomalyService {

    private final AnomalyEventRepository repository;
    private final ObjectMapper objectMapper;
    private final SimpMessagingTemplate messagingTemplate;

    public void saveFromKafkaPayload(String json) {
        try {
            JsonNode node = objectMapper.readTree(json);
            String sessionId = node.path("session_id").asText();
            if (sessionId.isBlank()) return;

            AnomalyEventEntity event = AnomalyEventEntity.builder()
                    .sessionId(sessionId)
                    .msgId(node.path("msg_id").asText(""))
                    .msgName(node.path("msg_name").asText(""))
                    .channelName(node.path("channel_name").asText(""))
                    .frameTimestamp(node.path("timestamp").isNull()
                            ? null : node.path("timestamp").asDouble())
                    .score((float) node.path("score").asDouble())
                    .topSignals(node.path("top_signals").toString())
                    .build();

            repository.save(event);

            messagingTemplate.convertAndSend(
                    "/topic/anomaly-events/" + sessionId,
                    AnomalyEventDto.from(event));

        } catch (Exception e) {
            log.error("Failed to save anomaly event: {}", e.getMessage(), e);
        }
    }

    public List<AnomalyEventDto> getEventsForSession(String sessionId) {
        return repository.findBySessionIdOrderByFrameTimestampAsc(sessionId)
                .stream().map(AnomalyEventDto::from).toList();
    }

    public long countBySession(String sessionId) {
        return repository.countBySessionId(sessionId);
    }
}
```

### 15.6 Add Kafka Listener to `CanKafkaConsumer.java`

```java
// Add to existing CanKafkaConsumer — inject AnomalyService via @RequiredArgsConstructor

@KafkaListener(
    topics = KafkaTopicConfig.TOPIC_ANOMALY_EVENTS,
    groupId = "${spring.kafka.consumer.group-id}")
public void consumeAnomalyEvent(String message, Acknowledgment ack) {
    try {
        anomalyService.saveFromKafkaPayload(message);
        ack.acknowledge();
    } catch (Exception e) {
        log.error("Failed to process anomaly-events message", e);
        // Do not acknowledge — redelivery on next startup
    }
}
```

### 15.7 `AnomalyController.java`

```java
package com.example.backend.can.controller;

import com.example.backend.can.dto.AnomalyEventDto;
import com.example.backend.can.service.AnomalyService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/can")
@RequiredArgsConstructor
public class AnomalyController {

    private final AnomalyService anomalyService;

    @GetMapping("/sessions/{sessionId}/anomaly-events")
    public ResponseEntity<List<AnomalyEventDto>> getAnomalyEvents(
            @PathVariable String sessionId) {
        return ResponseEntity.ok(anomalyService.getEventsForSession(sessionId));
    }
}
```

### 15.8 Fix the `anomalyOnly` Filter in `CanController.java`

Once `AnomalyService` exists, replace the 501 stub:

```java
// Replace the current 501 stub in getFrames():
if (anomalyOnly) {
    List<Double> anomalyTimestamps = anomalyService
        .getEventsForSession(sessionId)
        .stream()
        .map(AnomalyEventDto::frameTimestamp)
        .filter(java.util.Objects::nonNull)
        .toList();
    if (anomalyTimestamps.isEmpty()) return ResponseEntity.ok(List.of());
    // Query InfluxDB for only those specific frame timestamps
    List<Long> nanos = anomalyTimestamps.stream()
        .map(ts -> (long)(ts * 1_000_000_000L))
        .toList();
    return ResponseEntity.ok(
        influxWriteService.queryFramesPaged(sessionId, null, null, nanos, page, size));
}
```

---

## 16. Phase 9 — Angular Integration

### 16.1 Re-enable the Anomaly Button

In `can-workspace.component.ts`, replace the disabled button with the active one:

```html
<button type="button" class="fault-toggle"
  [class.active]="anomalyOnly()"
  (click)="wsToggleAnomalyOnly()">
  🔍 Anomaly
</button>
```

### 16.2 `core/services/anomaly.service.ts`

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AnomalyEvent {
  id: number;
  sessionId: string;
  msgId: string;
  msgName: string;
  channelName: string;
  frameTimestamp: number;
  score: number;
  topSignals: Array<{ name: string; z_score: number }>;
}

@Injectable({ providedIn: 'root' })
export class AnomalyService {
  private http = inject(HttpClient);

  getAnomalyEvents(sessionId: string): Observable<AnomalyEvent[]> {
    return this.http.get<AnomalyEvent[]>(
      `/api/can/sessions/${sessionId}/anomaly-events`
    );
  }
}
```

### 16.3 WebSocket — Live Anomaly Alerts

Add to `LiveTelemetryService`:

```typescript
private anomalySubject = new Subject<AnomalyEvent>();
readonly anomaly$ = this.anomalySubject.asObservable();

subscribeToAnomalyAlerts(sessionId: string): void {
  this.rxStomp.watch(`/topic/anomaly-events/${sessionId}`)
    .pipe(map(msg => JSON.parse(msg.body) as AnomalyEvent))
    .subscribe(event => this.anomalySubject.next(event));
}
```

### 16.4 Visual Treatment

In the Integrity tab of the sniffer (or a new Anomaly sub-tab):

- Table: timestamp, message ID, score (0–1 progress bar), top contributing signals
- Score colour: `score > 0.95` → red badge, `0.85–0.95` → orange badge
- In the Charts tab: overlay anomaly frame timestamps as vertical red marker lines
  (same mechanism as the replay playhead that already exists)
- In the frame list: add a small `⚠` icon on rows whose timestamp matches an anomaly event

---

## 17. MLOps

### 17.1 Model Versioning

Each training run writes to a timestamped directory:

```
anomaly_engine/models/
  registry.json               ← points to latest winner per msg_id (updated by train.py)
  runs/
    2026-06-18T14:30/
      registry.json
      0x170/
        isolation_forest.joblib
        isolation_forest.meta.json
      evaluation_report.json
```

Never overwrite model files in-place. Write to a new run directory, then atomically
update `registry.json` (write to temp file, rename to final path).

### 17.2 Retraining Triggers

Retrain when any of these happen:
1. You accumulate 10+ new clean sessions since the last training run
2. The false positive rate rises above 5% on known-clean sessions
3. A new vehicle catalog is loaded (new signals → new feature columns)
4. Monthly (scheduled, regardless of drift detection)

### 17.3 Drift Detection

After each week of production scoring, compute the score distribution on frames you
manually confirmed as clean. If the mean score rises, the model has drifted:

```python
import json, pathlib, statistics
logs = list(pathlib.Path("anomaly_engine/inference_logs").glob("*.jsonl"))
scores = [json.loads(l)["score"] for f in logs for l in f.read_text().splitlines()]
mean_score = statistics.mean(scores)
print(f"Mean anomaly score this week: {mean_score:.4f}")
if mean_score > 0.15:   # derive this baseline from your first week of clean operation
    print("WARNING: Drift detected — consider retraining")
```

### 17.4 Minimum Data Requirements

| Phase | Requirement | Why |
|---|---|---|
| Training | ≥ 20 clean sessions | IsolationForest needs ≥ 1000 samples per msg_id |
| OCSVM | ≤ 50,000 samples per msg_id | Training complexity O(n²) |
| LSTM | ≥ 30 sessions × 5 min each | Sequence model needs long context |
| Evaluation | ≥ 5 held-out clean sessions | AUC estimate stability |

### 17.5 `data/influx_exporter.py` — Pull Live Sessions for Retraining

Once you have real captured sessions in InfluxDB, use this exporter to produce Parquet
files in the same unified schema that `preprocessor.py` expects. Run it before retraining
to supplement or replace the SynCAN data.

```python
"""
influx_exporter.py
Exports CAN signal rows from InfluxDB → unified Parquet files (one per session).
Schema: timestamp (UTC), session_id, msg_id, signal_name, value, label=0
"""
import argparse
from pathlib import Path

import pandas as pd
from influxdb_client import InfluxDBClient


INFLUX_URL    = "http://localhost:8086"
INFLUX_TOKEN  = "your-token"          # use env var in production: os.environ["INFLUX_TOKEN"]
INFLUX_ORG    = "kpit"
INFLUX_BUCKET = "ecu_telemetry"


def export_session(client: InfluxDBClient, session_id: str, output_dir: Path) -> None:
    query = f"""
    from(bucket: "{INFLUX_BUCKET}")
      |> range(start: -30d)
      |> filter(fn: (r) => r._measurement == "can_signals")
      |> filter(fn: (r) => r.session_id == "{session_id}")
      |> pivot(rowKey: ["_time", "session_id", "msg_id", "signal_name"],
               columnKey: ["_field"], valueColumn: "_value")
    """
    tables = client.query_api().query_data_frame(query, org=INFLUX_ORG)
    if tables.empty:
        print(f"  No data for session {session_id}")
        return
    df = (tables
          .rename(columns={"_time": "timestamp", "value": "value"})
          [["timestamp", "session_id", "msg_id", "signal_name", "value"]])
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df["value"]     = pd.to_numeric(df["value"], errors="coerce")
    df["label"]     = 0   # live sessions are assumed clean; set to 1 manually for attacks
    df = df.dropna().sort_values(["msg_id", "signal_name", "timestamp"])
    out = output_dir / f"{session_id}.parquet"
    df.to_parquet(out, index=False, compression="snappy")
    print(f"  Exported {len(df):,} rows → {out.name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions", nargs="+", required=True,
                        help="Session IDs to export from InfluxDB")
    parser.add_argument("--output", default="anomaly_engine/data/raw/")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    with InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG) as client:
        for session_id in args.sessions:
            print(f"Exporting {session_id}...")
            export_session(client, session_id, output_dir)


if __name__ == "__main__":
    main()
```

Run:
```bash
python -m anomaly_engine.data.influx_exporter \
    --sessions session_abc session_def \
    --output anomaly_engine/data/raw/
```

After export, retrain with `python -m anomaly_engine.train --window 20`.

---

## 18. Testing Strategy

### 18.1 Python Unit Tests

```python
# tests/test_feature_engineering.py
import pandas as pd
import numpy as np
import pytest
from anomaly_engine.features.signal_features import compute_signal_features


def _make_clean_signal(n: int = 50) -> pd.DataFrame:
    return pd.DataFrame({
        "timestamp":   pd.date_range("2024-01-01", periods=n, freq="10ms", tz="UTC"),
        "session_id":  ["sess1"] * n,
        "msg_id":      ["0x170"] * n,
        "signal_name": ["EngineSpeed"] * n,
        "value":       np.sin(np.linspace(0, 4 * np.pi, n)) * 500 + 1000,
    })


def test_z_score_near_zero_for_clean_signal():
    df = _make_clean_signal()
    result = compute_signal_features(df)
    assert result["z_score"].dropna().abs().mean() < 1.5


def test_z_score_high_for_spike():
    df = _make_clean_signal()
    df.loc[30, "value"] = 9999
    result = compute_signal_features(df)
    assert abs(result.iloc[31]["z_score"]) > 3.0


def test_feature_matrix_no_nans_after_warmup():
    df = _make_clean_signal(n=100)
    result = compute_signal_features(df, window=10).dropna(subset=["z_score"])
    assert result["z_score"].isna().sum() == 0
```

### 18.2 Integration Test — End-to-End Scoring

```python
# tests/test_scorer.py
from anomaly_engine.inference.window_buffer import WindowBuffer


def test_window_buffer_returns_none_before_warmup():
    buf = WindowBuffer(window=5)
    result = buf.get_features("s1", "0x170", "Speed", 100.0, 1000.0)
    assert result is None   # not enough history


def test_window_buffer_returns_features_after_warmup():
    buf = WindowBuffer(window=5)
    for i in range(6):
        buf.update("s1", "0x170", "Speed", 1000.0 + i, float(i * 10))
    result = buf.get_features("s1", "0x170", "Speed", 1006.0, 60.0)
    assert result is not None
    assert "z_score" in result
    assert "inter_arrival_ms" in result
```

### 18.3 Spring Boot Unit Test

```java
@ExtendWith(MockitoExtension.class)
class AnomalyServiceTest {

    @Mock AnomalyEventRepository repository;
    @Mock SimpMessagingTemplate messagingTemplate;

    private AnomalyService service;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        service = new AnomalyService(repository, mapper, messagingTemplate);
    }

    @Test
    @SneakyThrows
    void saveFromKafkaPayload_validJson_savesAndBroadcasts() {
        String json = """
            {"session_id":"sess1","msg_id":"0x170","score":0.91,
             "timestamp":1720000000.5,"top_signals":[{"name":"EngineSpeed","z_score":4.1}]}
            """;
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.saveFromKafkaPayload(json);

        verify(repository).save(argThat(e ->
                "sess1".equals(e.getSessionId()) && e.getScore() > 0.9f));
        verify(messagingTemplate).convertAndSend(
                contains("/topic/anomaly-events/sess1"),
                any(AnomalyEventDto.class));
    }
}
```

---

## 19. Implementation Checklist

Work through these phases in order. Do not skip.

### Data & EDA
- [ ] Download SynCAN → `anomaly_engine/data/public/syncan/`
- [ ] (Optional) Download Car-Hacking → `anomaly_engine/data/public/car_hacking/`
- [ ] Run EDA notebook — answer all 5 questions in Phase 0
- [ ] Write findings to `anomaly_engine/eda_notes.md`

### Python Module
- [ ] Create `python_parser/anomaly_engine/` package structure
- [ ] Implement `data/syncan_loader.py` — run it to produce raw Parquet files
- [ ] (Optional) Implement `data/car_hacking_loader.py`
- [ ] Implement `data/preprocessor.py` (uses `label_filter` param)
- [ ] Implement `features/signal_features.py`
- [ ] Implement `features/message_features.py`
- [ ] Implement `features/feature_matrix.py`
- [ ] Write unit tests for feature functions
- [ ] Run `syncan_loader.py`; verify Parquet output manually (check shape, dtypes, label counts)
- [ ] Implement `training/trainer.py`
- [ ] Implement `training/evaluator.py`
- [ ] Implement `training/model_selector.py`
- [ ] Implement `train.py` entrypoint
- [ ] Run first training pass; inspect `evaluation_report.json`
- [ ] (Optional) Add LSTM autoencoder if AUC < 0.8 on temporal anomalies
- [ ] Implement `inference/window_buffer.py`
- [ ] Implement `inference/scorer.py`
- [ ] Implement `detector.py`
- [ ] Write integration tests for scorer and detector
- [ ] Test with live simulator session — confirm `anomaly-events` messages appear in Kafka

### Spring Boot
- [ ] Add Flyway migration `V10__create_anomaly_events.sql`
- [ ] Create `AnomalyEventEntity.java`
- [ ] Create `AnomalyEventRepository.java`
- [ ] Create `AnomalyEventDto.java`
- [ ] Create `AnomalyService.java`
- [ ] Add `consumeAnomalyEvent` to `CanKafkaConsumer.java`
- [ ] Create `AnomalyController.java`
- [ ] Replace 501 stub in `CanController.java`
- [ ] Compile and start backend; verify endpoint returns data
- [ ] Write `AnomalyServiceTest.java`

### Angular
- [ ] Create `core/services/anomaly.service.ts`
- [ ] Add `subscribeToAnomalyAlerts()` to `LiveTelemetryService`
- [ ] Re-enable the Anomaly button in `can-workspace.component.ts`
- [ ] Add anomaly event table to sniffer
- [ ] Overlay anomaly markers on chart timeline

### MLOps
- [ ] Add `.gitignore` rules for `anomaly_engine/data/` and `anomaly_engine/models/`
- [ ] Document training command in `python_parser/README.md`
- [ ] Schedule first model retrain after collecting 20 clean sessions

---

## Prerequisites — Add to `python_parser/requirements.txt`

```txt
# Anomaly Detection Engine
scikit-learn>=1.4.0
joblib>=1.3.0
pandas>=2.0.0
numpy>=1.26.0
pyarrow>=14.0.0
scipy>=1.11.0
# Optional — only needed for LSTM autoencoder
torch>=2.1.0
```

---

*Last updated: 2026-06-18 — written against InfluxDB `ecu_telemetry` / `can_signals` schema
and Kafka topic layout from `KafkaTopicConfig.java`*

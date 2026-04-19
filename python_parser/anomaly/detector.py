"""
Layer 2 — Isolation Forest inference.
Loaded once at startup, scores every incoming frame.
"""

import os
import numpy as np
import joblib
from collections import defaultdict
from anomaly.feature_extractor import extract_features

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'anomaly_model.pkl')

class AnomalyDetector:
    def __init__(self):
        self._model = None
        self._prev_by_id = defaultdict(lambda: None)
        self._load_model()

    def _load_model(self):
        if os.path.exists(MODEL_PATH):
            self._model = joblib.load(MODEL_PATH)
            print(f"[INFO] Anomaly model loaded from {MODEL_PATH}")
        else:
            print(f"[WARN] No anomaly model found at {MODEL_PATH}. "
                  f"Run model_trainer.py first. Statistical detection disabled.")

    def score(self, frame: dict) -> dict | None:
        """
        Returns anomaly dict if statistical anomaly detected, else None.
        -1 from IsolationForest = anomaly, 1 = normal.
        """
        if self._model is None:
            return None

        fid = frame.get('frame_id', '0x0')
        features = extract_features(frame, self._prev_by_id[fid])
        self._prev_by_id[fid] = frame

        features_2d = features.reshape(1, -1)
        prediction = self._model.predict(features_2d)[0]
        score = self._model.score_samples(features_2d)[0]

        if prediction == -1:
            return {
                'type': 'STATISTICAL_ANOMALY',
                'severity': 'MEDIUM',
                'frame_id': fid,
                'detail': f'Isolation Forest flagged this frame '
                          f'(score: {score:.4f})',
                'anomaly_score': float(score),
                'timestamp': float(frame.get('timestamp', 0)),
            }
        return None

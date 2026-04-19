"""
Layer 2 — Train Isolation Forest on normal CAN log data.
Run this once: python anomaly/model_trainer.py <log_file.txt> [xml_files...]
Saves anomaly_model.pkl to python_parser/anomaly/
"""

import sys
import os
import json
import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from anomaly.feature_extractor import extract_features

def train(log_json_lines: list[str]) -> None:
    frames = []
    for line in log_json_lines:
        line = line.strip()
        if not line or line.startswith('__'):
            continue
        try:
            frames.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    if len(frames) < 10:
        print(f"[ERROR] Need at least 10 frames to train. Got {len(frames)}.")
        sys.exit(1)

    print(f"[INFO] Building feature vectors from {len(frames)} frames...")

    prev_by_id = defaultdict(lambda: None)
    X = []
    for frame in frames:
        fid = frame.get('frame_id', '0x0')
        features = extract_features(frame, prev_by_id[fid])
        X.append(features)
        prev_by_id[fid] = frame

    X = np.array(X)
    print(f"[INFO] Feature matrix shape: {X.shape}")

    model = IsolationForest(
        n_estimators=100,
        contamination=0.05,
        random_state=42,
        n_jobs=-1
    )
    model.fit(X)

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            'anomaly_model.pkl')
    joblib.dump(model, out_path)
    print(f"[INFO] Model saved to {out_path}")
    print(f"[INFO] Training complete. "
          f"Anomaly threshold (contamination): 5%")

if __name__ == '__main__':
    # Usage: run parser.py --stream on your log file first,
    # pipe or redirect output to a text file, then pass that here.
    # OR pass the raw log file and xml files directly.
    import subprocess

    script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser_path = os.path.join(script_dir, 'parser.py')

    if len(sys.argv) < 2:
        print("Usage: python anomaly/model_trainer.py <log_file.txt> "
              "[xml1.xml xml2.xml ...]")
        sys.exit(1)

    log_file = sys.argv[1]
    xml_files = sys.argv[2:] if len(sys.argv) > 2 else []

    cmd = [sys.executable, parser_path, '--stream', log_file] + xml_files
    print(f"[INFO] Running parser to get decoded frames...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    lines = result.stdout.strip().split('\n')
    train(lines)

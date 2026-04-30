import xml.etree.ElementTree as ET
import json
import re
import os
import sys
from pathlib import Path
from kafka import KafkaProducer, KafkaConsumer

try:
    from anomaly.rule_engine import check as rule_check
    from anomaly.detector import AnomalyDetector
    ANOMALY_ENABLED = True
except ImportError:
    ANOMALY_ENABLED = False
    print("[WARN] Anomaly detection modules not found. Skipping.", flush=True)


def get_ascii_metadata(log_path: Path) -> dict:
    """
    Fast metadata extraction from an ASCII CAN log file.
    Reads only the first 100 lines and last 8 KB to extract timestamps
    and channel info without full parsing.
    """
    frame_pattern = re.compile(
        r'^\s*(\d+\.\d+)\s+(\d+)\s+([\dA-Fa-fXx]+)\s+(Tx|Rx)\s+d\s+\d+'
    )
    channel_pattern = re.compile(r'^CAN\s+(\d+):\s*(.+)$')

    file_size = os.path.getsize(log_path)
    start_ts = 0.0
    end_ts = 0.0
    channel_names = []
    channels_seen = set()

    try:
        with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
            head_lines = []
            for i, line in enumerate(f):
                head_lines.append(line)
                if i >= 99:
                    break

        for line in head_lines:
            ch_match = channel_pattern.match(line.strip())
            if ch_match:
                ch_num = ch_match.group(1)
                ch_name = ch_match.group(2).strip()
                if ch_num not in channels_seen:
                    channels_seen.add(ch_num)
                    channel_names.append(ch_name)
            if start_ts == 0.0:
                fr_match = frame_pattern.match(line)
                if fr_match:
                    start_ts = float(fr_match.group(1))

        with open(log_path, 'rb') as f:
            f.seek(0, 2)
            file_end = f.tell()
            chunk_size = min(8192, file_end)
            f.seek(file_end - chunk_size)
            tail_bytes = f.read(chunk_size)

        tail_lines = tail_bytes.decode('utf-8', errors='replace').splitlines()
        for line in reversed(tail_lines):
            fr_match = frame_pattern.match(line)
            if fr_match:
                end_ts = float(fr_match.group(1))
                break

        return {
            "file_size": file_size,
            "start_ts": start_ts,
            "end_ts": end_ts,
            "channel_count": len(channels_seen) if channels_seen else 1,
            "channel_names": channel_names,
            "frame_count_estimate": max(0, file_size // 60),
            "format": "ascii",
        }

    except Exception as e:
        return {
            "file_size": file_size,
            "start_ts": 0.0,
            "end_ts": 0.0,
            "channel_count": 0,
            "channel_names": [],
            "frame_count_estimate": 0,
            "format": "ascii",
            "error": str(e),
        }


def create_kafka_producer():
    try:
        producer = KafkaProducer(
            bootstrap_servers=['localhost:9092'],
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            retries=3,
            request_timeout_ms=5000
        )
        return producer
    except Exception as e:
        print(f"[WARN] Kafka unavailable: {e}. Falling back to stdout mode.")
        return None


# ─── Error report collector ───────────────────────────────────────────────────

class ErrorReport:
    def __init__(self):
        self.parse_errors   = []   # malformed log lines
        self.invalid_signals = []  # undefined raw values
        self.xml_errors     = []   # XML loading issues

    def add_parse_error(self, line_num, content, reason):
        self.parse_errors.append({
            "line":    line_num,
            "content": content.strip(),
            "reason":  reason
        })

    def add_invalid_signal(self, frame_num, timestamp, signal, raw_value, reason):
        self.invalid_signals.append({
            "frame":     frame_num,
            "timestamp": timestamp,
            "signal":    signal,
            "rawValue":  raw_value,
            "reason":    reason
        })

    def add_xml_error(self, xml_path, reason):
        self.xml_errors.append({
            "file":   os.path.basename(xml_path),
            "reason": reason
        })

    def to_dict(self):
        return {
            "parseErrors":    self.parse_errors,
            "invalidSignals": self.invalid_signals,
            "xmlErrors":      self.xml_errors,
            "summary": {
                "parseErrorCount":    len(self.parse_errors),
                "invalidSignalCount": len(self.invalid_signals),
                "xmlErrorCount":      len(self.xml_errors)
            }
        }


# ─── XML parser ───────────────────────────────────────────────────────────────

def parse_bit_mask(bit_str):
    bit_str = bit_str.strip()
    mask  = 0
    shift = 0
    for ch in bit_str:
        mask <<= 1
        if ch == '1':
            mask |= 1
    for ch in reversed(bit_str):
        if ch == 'x':
            shift += 1
        else:
            break
    return mask, shift


def _parse_bit_pattern(pattern: str) -> tuple:
    """Return (mask, shift) for an eight-character x/1 bit layout string."""
    pat = pattern.strip()
    mask = 0
    for i, ch in enumerate(pat):
        if ch == "1":
            mask |= 1 << (7 - i)
    if mask == 0:
        return 0, 0
    low = mask & -mask
    shift = low.bit_length() - 1
    return mask, shift


def encode_frame(msg_id: str, signals_dict: dict, catalog: dict) -> list:
    """Pack signal values back into 8 raw bytes using bit positions from the XML catalog.

    Args:
        msg_id: CAN message ID string (e.g. '0X2FC')
        signals_dict: dict mapping signal name to integer value
        catalog: loaded catalog dict from load_xml_files()

    Returns:
        list of 8 ints with signal values packed into correct bit positions
    """
    raw = [0] * 8
    key = msg_id.strip().upper()
    if key not in catalog:
        return raw
    msg_def = catalog[key]
    for byte_num, signals in msg_def["bytes"].items():
        if byte_num >= 8:
            continue
        for sig in signals:
            sig_name = sig["signal"]
            if sig_name not in signals_dict:
                continue
            value = int(signals_dict[sig_name])
            packed = (value << sig["shift"]) & sig["mask"]
            raw[byte_num] |= packed
    return raw


def load_xml_files(xml_paths, report: ErrorReport = None):
    """
    Load all XML signal definition files.
    Skips files that fail to parse and logs the error.
    """
    if report is None:
        report = ErrorReport()
    db = {}
    for path in xml_paths:
        try:
            tree = ET.parse(path)
            root = tree.getroot()
            bus_name = root.get("Name", "Unknown")

            for msg in root.findall("massage"):
                msg_id   = msg.get("id", "").strip().upper()
                msg_name = msg.get("name", "").strip()
                bytes_map = {}

                for byte_el in msg.findall("Byte"):
                    byte_num_el = byte_el.find("Num")
                    if byte_num_el is None:
                        continue
                    try:
                        byte_num = int(byte_num_el.text.strip())
                    except (ValueError, AttributeError):
                        continue

                    signals = []
                    for sig_el in byte_el.findall("Signal"):
                        bit_attr = sig_el.get("Bit", "").strip()
                        try:
                            mask, shift = parse_bit_mask(bit_attr)
                        except Exception:
                            continue

                        name_el  = sig_el.find("signal_name")
                        sig_name = name_el.text.strip() if name_el is not None else "unknown"

                        val_map = {}
                        for v_el in sig_el.findall("values"):
                            values_list = v_el.findall("value")
                            names_list  = v_el.findall("name") or v_el.findall("n")
                            if len(values_list) > 1 or len(names_list) > 1:
                                # Format 2: multiple <value>/<name> pairs inside one <values> block
                                for vnode, nnode in zip(values_list, names_list):
                                    raw   = (vnode.text or "").strip()
                                    label = (nnode.text or "").strip()
                                    if not raw:
                                        continue
                                    if "..." in raw:
                                        val_map["range"] = label
                                    else:
                                        try:
                                            val_map[int(float(raw))] = label
                                        except ValueError:
                                            val_map[raw] = label
                            else:
                                # Format 1: single <value>/<name> per <values> block
                                val_node = v_el.find("value")
                                n_node   = v_el.find("name")
                                if n_node is None:
                                    n_node = v_el.find("n")
                                if val_node is not None and n_node is not None:
                                    raw   = (val_node.text or "").strip()
                                    label = (n_node.text or "").strip()
                                    if "..." in raw:
                                        val_map["range"] = label
                                    else:
                                        try:
                                            val_map[int(float(raw))] = label
                                        except ValueError:
                                            val_map[raw] = label

                        signals.append({
                            "signal":      sig_name,
                            "mask":        mask,
                            "shift":       shift,
                            "values":      val_map,
                            "bit_pattern": bit_attr
                        })

                    bytes_map[byte_num] = signals

                db[msg_id] = {
                    "bus":   bus_name,
                    "name":  msg_name,
                    "bytes": bytes_map
                }

        except ET.ParseError as e:
            report.add_xml_error(path, f"XML parse error: {str(e)}")
        except FileNotFoundError:
            report.add_xml_error(path, "File not found")
        except Exception as e:
            report.add_xml_error(path, f"Unexpected error: {str(e)}")

    return db


# ─── Log line parser ──────────────────────────────────────────────────────────

LOG_PATTERN = re.compile(
    r'^([\d.]+)\s+(\d+)\s+(0x[0-9A-Fa-f]+)\s+(\w+)\s+d\s+(\d+)\s+\[([^\]]+)\]'
)

def parse_log_line(line, line_num, report: ErrorReport):
    """
    Parse one log line. Returns frame dict or None if line should be skipped.
    Logs reason to error report on failure.
    """
    stripped = line.strip()

    # Skip known header lines silently
    if not stripped:
        return None
    if stripped.startswith("date") or stripped.startswith("CAN"):
        return None

    m = LOG_PATTERN.match(stripped)
    if not m:
        # Only report as error if it looks like it was trying to be a frame line
        if re.match(r'^[\d.]+\s+', stripped):
            report.add_parse_error(
                line_num, stripped,
                "Line matches timestamp pattern but failed full frame regex — possibly malformed"
            )
        return None

    try:
        timestamp = float(m.group(1))
        channel   = int(m.group(2))
        address   = m.group(3).upper()
        direction = m.group(4)
        dlc       = int(m.group(5))
        raw_bytes_str = m.group(6)

        raw_bytes = [int(b.strip()) for b in raw_bytes_str.split(",") if b.strip() != ""]

        # DLC mismatch check
        if len(raw_bytes) != dlc:
            report.add_parse_error(
                line_num, stripped,
                f"DLC={dlc} but {len(raw_bytes)} bytes found in data field"
            )
            # Still process — use what we have
            raw_bytes = raw_bytes[:dlc] + [0] * max(0, dlc - len(raw_bytes))

        return {
            "timestamp": timestamp,
            "channel":   channel,
            "address":   address,
            "direction": direction,
            "dlc":       dlc,
            "data":      raw_bytes
        }

    except (ValueError, IndexError) as e:
        report.add_parse_error(line_num, stripped, f"Value parse error: {str(e)}")
        return None


# ─── Frame decoder ────────────────────────────────────────────────────────────

def decode_frame(frame, db, frame_num, report: ErrorReport):
    address = frame["address"]

    if address not in db:
        return {
            "timestamp": frame["timestamp"],
            "channel":   frame["channel"],
            "address":   address,
            "direction": frame["direction"],
            "bus":       "Unknown",
            "message":   "Unknown",
            "signals":   {},
            "raw_data":  frame["data"]
        }

    msg_def = db[address]
    data    = frame["data"]
    decoded_signals = {}

    for byte_num, signals in msg_def["bytes"].items():
        if byte_num >= len(data):
            continue
        byte_val = data[byte_num]
        bits     = format(byte_val, '08b')

        for sig in signals:
            try:
                extracted = (byte_val & sig["mask"]) >> sig["shift"]
                val_map   = sig["values"]
                all_states = {k: v for k, v in val_map.items() if k != "range"}

                if "range" in val_map:
                    label    = f"{extracted} ({val_map['range']})"
                    is_valid = True
                elif val_map.get(str(extracted)) is not None or extracted in val_map:
                    label    = val_map.get(str(extracted)) or val_map.get(extracted)
                    is_valid = True
                else:
                    label    = f"Unknown({extracted})"
                    is_valid = False
                    report.add_invalid_signal(
                        frame_num,
                        frame["timestamp"],
                        sig["signal"],
                        extracted,
                        f"Raw value {extracted} not defined in XML states for signal '{sig['signal']}'"
                    )

                decoded_signals[sig["signal"]] = {
                    "raw_value":   extracted,
                    "label":       label,
                    "is_valid":    is_valid,
                    "all_states":  all_states,
                    "byte":        byte_num,
                    "bit_pattern": sig["bit_pattern"],
                    "byte_binary": bits
                }

            except Exception as e:
                report.add_parse_error(
                    -1,
                    f"frame {frame_num} signal {sig.get('signal', '?')}",
                    f"Signal decode error: {str(e)}"
                )

    return {
        "timestamp": frame["timestamp"],
        "channel":   frame["channel"],
        "address":   address,
        "direction": frame["direction"],
        "bus":       msg_def["bus"],
        "message":   msg_def["name"],
        "signals":   decoded_signals,
        "raw_data":  data
    }


# ─── Raw-frame iterators (format-agnostic) ────────────────────────────────────

def _iter_ascii_frames(log_path, report: ErrorReport):
    """Yield raw frame dicts from an ASCII CAN log (.txt / .log / .asc)."""
    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
        for line_num, line in enumerate(f, start=1):
            frame = parse_log_line(line, line_num, report)
            if frame is not None:
                yield frame


def _iter_blf_frames(log_path, report: ErrorReport):
    """
    Yield raw frame dicts from a Vector BLF file using python-can.
    Timestamps are normalized to seconds relative to the first frame.
    Requires:  pip install python-can
    """
    try:
        import can
    except ImportError:
        raise RuntimeError(
            "python-can is required for .blf files.  "
            "Install it with:  pip install python-can"
        )

    base_ts = None
    try:
        with can.BLFReader(str(log_path)) as reader:
            for msg in reader:
                if msg.is_error_frame or msg.is_remote_frame:
                    continue

                # Normalize to relative timestamps
                if base_ts is None:
                    base_ts = msg.timestamp
                ts = round(msg.timestamp - base_ts, 6)

                # Normalise channel to int (BLF may give "CAN 1", "1", or None)
                ch = msg.channel
                if isinstance(ch, str):
                    digits = "".join(filter(str.isdigit, ch))
                    ch = int(digits) if digits else 1
                elif ch is None:
                    ch = 1
                else:
                    ch = int(ch)

                # Upper-case the whole string so "0X1A2" matches catalog keys
                # produced by load_xml_files (which calls .upper() on XML ids).
                yield {
                    "timestamp": ts,
                    "channel":   ch,
                    "address":   f"0x{msg.arbitration_id:03X}".upper(),
                    "direction": "Rx",
                    "dlc":       msg.dlc,
                    "data":      list(msg.data),
                }
    except Exception as e:
        report.add_parse_error(0, str(log_path), f"BLF read error: {e}")
        raise


def _iter_raw_frames(log_path, report: ErrorReport):
    """
    Dispatch to the correct reader based on file extension.
    Yields raw frame dicts consumable by decode_frame().
    """
    ext = Path(log_path).suffix.lower()
    if ext == ".blf":
        yield from _iter_blf_frames(log_path, report)
    else:
        yield from _iter_ascii_frames(log_path, report)


# ─── Batch mode ───────────────────────────────────────────────────────────────

def process_log_file(log_path, xml_paths):
    """
    Batch mode — decodes all frames, writes decoded_frames.json and error_report.json.
    Always resolves log_path to an absolute path so that os.path.dirname
    returns the correct output directory even when called with a relative path.
    """
    # Force absolute path so output files always land next to the log file,
    # regardless of the working directory the script was launched from.
    log_path = os.path.abspath(log_path)

    report = ErrorReport()
    db     = load_xml_files(xml_paths, report)
    results = []
    frame_num = 0

    try:
        for frame in _iter_raw_frames(log_path, report):
            frame_num += 1
            decoded = decode_frame(frame, db, frame_num, report)
            results.append(decoded)
    except FileNotFoundError:
        print(json.dumps({"error": f"Log file not found: {log_path}"}), flush=True)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error reading log file: {str(e)}"}), flush=True)
        sys.exit(1)

    # Write decoded frames
    out_dir   = os.path.dirname(log_path)
    out_path  = os.path.join(out_dir, "decoded_frames.json")
    err_path  = os.path.join(out_dir, "error_report.json")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    with open(err_path, "w", encoding="utf-8") as f:
        json.dump(report.to_dict(), f, indent=2)

    print(f"Decoded {frame_num} frames -> {out_path}")
    print(f"Error report -> {err_path}")
    return results, report.to_dict()


# ─── Streaming mode ───────────────────────────────────────────────────────────

_prev_frames = {}
_detector = AnomalyDetector() if ANOMALY_ENABLED else None


def stream_log_file(log_path, xml_paths, producer=None):
    """
    Streaming mode — prints each decoded frame as one JSON line immediately.
    Spring Boot reads stdout line by line and forwards each as an SSE event.
    At the end prints the error report as a special __ERRORS__ line.
    If a Kafka producer is supplied, each frame is also published to
    'can-frames-decoded' (additive — stdout behavior is unchanged).
    """
    log_path = os.path.abspath(log_path)

    report = ErrorReport()
    db     = load_xml_files(xml_paths, report)
    frame_num = 0

    # Signal to Spring Boot that XML loading is done and frames are about to start.
    # Spring Boot forwards this as a "ready" SSE event (duplicate of the Java-side one,
    # but this one fires after XML parsing so it's a more accurate "first frame incoming"
    # signal on large catalogs).
    print("__READY__", flush=True)

    try:
        for frame in _iter_raw_frames(log_path, report):
            frame_num += 1
            decoded = decode_frame(frame, db, frame_num, report)
            print(json.dumps(decoded), flush=True)
            if producer:
                try:
                    producer.send('can-frames-decoded', value=decoded)
                except Exception as e:
                    print(f"[WARN] Kafka send failed: {e}", flush=True)

            # Layer 1 + 2 anomaly detection
            if ANOMALY_ENABLED and producer:
                # Map parser field names to anomaly module field names
                anomaly_frame = {
                    'frame_id':  decoded.get('address', '0x0'),
                    'channel':   decoded.get('channel', 0),
                    'timestamp': decoded.get('timestamp', 0),
                    'raw_bytes': decoded.get('raw_data', [0, 0, 0, 0, 0, 0, 0, 0]),
                    'signals':   decoded.get('signals', {}),
                }
                fid = anomaly_frame['frame_id']
                prev = _prev_frames.get(fid)

                # Layer 1 — rule engine
                rule_alerts = rule_check(anomaly_frame, prev)
                for alert in rule_alerts:
                    alert['source'] = 'RULE_ENGINE'
                    try:
                        producer.send('can-frames-anomalies', value=alert)
                    except Exception as e:
                        print(f"[WARN] Kafka anomaly send failed: {e}", flush=True)

                # Layer 2 — statistical
                stat_alert = _detector.score(anomaly_frame)
                if stat_alert:
                    stat_alert['source'] = 'ISOLATION_FOREST'
                    try:
                        producer.send('can-frames-anomalies', value=stat_alert)
                    except Exception as e:
                        print(f"[WARN] Kafka anomaly send failed: {e}", flush=True)

                _prev_frames[fid] = anomaly_frame

    except FileNotFoundError:
        print(json.dumps({"error": f"Log file not found: {log_path}"}), flush=True)
        print("__END__", flush=True)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error: {str(e)}"}), flush=True)

    # Send error report before signaling end
    print(f"__ERRORS__{json.dumps(report.to_dict())}", flush=True)
    print("__END__", flush=True)


# ─── Worker mode ─────────────────────────────────────────────────────────────

def worker_mode(xml_paths):
    """
    Persistent worker mode — loads XML catalog once, then processes jobs from
    stdin in a loop. Spring Boot keeps this process alive across requests,
    eliminating the Python startup + XML-load cold start on every request.

    Modelled after file_worker.py's FileProcessingWorker._process_job pattern:
    per-job error isolation, processed/error counters, graceful EOF handling.

    Protocol
    --------
    stdin  ← one JSON line per job:
               {"log_path": "/abs/path/to/file.txt", "mode": "batch|stream"}
    stdout → decoded frame JSON lines, then:
               __ERRORS__{...json...}
               __END__
             (worker waits for the next job; exits cleanly on stdin EOF)
    """
    init_report = ErrorReport()
    db = load_xml_files(xml_paths, init_report)

    for err in init_report.xml_errors:
        print(f"[WORKER] XML error: {err['file']}: {err['reason']}",
              file=sys.stderr, flush=True)

    # Signal Java that XML catalog is loaded and worker is ready for jobs.
    # Spring Boot's launchWorkerProcess() blocks until it sees this line.
    print("__READY__", flush=True)

    processed_count = 0
    error_count     = 0

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        try:
            job = json.loads(raw_line)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid job JSON: {e}"}), flush=True)
            print("__END__", flush=True)
            error_count += 1
            continue

        log_path   = os.path.abspath(job.get("log_path", ""))
        job_report = ErrorReport()
        frame_num  = 0

        # ── process one job (mirrors file_worker.py _process_job) ──────────
        try:
            for frame in _iter_raw_frames(log_path, job_report):
                frame_num += 1
                decoded = decode_frame(frame, db, frame_num, job_report)
                print(json.dumps(decoded), flush=True)
            processed_count += 1

        except FileNotFoundError:
            print(json.dumps({"error": f"Log file not found: {log_path}"}),
                  flush=True)
            error_count += 1

        except Exception as e:
            print(json.dumps({"error": f"Error processing file: {str(e)}"}),
                  flush=True)
            error_count += 1

        # Always send the error report and end-of-job sentinel so Java never
        # hangs waiting for __END__ even when a job fails mid-stream.
        print(f"__ERRORS__{json.dumps(job_report.to_dict())}", flush=True)
        print("__END__", flush=True)

    # stdin closed — Java process has shut down; log summary to stderr
    print(
        f"[WORKER] Exiting — processed: {processed_count}, errors: {error_count}",
        file=sys.stderr, flush=True,
    )


# ─── Kafka async worker mode ──────────────────────────────────────────────────

def kafka_worker_mode(xml_paths):
    """
    Kafka async worker mode — loads the XML catalog once, then listens on the
    'file-processing-jobs' topic for analysis jobs published by the Spring Boot
    backend (POST /api/analyze/async).

    For each job it:
      1. Decodes the CAN log file.
      2. Publishes each decoded frame to 'can-frames-decoded' (key = sessionId).
      3. Sends periodic progress events to 'log-file-events' (key = sessionId).
      4. Sends a final 'done' event with the error report.

    Spring Boot's AsyncAnalysisConsumer picks up those Kafka messages and
    forwards them to the Angular client via per-session WebSocket topics:
      /topic/async-frames/{sessionId}
      /topic/async-progress/{sessionId}

    Job message schema (published by AnalysisController):
      {"sessionId": "...", "filePath": "/abs/path/to/file", "sourceFilename": "..."}
    """
    bootstrap = ['localhost:9092']

    # ── Init XML catalog ─────────────────────────────────────────────────────
    init_report = ErrorReport()
    db = load_xml_files(xml_paths, init_report)
    xml_names = [os.path.basename(p) for p in xml_paths]
    for err in init_report.xml_errors:
        print(f"[KAFKA-WORKER] XML error: {err['file']}: {err['reason']}",
              file=sys.stderr, flush=True)

    # ── Kafka clients ─────────────────────────────────────────────────────────
    consumer = KafkaConsumer(
        'file-processing-jobs',
        bootstrap_servers=bootstrap,
        group_id='python-file-workers',
        value_deserializer=lambda v: json.loads(v.decode('utf-8')),
        auto_offset_reset='earliest',
        enable_auto_commit=True,
        consumer_timeout_ms=-1,   # block forever
    )

    producer = KafkaProducer(
        bootstrap_servers=bootstrap,
        key_serializer=lambda k: k.encode('utf-8') if isinstance(k, str) else k,
        value_serializer=lambda v: json.dumps(v).encode('utf-8'),
        retries=3,
        request_timeout_ms=10_000,
    )

    print("[KAFKA-WORKER] Ready — waiting for jobs on 'file-processing-jobs'...", flush=True)

    for message in consumer:
        job        = message.value
        session_id = job.get('sessionId')
        file_path  = job.get('filePath')
        source_fn  = job.get('sourceFilename', 'unknown.txt')

        if not session_id or not file_path:
            print(f"[KAFKA-WORKER] Skipping malformed job: {job}", file=sys.stderr, flush=True)
            continue

        print(f"[KAFKA-WORKER] Processing job {session_id}: {file_path}", flush=True)

        job_report = ErrorReport()
        frame_num  = 0

        try:
            # Notify client that processing has started
            producer.send('log-file-events', key=session_id, value={
                'event':          'started',
                'sessionId':      session_id,
                'sourceFilename': source_fn,
            })

            # Publish session metadata
            producer.send('session-meta', key=session_id, value={
                'sessionId':    session_id,
                'sourceFilename': source_fn,
                'xmlFilesUsed': xml_names,
            })

            for frame in _iter_raw_frames(Path(file_path), job_report):
                frame_num += 1
                decoded = decode_frame(frame, db, frame_num, job_report)
                producer.send('can-frames-decoded', key=session_id, value=decoded)

                # Send a progress event every 100 frames so the client can show a counter
                if frame_num % 100 == 0:
                    producer.send('log-file-events', key=session_id, value={
                        'event':     'progress',
                        'sessionId': session_id,
                        'processed': frame_num,
                    })

            producer.flush()

            # Final done event — includes the full error report
            producer.send('log-file-events', key=session_id, value={
                'event':       'done',
                'sessionId':   session_id,
                'frameCount':  frame_num,
                'errorReport': job_report.to_dict(),
            })
            producer.flush()

            print(f"[KAFKA-WORKER] Done {session_id}: {frame_num} frames", flush=True)

        except FileNotFoundError:
            print(f"[KAFKA-WORKER] File not found for job {session_id}: {file_path}",
                  file=sys.stderr, flush=True)
            producer.send('log-file-events', key=session_id, value={
                'event':     'error',
                'sessionId': session_id,
                'message':   f"File not found: {file_path}",
            })
            producer.flush()

        except Exception as e:
            print(f"[KAFKA-WORKER] Error in job {session_id}: {e}",
                  file=sys.stderr, flush=True)
            try:
                producer.send('log-file-events', key=session_id, value={
                    'event':     'error',
                    'sessionId': session_id,
                    'message':   str(e),
                })
                producer.flush()
            except Exception:
                pass


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    worker_mode_flag  = "--worker"        in sys.argv
    kafka_worker_flag = "--kafka-worker"  in sys.argv
    metadata_mode     = "--metadata"      in sys.argv
    stream_mode       = "--stream"        in sys.argv
    args = [a for a in sys.argv[1:]
            if a not in ("--stream", "--metadata", "--worker", "--kafka-worker")]

    def _auto_discover_xml():
        script_dir = os.path.dirname(os.path.abspath(__file__))
        found = [
            os.path.join(script_dir, f)
            for f in os.listdir(script_dir)
            if f.endswith(".xml")
        ]
        if not found:
            print(json.dumps({"error": "No XML files found in python_parser/ directory"}), flush=True)
            sys.exit(1)
        return found

    # ── Kafka async worker mode — long-running Kafka consumer/producer ────────
    if kafka_worker_flag:
        XML_FILES = args if args else _auto_discover_xml()
        kafka_worker_mode(XML_FILES)
        sys.exit(0)

    # ── Worker mode — no log file arg, XML files are positional ──────────────
    if worker_mode_flag:
        XML_FILES = args if args else _auto_discover_xml()
        worker_mode(XML_FILES)
        sys.exit(0)

    # ── All other modes require a log file as first positional arg ────────────
    if len(args) < 1:
        print("Usage: parser.py [--stream|--metadata|--worker] <log_file> [xml_file1 ...]")
        sys.exit(1)

    LOG_FILE  = args[0]
    XML_FILES = args[1:] if len(args) > 1 else []

    if metadata_mode:
        meta = get_ascii_metadata(Path(LOG_FILE))
        print(json.dumps(meta), flush=True)
        sys.exit(0)

    # If no XML files provided via args, auto-discover from same directory as script
    if not XML_FILES:
        XML_FILES = _auto_discover_xml()

    producer = create_kafka_producer()

    if stream_mode:
        stream_log_file(LOG_FILE, XML_FILES, producer=producer)
    else:
        process_log_file(LOG_FILE, XML_FILES)

    if producer is not None:
        producer.flush()
import xml.etree.ElementTree as ET
import json
import re
import os
import sys


def parse_bit_mask(bit_str):
    bit_str = bit_str.strip()
    mask = 0
    for ch in bit_str:
        mask <<= 1
        if ch == '1':
            mask |= 1
    shift = 0
    for ch in reversed(bit_str):
        if ch == 'x':
            shift += 1
        else:
            break
    return mask, shift


def load_xml_files(xml_paths):
    db = {}
    for path in xml_paths:
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
                byte_num = int(byte_num_el.text.strip())
                signals = []

                for sig_el in byte_el.findall("Signal"):
                    bit_attr = sig_el.get("Bit", "").strip()
                    mask, shift = parse_bit_mask(bit_attr)

                    name_el  = sig_el.find("signal_name")
                    sig_name = name_el.text.strip() if name_el is not None else "unknown"

                    val_map = {}
                    for v_el in sig_el.findall("values"):
                        val_node = v_el.find("value")
                        n_node   = v_el.find("n") or v_el.find("name")
                        if val_node is not None and n_node is not None:
                            raw   = val_node.text.strip()
                            label = n_node.text.strip()
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

    return db


def parse_log_line(line):
    line = line.strip()
    if not line or line.startswith("date") or line.startswith("CAN"):
        return None

    pattern = r'^([\d.]+)\s+(\d+)\s+(0x[0-9A-Fa-f]+)\s+(\w+)\s+d\s+(\d+)\s+\[([^\]]+)\]'
    m = re.match(pattern, line)
    if not m:
        return None

    return {
        "timestamp": float(m.group(1)),
        "channel":   int(m.group(2)),
        "address":   m.group(3).upper(),
        "direction": m.group(4),
        "dlc":       int(m.group(5)),
        "data":      [int(b.strip()) for b in m.group(6).split(",") if b.strip() != ""]
    }


def decode_frame(frame, db):
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

    msg_def  = db[address]
    data     = frame["data"]
    decoded_signals = {}

    for byte_num, signals in msg_def["bytes"].items():
        if byte_num >= len(data):
            continue
        byte_val = data[byte_num]
        bits     = format(byte_val, '08b')

        for sig in signals:
            extracted = (byte_val & sig["mask"]) >> sig["shift"]
            val_map   = sig["values"]

            # Build all_states: only the XML-defined numeric states
            # (excludes the special 'range' key used for numeric ranges)
            all_states = {k: v for k, v in val_map.items() if k != "range"}

            # Determine label and validity
            if "range" in val_map:
                # Numeric range signal (e.g. Key_ID) — always valid
                label    = f"{extracted} ({val_map['range']})"
                is_valid = True
            elif extracted in val_map:
                # Known categorical state
                label    = val_map[extracted]
                is_valid = True
            else:
                # Value not defined in XML — show in table but don't plot
                label    = f"Unknown({extracted})"
                is_valid = False

            decoded_signals[sig["signal"]] = {
                "raw_value":   extracted,
                "label":       label,
                "is_valid":    is_valid,        # NEW: frontend uses this for hold-previous
                "all_states":  all_states,      # NEW: frontend uses this for Y-axis labels
                "byte":        byte_num,
                "bit_pattern": sig["bit_pattern"],
                "byte_binary": bits
            }

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


def process_log_file(log_path, xml_paths):
    print(f"Loading XML files: {xml_paths}")
    db = load_xml_files(xml_paths)
    print(f"Loaded {len(db)} message definitions: {list(db.keys())}")

    results = []
    with open(log_path, "r") as f:
        for line in f:
            frame = parse_log_line(line)
            if frame is None:
                continue
            decoded = decode_frame(frame, db)
            results.append(decoded)

    print(f"Processed {len(results)} frames total.")
    return results


def print_results(results):
    for r in results:
        print(f"\n{'='*60}")
        print(f"Timestamp : {r['timestamp']}")
        print(f"Address   : {r['address']}  |  Bus: {r['bus']}  |  Message: {r['message']}")
        print(f"Direction : {r['direction']}  |  Raw: {r['raw_data']}")
        if r["signals"]:
            print("Signals:")
            for sig_name, info in r["signals"].items():
                valid_marker = "OK " if info["is_valid"] else "???"
                print(f"  [{info['byte']}] {valid_marker} {sig_name:40s} -> {info['label']}  (raw={info['raw_value']})")
        else:
            print("  No signals defined for this address.")


if __name__ == "__main__":
    LOG_FILE  = "log file.txt"
    XML_FILES = ["car_can.xml", "key_can.xml"]

    if len(sys.argv) >= 3:
        LOG_FILE  = sys.argv[1]
        XML_FILES = sys.argv[2:]

    results = process_log_file(LOG_FILE, XML_FILES)
    print_results(results)

    out_dir  = os.path.dirname(LOG_FILE) if (len(sys.argv) >= 3) else ""
    out_path = os.path.join(out_dir, "decoded_frames.json") if out_dir else "decoded_frames.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved {len(results)} decoded frames to {out_path}")
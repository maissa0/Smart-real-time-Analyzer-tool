"""Load CAN message catalogs from XML and decode raw frame bytes to signals."""

from __future__ import annotations

import logging
from pathlib import Path

# defusedxml.ElementTree is a drop-in replacement for xml.etree.ElementTree that guards
# against entity-expansion attacks (billion laughs, quadratic blowup, external entity/DTD
# resolution) — xml.etree.ElementTree has no such hardening per the stdlib's own docs.
import defusedxml.ElementTree as ET

from models import DecodedSignal, MessageDefinition, SignalDefinition


def _msg_id_key(msg_id: str) -> str:
    """Normalize a hex CAN id string to a single catalog key form."""
    t = msg_id.strip()
    if len(t) >= 2 and t[0] in "0" and t[1] in "xX":
        return "0x" + t[2:].upper()
    return t.upper()


def _parse_cycle_ms(msg_el) -> int | None:
    """Read <Cyclic><status>true</status><cycle>N</cycle></Cyclic> — mirrors
    CatalogLoaderService.java's parsing so simulator pacing matches the same
    per-message cadence the backend's integrity analyzer expects."""
    cyclic_el = msg_el.find("Cyclic")
    if cyclic_el is None:
        return None
    status_el = cyclic_el.find("status")
    status_text = (status_el.text or "").strip().lower() if status_el is not None else ""
    if status_text != "true":
        return None
    cycle_el = cyclic_el.find("cycle")
    cycle_text = (cycle_el.text or "").strip() if cycle_el is not None else ""
    if not cycle_text:
        return None
    try:
        return int(cycle_text)
    except ValueError:
        return None


def _parse_bit_pattern(pattern: str) -> tuple[int, int]:
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


def load_catalog(
    catalogue_dir: Path,
    only_files: set[str] | None = None,
) -> dict[str, MessageDefinition]:
    """Load XML files from catalogue_dir and merge into one message catalog.

    Args:
        catalogue_dir: directory containing the bus XML files.
        only_files: optional set of basenames (e.g. {"powertrain_can.xml"}); when
            given, only those files are loaded — used for per-car catalog subsets.
    """
    catalog: dict[str, MessageDefinition] = {}
    wanted = {f.strip().lower() for f in only_files} if only_files else None
    for path in sorted(Path(catalogue_dir).glob("*.xml")):
        if wanted is not None and path.name.lower() not in wanted:
            continue
        try:
            tree = ET.parse(path)
        except ET.ParseError as e:
            logging.error("XML parse error in %s: %s — skipping file", path, e)
            continue
        except OSError as e:
            logging.error("Cannot read XML file %s: %s — skipping file", path, e)
            continue
        root = tree.getroot()
        if root.tag == "Bus":
            buses = [root]
        else:
            buses = root.findall(".//Bus")
        for bus in buses:
            bus_name = bus.get("Name", "").strip()
            for msg_el in bus.findall("massage"):
                raw_id = msg_el.get("id", "").strip()
                msg_name = msg_el.get("name", "").strip()
                key = _msg_id_key(raw_id)
                cycle_ms = _parse_cycle_ms(msg_el)
                signals_out: list[SignalDefinition] = []
                for byte_el in msg_el.findall("Byte"):
                    num_el = byte_el.find("Num")
                    if num_el is not None:
                        byte_num = int((num_el.text or "0").strip())
                    elif byte_el.get("Num") is not None:
                        byte_num = int(str(byte_el.get("Num")).strip())
                    else:
                        byte_num = 0
                    for sig_el in byte_el.findall("Signal"):
                        bit_pat = sig_el.get("Bit", "") or ""
                        mask, shift = _parse_bit_pattern(bit_pat)
                        name_el = sig_el.find("signal_name")
                        signal_name = (name_el.text or "").strip() if name_el is not None else ""
                        value_map: dict[str, str] = {}
                        for vel in sig_el.findall("values"):
                            values_list = vel.findall("value")
                            names_list = vel.findall("name")
                            if len(values_list) > 1 or len(names_list) > 1:
                                # Format 2: multiple <value>/<name> pairs inside one <values> block
                                for v_el, n_el in zip(values_list, names_list):
                                    v_text = (v_el.text or "").strip()
                                    n_text = (n_el.text or "").strip()
                                    if v_text:
                                        value_map[v_text] = n_text
                            else:
                                # Format 1: single <value> and <name> per <values> block
                                v_el = vel.find("value")
                                n_el = vel.find("name")
                                v_text = (v_el.text if v_el is not None else "") or ""
                                n_text = (n_el.text if n_el is not None else "") or ""
                                value_map[v_text.strip()] = n_text.strip()
                        signals_out.append(
                            SignalDefinition(
                                byte_num=byte_num,
                                signal_name=signal_name,
                                mask=mask,
                                shift=shift,
                                value_map=value_map,
                            )
                        )
                existing = catalog.get(key)
                if existing is not None:
                    # Merge only a continuation of the SAME message (same bus and
                    # name, e.g. split across files). Two different messages that
                    # collide on an ID must not be silently merged — that corrupts
                    # both layouts. Keep the first definition and log the conflict.
                    if existing.bus_name == bus_name and existing.msg_name == msg_name:
                        existing.signals.extend(signals_out)
                        if existing.cycle_ms is None:
                            existing.cycle_ms = cycle_ms
                    else:
                        logging.error(
                            "Catalog ID collision: %s already defined as %s/%s, "
                            "ignoring conflicting definition %s/%s in %s",
                            key, existing.bus_name, existing.msg_name,
                            bus_name, msg_name, path.name,
                        )
                else:
                    catalog[key] = MessageDefinition(
                        msg_id=key,
                        msg_name=msg_name,
                        bus_name=bus_name,
                        signals=list(signals_out),
                        cycle_ms=cycle_ms,
                    )
    return catalog


def decode_frame(
    msg_id: str,
    data_bytes: list[int],
    catalog: dict[str, MessageDefinition],
) -> list[DecodedSignal]:
    """Decode one frame's payload using the catalog; returns empty list if msg id unknown."""
    key = _msg_id_key(msg_id)
    msg_def = catalog.get(key)
    if msg_def is None:
        return []
    out: list[DecodedSignal] = []
    for sig in msg_def.signals:
        if sig.byte_num < 0 or sig.byte_num >= len(data_bytes):
            continue
        raw = (data_bytes[sig.byte_num] & sig.mask) >> sig.shift
        label = sig.value_map.get(str(raw), f"raw:{raw}")
        out.append(DecodedSignal(signal_name=sig.signal_name, raw_value=raw, label=label))
    return out


def encode_frame(msg_id: str, signals: list, catalog: dict) -> list[int]:
    """Encode a list of DecodedSignal back into 8 raw bytes using catalog bit masks.

    This is the reverse of decode_frame — takes decoded signal values and packs
    them into the correct bit positions in an 8-byte CAN payload.

    Args:
        msg_id: CAN message ID string (e.g. "0x2FC")
        signals: list of DecodedSignal with raw_value set
        catalog: loaded catalog dict from load_catalog()

    Returns:
        list[int] of 8 bytes with signal values packed into correct bit positions
    """
    raw = [0] * 8
    key = _msg_id_key(msg_id)
    if key not in catalog:
        return raw
    msg_def = catalog[key]
    # Build a lookup from signal_name -> raw_value from the provided signals
    signal_values = {sig.signal_name: sig.raw_value for sig in signals}
    for sig_def in msg_def.signals:
        if sig_def.signal_name not in signal_values:
            continue
        if sig_def.byte_num >= 8:
            continue
        raw_value = signal_values[sig_def.signal_name]
        # Pack value into the correct bit position using mask and shift
        packed = (int(raw_value) << sig_def.shift) & sig_def.mask
        raw[sig_def.byte_num] |= packed
    return raw


if __name__ == "__main__":
    base = Path(__file__).resolve().parent / "catalogues"
    cat = load_catalog(base)
    print(f"Total messages loaded: {len(cat)}")
    for mid in sorted(cat.keys()):
        m = cat[mid]
        print(f"  {m.msg_name} ({mid}): {len(m.signals)} signal(s)")

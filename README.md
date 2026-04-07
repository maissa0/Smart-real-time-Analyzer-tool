# Smart Real-Time CAN Analyzer

## Overview

A full-stack web application for decoding, visualizing, and analyzing CAN (Controller Area Network) bus log files. The system parses raw CAN frames from log files, decodes signal values using XML-based signal definitions, and presents the results as an interactive table and a set of time-series step charts — one per signal or per group of signals sharing the same state space.

---

## Project Structure

```
smart-analyzer/
├── frontend/                        Angular 21 SPA
│   └── src/app/dashboard/
│       ├── dashboard.component.ts   Main component — logic, charts, state
│       ├── dashboard.component.html Template — layout, table, charts, overlay
│       └── dashboard.component.css  Styling — KPIT dark dashboard theme
│
├── smart-analyzer-backend/          Spring Boot 4 REST API
│   └── src/.../controller/
│       └── AnalysisController.java  Two endpoints: batch + SSE streaming
│
├── python_parser/
│   └── parser.py                    CAN frame parser and signal decoder
│
└── uploads/                         Temp directory (created at runtime)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21, TypeScript, Chart.js 4, chartjs-plugin-zoom |
| Backend | Java 17, Spring Boot 4, Spring Web MVC, SseEmitter |
| Parser | Python 3, xml.etree.ElementTree, re, json |
| Styling | Custom CSS — dark glassmorphism, KPIT/embedded-systems aesthetic |
| Auth | Spring Security + JWT (jjwt 0.12.6) |
| Database | MySQL (user management only) |

---

## Architecture

### Data Flow — Batch Mode (current default)

```
User uploads .txt log + .xml files
        │
        ▼
Angular POST /api/analyze (multipart/form-data)
        │
        ▼
Spring Boot saves files to temp dir
        │
        ▼
Spring Boot spawns Python process:
  python3 parser.py <log_path> <xml_path1> <xml_path2> ...
        │
        ▼
Python writes decoded_frames.json to temp dir
        │
        ▼
Spring Boot reads JSON, returns List<Map> via HTTP 200
        │
        ▼
Angular maps response → ParsedFrame[] array
        │
        ├──► Table view: rendered via *ngFor (all frames always expanded)
        │
        └──► Charts view: Chart.js step charts grouped by message
```

### Data Flow — Streaming Mode (built, not yet wired as default)

```
User uploads .txt log + .xml files
        │
        ▼
Angular POST /api/analyze-stream (multipart/form-data)
        │
        ▼
Spring Boot returns SseEmitter immediately
        │
        ▼
Spring Boot spawns Python with --stream flag in background thread
        │
        ▼
Python prints each decoded frame as one JSON line (flush=True)
Python prints "__END__" when done
        │
        ▼
Spring Boot reads stdout line by line → sends each as SSE event "frame"
        │
        ▼
Angular receives events via Fetch API + ReadableStream
        │
        ├──► Each frame: appended to table immediately (Angular CD)
        │
        └──► Each frame: data point pushed to Chart.js dataset
             chart.update('none') called every 100ms (throttled)
```

---

## Log File Format

```
date Wed Mar 11 13:07:53 2026
CAN 1: Car_CAN
CAN 2: Key_CAN
1773230879.890181  2 0x2FC Rx d 8 [1, 0, 0, 0, 0, 0, 0, 0]
1773230880.164613  2 0x23A Rx d 8 [0, 0, 0, 0, 0, 0, 0, 0]
...
```

**Field layout per frame line:**
```
<unix_timestamp>  <channel>  <hex_id>  <direction>  d  <dlc>  [<bytes>]
```

| Field | Description |
|---|---|
| unix_timestamp | Absolute Unix epoch time with microsecond precision |
| channel | CAN bus channel number (1 = Car_CAN, 2 = Key_CAN in this project) |
| hex_id | CAN message ID in hex (e.g. 0x2FC) |
| direction | Rx (received) or Tx (transmitted) |
| d | Literal — indicates data frame |
| dlc | Data Length Code — number of bytes |
| bytes | Comma-separated decimal byte values |

Header lines (`date`, `CAN N:`) are skipped by the parser.

---

## XML Signal Definition Format

Each XML file defines one CAN bus. The root element is `<Bus Name="...">`. Messages are `<massage>` elements (note: typo in source XML — kept as-is for compatibility).

```xml
<Bus Name="Car_CAN">
  <massage name="Car_Status" id="0x2FC">
    <Byte>
      <Num>0</Num>
      <Signal Bit="xxxx1111">
        <signal_name>door_latche_status</signal_name>
        <values><value>1</value><n>Unlocked</n></values>
        <values><value>2</value><n>locked</n></values>
        <values><value>4</value><n>Secured</n></values>
        <values><value>6</value><n>Unsecured</n></values>
      </Signal>
      <Signal Bit="xx11xxxx">
        <signal_name>selective_unlock_statuss</signal_name>
        <values><value>0</value><n>off</n></values>
        <values><value>1</value><n>on</n></values>
      </Signal>
    </Byte>
  </massage>
</Bus>
```

### Bit Pattern Syntax

The `Bit` attribute uses an 8-character mask where:
- `1` = this bit belongs to the signal
- `x` = don't care / not part of this signal

**Examples:**
```
xxxx1111  →  lower 4 bits   →  mask=0x0F, shift=0
xx11xxxx  →  bits 4-5       →  mask=0x30, shift=4
11xxxxxx  →  upper 2 bits   →  mask=0xC0, shift=6
xxxxxxx1  →  bit 0 only     →  mask=0x01, shift=0
```

**Decoding formula:**
```python
extracted = (byte_value & mask) >> shift
label = val_map[extracted]  # look up in XML values table
```

---

## Python Parser — `parser.py`

### Key Functions

| Function | Purpose |
|---|---|
| `parse_bit_mask(bit_str)` | Converts `"xxxx1111"` → `(mask=0x0F, shift=0)` |
| `load_xml_files(xml_paths)` | Builds signal definition database keyed by message ID |
| `parse_log_line(line)` | Regex-parses one log line → raw frame dict |
| `decode_frame(frame, db)` | Applies bit masks → extracts signal values |
| `process_log_file(...)` | Batch mode: decodes all frames, writes JSON file |
| `stream_log_file(...)` | Stream mode: prints each frame as JSON line immediately |

### Decoded Frame JSON Schema

```json
{
  "timestamp": 1773230879.890181,
  "channel":   2,
  "address":   "0x2FC",
  "direction": "Rx",
  "bus":       "Car_CAN",
  "message":   "Car_Status",
  "raw_data":  [1, 0, 0, 0, 0, 0, 0, 0],
  "signals": {
    "door_latche_status": {
      "raw_value":   1,
      "label":       "Unlocked",
      "is_valid":    true,
      "all_states":  { "1": "Unlocked", "2": "locked", "4": "Secured", "6": "Unsecured" },
      "byte":        0,
      "bit_pattern": "xxxx1111",
      "byte_binary": "00000001"
    }
  }
}
```

**Critical fields used by Angular:**
- `is_valid` — `false` if the decoded raw value has no entry in the XML states table. Frontend holds the previous valid step value in charts and flags the value in the table with ⚠.
- `all_states` — the complete state map from XML, used by Angular to build Y-axis tick labels. Sent on every frame for that signal.
- `label` — the decoded human-readable state name.
- `raw_value` — the extracted numeric value after bit masking.

---

## Spring Boot Backend — `AnalysisController.java`

### Endpoints

#### `POST /api/analyze` — Batch mode
1. Saves uploaded files to a temp directory
2. Spawns `python3 parser.py <log> <xml...>`
3. Waits for process to complete
4. Reads `decoded_frames.json` from temp dir
5. Returns `List<Map<String,Object>>` as JSON
6. Cleans up temp dir

#### `POST /api/analyze-stream` — SSE streaming mode
1. Saves uploaded files to temp dir
2. Returns `SseEmitter` immediately (5-minute timeout)
3. Spawns Python with `--stream` flag in background thread
4. Reads Python stdout line by line
5. Sends each JSON line as SSE event named `"frame"`
6. Sends `{"done":true}` as SSE event named `"end"` when Python prints `__END__`
7. Completes emitter and cleans up temp dir

### Configuration (`application.properties`)
```properties
python.executable=python3
parser.script.path=python_parser/parser.py
spring.servlet.multipart.max-file-size=50MB
spring.servlet.multipart.max-request-size=50MB
```

---

## Angular Frontend — `DashboardComponent`

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Topbar: hamburger | SMART ANALYSER       | user | logout│
├──────────────┬──────────────────────────────────────────┤
│ Left Panel   │ Right Panel                              │
│              │                                          │
│ UPLOAD       │  [TABLE] [CHARTS] [⊞][⊟]  53 frames  ⬇ │
│  log drop    │                                          │
│  xml drop    │  Table view:                             │
│  [ANALYZE]   │    frame row (ts | ch | id | msg | dir)  │
│              │      signal sub-rows (always expanded)   │
│ STATUS       │                                          │
│  53 frames   │  Charts view:                            │
│  [Clear]     │    message section header                │
│              │      2-column signal chart grid          │
│ FILTER       │      step charts with colored lines      │
│  address     │      legend for grouped multi-signal     │
│  bus         │      ⛶ expand button per card            │
│  search      │                                          │
│              │                                          │
│ MESSAGES     │                                          │
│  [✓] Car_Sta │                                          │
│  [✓] Key_But │                                          │
└──────────────┴──────────────────────────────────────────┘
```

### Key Interfaces

```typescript
interface ParsedFrame {
  id: number;           // index in allFrames array
  timestamp: number;    // absolute Unix epoch
  channel: number;      // CAN bus channel (1 or 2)
  address: string;      // hex message ID e.g. "0x2FC"
  bus: string;          // bus name from XML
  message: string;      // message name from XML
  direction: string;    // "Rx" or "Tx"
  rawData: number[];    // original byte array
  signals: Record<string, any>;        // parsed signal objects from Python
  parsedSignals: ParsedSignalEntry[];  // simplified for table display
}

interface ChartCard {
  cardId: string;                    // unique DOM canvas ID
  title: string;                     // signal name or state group label
  signals: SignalDef[];              // one entry per line on the chart
  defVals: number[];                 // sorted Y-axis tick values
  vm: Record<number, string>;        // raw value → label map
  chart?: Chart;                     // Chart.js instance
}

interface MessageGroup {
  messageName: string;
  address: string;
  visible: boolean;      // controlled by left panel toggles
  cards: ChartCard[];    // one or more chart cards
}
```

### Chart Grouping Logic

The `stateKey()` function determines whether two signals share a chart card:

```typescript
private stateKey(v: Record<number, string>): string {
  return Object.keys(v)
    .map(Number)
    .sort((a, b) => a - b)
    .map(k => `${k}=${v[k]}`)
    .join('|');
}
```

**Critical:** Both the numeric keys AND the label values are included in the key. This means `{0:"off", 1:"on"}` and `{0:"Closed", 1:"opened"}` produce different keys and are never grouped together, even though both have the same set of numeric values `{0, 1}`.

**Grouped mode result for Car_Status (0x2FC):**
- Card 1: `door_latche_status` alone — 5 states (Unlocked/locked/Selective_unlock/Secured/Unsecured)
- Card 2: `selective_unlock_statuss` alone — 2 states (off/on)
- Card 3: `Drd_Status + PSD_Status + DRDR_Status + Psdr_Status + Bootlid_Status` — 5 lines, same Closed/opened states
- Card 4: `Rocker_switch_Status` alone — 3 states (not_pressed/Unlock/Lock)

### Chart Implementation

- **Library:** Chart.js 4.4.0 + chartjs-plugin-zoom
- **Type:** Line chart with `stepped: 'before'` — holds value until next frame
- **X-axis:** Relative time in seconds from first frame (`+0.0s` to `+80.4s` for the test log). Inline charts show max 12 evenly-spaced ticks. Expanded overlay uses auto-ticks with zoom/pan.
- **Y-axis:** Only XML-defined states shown as tick labels. Dynamic left padding calculated from longest label string to prevent clipping.
- **Hold-previous:** Frames where `is_valid === false` are skipped — Chart.js step line holds the last valid value automatically.
- **Tail extension:** After the last valid data point, an invisible point is added at `maxTs + pad` to extend the step line to the right edge of the chart.
- **Colored gridlines:** Vertical gridlines at timestamps where that specific message arrived are drawn in the message color (slightly brighter than regular gridlines).

### X-axis Timestamp Strategy

```
logStartTs = minimum timestamp across all frames

Inline tick label:  `+(ts - logStartTs).toFixed(1)s`   e.g. "+14.6s"
Expanded tick label: `+(ts - logStartTs).toFixed(2)s`  e.g. "+14.63s"

Tooltip shows all three:
  frame #22  |  +14.970s  |  ts: 1773230894.860345
```

---

## Signal Definitions — Current XML Files

### `car_can.xml` — Bus: Car_CAN

| Message | ID | Signals |
|---|---|---|
| Car_Status | 0x2FC | door_latche_status, selective_unlock_statuss, Drd_Status, PSD_Status, DRDR_Status, Psdr_Status, Bootlid_Status, Rocker_switch_Status |
| Key_Button_Status | 0x23A | Unlock_Button_status, lock_Button_status, 3rd_Button_status |
| Contact_Status | 0x2CA | Drd_Status_Cont, PSD_Status_Cont, DRDR_Status_Cont, Psdr_Status_Cont, Bootlid_Status_Cont |
| Latch_Action | 0x2AF | Drd_Secure_latch_action, Drdr_Secure_latch_action, Psd_Secure_latch_action, Psdr_Secure_latch_action, Drd_Lock_latch_action, Drdr_Lock_latch_action, Psd_Lock_latch_action, Psdr_Lock_latch_action, Drd_Unlock_latch_action, Drdr_Unlock_latch_action, Psd_Unlock_latch_action, Psdr_Unlock_latch_action |
| Door_selective_unlock | 0xFFF | selective_unlock_action, Roc_Switch |

### `key_can.xml` — Bus: Key_CAN

| Message | ID | Signals |
|---|---|---|
| key_comm | 0x723 | KEY_Pos, KEY_Butt, Key_ID (bytes 2–5, numeric 32-bit) |

### Known XML Issues
- `door_latche_status` — raw value `0` is not defined in XML. Decoder flags as `is_valid: false`, chart holds previous state, table shows `Unknown(0) ⚠`.
- `KEY_Butt` — raw value `0` not defined. Same behavior.
- `door_latche_status` has a typo (`latche` instead of `latch`) — kept as-is in decoder for compatibility with the source XML.
- `Key_ID` spans bytes 2–5 (4 bytes = 32-bit unsigned integer). Excluded from charts (no categorical states). Shown in table as hex value.

---

## Frontend UI — Table View

Each frame renders as a fixed-open block:

```
┌─────────────────────────────────────────────────────────────────┐
│  #  │  timestamp (absolute + relative)  │ ch │ id │ msg │ dir │ raw │
├─────────────────────────────────────────────────────────────────┤
│     │  signal                 │ raw │ decoded                   │
│     │  door_latche_status     │  1  │  Unlocked                 │
│     │  Drd_Status             │  0  │  Closed                   │
│     │  ...                    │     │                           │
└─────────────────────────────────────────────────────────────────┘
```

- Signals are always visible — no click to expand required
- Invalid signal values shown in orange with ⚠ icon
- Filters (address, bus, signal text search) live in the left panel
- Filter state shows `N / total frames shown` count

---

## Frontend UI — Charts View

```
Car_Status  [0x2FC]                          4 charts
┌──────────────────────────┐  ┌──────────────────────────┐
│ door_latche_status       │  │ Closed / opened    ⛶     │
│ [step chart]             │  │ [multi-line chart]        │
│                          │  │ ───Drd_Status             │
│                          │  │ ───PSD_Status             │
│                          │  │ ···                       │
└──────────────────────────┘  └──────────────────────────┘
```

- **⊞ Grouped** toggle: signals with identical states (same raw values AND same labels) share one chart with colored lines + legend
- **⊟ Separate** toggle: one chart per signal
- **⛶ Expand**: opens full-screen overlay with zoom (scroll wheel), pan (drag), reset zoom button, ESC to close
- Left panel checkboxes control which message sections are visible

---

## Known Limitations & Future Work

### Current limitations
- **Memory:** Entire decoded JSON is loaded into memory in Java and Angular. Large logs (50MB+) will be slow.
- **Batch mode latency:** User waits for full decode before seeing anything — SSE streaming mode is built but not wired as default.
- **No real-time sniffing:** Only post-analysis of log files. Live CAN device reading not yet implemented.
- **Hardcoded API URL:** `API_BASE_URL` must be set correctly in `src/app/config/api.config.ts`.
- **Bus channel mapping:** Log header maps `CAN 1 = Car_CAN`, `CAN 2 = Key_CAN` but physically most messages on CAN 2 belong to Car_CAN — likely a routing quirk in the test setup, not a bug.

### Planned — next phases
1. **Real-time streaming** (SSE mode wired as default — built, not yet active)
2. **Live CAN sniffing** — Python reads from USB CAN interface (PEAK PCAN, SocketCAN) instead of file
3. **3D simulation** — visualize vehicle door/lock states in a 3D model
4. **Anomaly detection** — flag unexpected signal transitions, timing violations, undefined values
5. **Multi-bus filtering** — filter charts and table by channel (CAN 1 / CAN 2)
6. **Synchronized crosshair** — hover on one chart shows vertical marker on all charts at same timestamp

---

## Development Setup

### Prerequisites
- Node.js 18+
- Angular CLI 21
- Java 17
- Python 3.8+
- MySQL 8

### Install frontend dependencies
```bash
cd frontend
npm install
npm install chartjs-plugin-zoom hammerjs
ng serve
```

### Run backend
```bash
cd smart-analyzer-backend
./mvnw spring-boot:run
```

### Run parser standalone (CLI)
```bash
# Batch mode
python3 python_parser/parser.py "log file.txt" car_can.xml key_can.xml

# Stream mode (prints one JSON frame per line)
python3 python_parser/parser.py --stream "log file.txt" car_can.xml key_can.xml
```

### Environment config
`src/app/config/api.config.ts`:
```typescript
export const API_BASE_URL = 'http://localhost:8082';
```

`application.properties`:
```properties
python.executable=python3
parser.script.path=python_parser/parser.py
spring.servlet.multipart.max-file-size=50MB
spring.servlet.multipart.max-request-size=50MB
server.port=8082
```

---

## What I Don't Have Access To

The following files were referenced in the codebase report but not shared — details below are inferred:

| File | Inferred content |
|---|---|
| `AuthService` (Angular) | Handles JWT login/logout, `getCurrentUser()` returns username |
| `api.config.ts` | Exports `API_BASE_URL` constant |
| `SmartAnalyzerBackendApplication.java` | Standard Spring Boot entry point |
| `SecurityConfig.java` | JWT filter chain, CORS config, permits `/api/**` |
| `User` entity + repository | MySQL user table with login credentials |
| `LoginComponent` | Angular login form, calls auth service |
| Angular routing module | `/` → dashboard, `/login` → login, `/users` → user management |
| `application.properties` | Database URL, JWT secret, multipart limits |

---

*Report generated based on full code review of `parser.py`, `AnalysisController.java`, `dashboard.component.ts`, `dashboard.component.html`, `dashboard.component.css`, `car_can.xml`, `key_can.xml`, and `log_file.txt` — plus all design and architecture decisions made during development sessions.*

# Smart CAN Analyzer — Complete Reusable Template Guide

This guide extracts the complete architecture, design system, and implementation patterns from the Smart CAN Analyzer project. It serves as a unified blueprint for recreating this project or building future internal analytical tools with the same tech stack and KPIT-inspired aesthetic.

---

## 1. Project Architecture

The application is built using a modern decoupled architecture, combining a high-performance frontend for visualization with a robust backend and native parser for log data.

### **Tech Stack**
- **Frontend**
  - **Framework**: Angular (^21.2.0)
  - **Visualization**: Chart.js (^4.5.1) and `chartjs-plugin-zoom` (^2.2.0)
  - **Styling**: Pure CSS (No Tailwind) using CSS variables and modern Grid/Flex layouts.
  - **HTTP/Streaming**: `HttpClient` (Batch Execution) and Fetch API (SSE Streams).
- **Backend (API Layer)**
  - **Framework**: Spring Boot (v4.0.5 specified, Java 17)
  - **Security**: Spring Security + JWT (`jjwt` framework ^0.12.6)
  - **Database**: Spring Data JPA + MySQL Connector
- **Parser (Native Processing)**
  - **Language**: Python 3
  - **Libraries**: `xml.etree.ElementTree` (XML Schema Parsing), JSON and regex (Raw Signal processing)
- **Communication Protocols**
  - **Multipart Form Data**: Bulk file payload transfers (`.txt` logs + `.xml` schemas).
  - **Server-Sent Events (SSE)**: For stream initialization and payload updates on-demand.

---

## 2. Folder Structure Template

Replicate this exact hierarchical schema for a new engineering project. Boilerplate folders are denoted `(b)` and project-specific domains `(p)`.

```text
/project-root
│
├── /frontend                      (p) Angular Workspace
│   ├── /src
│   │   ├── /app
│   │   │   ├── /dashboard         (p) Main visualizer component
│   │   │   ├── /login             (b) Auth UI
│   │   │   ├── /register          (b) Auth UI
│   │   │   ├── /services          (b) API network interfaces
│   │   │   ├── /config            (b) Environment/API constants
│   │   │   ├── app.routes.ts      (b) Routing logic
│   │   │   └── app.component.ts   (b) Root shell
│   │   ├── styles.css             (p) Global design variables / base styles
│   │   └── index.html             (b) Root HTML mount
│   └── package.json               (b) Dependency mapping
│
├── /smart-analyzer-backend        (p) Spring Boot Workspace
│   ├── /src/main/java/com/molka/smart_analyzer_backend
│   │   ├── /config                (b) CORS, Security Beans, Password Encoders
│   │   ├── /controller            (p) Endpoints (Auth, Analysis, etc.)
│   │   ├── /security              (b) JWT Filters and entry points
│   │   ├── /service               (p) Analysis execution logic
│   │   ├── /model                 (b) Entities
│   │   └── /repository            (b) JPA Interfaces
│   └── pom.xml                    (b) Maven dependencies
│
└── /python_parser                 (p) Core Decoder Engine
    ├── parser.py                  (p) The XML loader and log decoder engine
    ├── car_can.xml                (p) Definition schema A
    └── key_can.xml                (p) Definition schema B
```

---

## 3. Angular Component Template

This is the reusable pattern extracted from the main dashboard module. It dictates how to organize state, upload files, interact with charts, and communicate with the backend.

### Component Decorator Structure
```typescript
import { Component, OnDestroy, OnInit, inject, NgZone, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';

Chart.register(...registerables, zoomPlugin);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  // 1. Dependency Injection 
  private readonly http = inject(HttpClient);
  private readonly zone = inject(NgZone);
  private readonly cdr  = inject(ChangeDetectorRef);

  // 2. Component State Flags
  analyzing = false;
  showResults = false;
  activeView: 'table' | 'charts' = 'table';
  
  // 3. Persistent Data State
  allFrames: ParsedFrame[] = [];
  messageGroups: MessageGroup[] = [];

  ngOnInit(): void { /* Base Auth Initialization */ }
  ngOnDestroy(): void { this.destroyAllCharts(); }
}
```

### Type Interfaces
```typescript
interface ParsedFrame {
  id: number;
  timestamp: number;
  channel: number;
  address: string;
  message: string;
  signals: Record<string, any>; // Used during json unmarshaling
  parsedSignals: ParsedSignalEntry[]; // Enumerable
}

interface ChartCard {
  cardId: string;
  title: string;
  signals: SignalDef[];
  defVals: number[];
  vm: Record<number, string>;
  chart?: Chart;
}
```

### Standard Batch HTTP Execution Structure
```typescript
analyze(): void {
  this.analyzing = true;
  const fd = new FormData();
  fd.append('logFile', this.logFile!);
  this.xmlFiles.forEach(f => fd.append('xmlFiles', f));

  this.http.post<any[]>(`${API_BASE_URL}/api/analyze`, fd).subscribe({
    next: (response) => {
      this.zone.run(() => {
        this.allFrames = response;
        this.showResults = true;
        this.analyzing = false;
        this.cdr.detectChanges();
      });
    },
    error: (err) => { 
        this.analyzing = false; 
    }
  });
}
```

### Fetch API Pattern for SSE / Streaming Workflow
When processing heavy log files that should load instantaneously:
```typescript
async analyzeStream(): Promise<void> {
  this.analyzing = true;
  this.showResults = true;
  this.allFrames = [];
  
  const fd = new FormData();
  fd.append('logFile', this.logFile!);
  this.xmlFiles.forEach(f => fd.append('xmlFiles', f));

  try {
    const response = await fetch(`${API_BASE_URL}/api/analyze-stream`, {
      method: 'POST',
      body: fd
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder('utf-8');
    
    if (!reader) return;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = chunk.split('\n\n'); 
      
      this.zone.run(() => {
        events.forEach(ev => {
          // Detect End Signal Flag
          if (ev.includes('event: end')) {
            this.analyzing = false;
          } 
          // Detect Data Flag Payload Block
          else if (ev.includes('data: {')) {
            const jsonStr = ev.replace(/^data:\s*/, '').trim();
            const frameEntry = JSON.parse(jsonStr);
            this.allFrames.push(frameEntry);
            this.cdr.detectChanges(); // Sync execution
          }
        });
      });
    }
  } catch (err) {
    console.error("Streaming Exception Encountered", err);
  }
}
```

### Safe Chart.js Initialization & Cleanup Boundaries
```typescript
private destroyAllCharts(): void {
  // Always clear memory structures to avoid webgl context overloading
  this.messageGroups.forEach(group => {
    group.cards.forEach(card => {
      card.chart?.destroy();
      card.chart = undefined;
    });
  });
}

renderAllCharts(): void {
  this.destroyAllCharts();
  for (const group of this.messageGroups) {
    if (!group.visible) continue;
    for (const card of group.cards) {
      const canvas = document.getElementById(card.cardId) as HTMLCanvasElement | null;
      if (canvas) {
        card.chart = this.buildChart(canvas, card);
      }
    }
  }
  this.cdr.detectChanges();
}
```

---

## 4. CSS Design System

The system uses a futuristic, technical, and engineering-focused aesthetic (KPIT Theme).

### Core Color Palette
```css
/* Inject these implicitly as JS variable assignments or mapped styles */
/* Primary Action / Neon Green    #b0ff44 */
/* Secondary / Electric Blue      #60cfff */
/* Warning / Neon Orange          #ffb347 */
/* Danger / Error Coral           #ff9466 */
/* Theme Background               #07090b */
/* Theme Surface                  #0d1117 */
/* Standard Iconography/Text      #8a9ab0 */
```

### Dark Theme Grid Background Layout Layer
```css
.page {
  background: #07090b;
  background-image:
    linear-gradient(rgba(176,255,68,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(176,255,68,.035) 1px, transparent 1px);
  background-size: 28px 28px;
}
```

### Scan-Line Background (Secondary Content Wrapper overlay)
```css
.charts-view {
  background:
    repeating-linear-gradient(
      0deg, transparent, transparent 3px,
      rgba(176,255,68,.014) 3px, rgba(176,255,68,.014) 4px),
    #07090b;
}
```

### Glassmorphism Technique
Used for fixed headers (or anything overlaid).
```css
.topbar {
  background: rgba(0,0,0,.3);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid rgba(176,255,68,.12);
}
```

### Corner Brackets Pattern (KPIT Primary Technical Motif)
Required on absolute focal point modals or charts (like the signal cards).
```css
.signal-chart-card {
  position: relative;
  background: #0d1117;
  border: 1px solid rgba(176,255,68,.12);
}

.signal-chart-card::before,
.signal-chart-card::after {
  content: ''; position: absolute;
  width: 9px; height: 9px;
  border: 1.5px solid rgba(176,255,68,.32);
  pointer-events: none; z-index: 2;
}

.signal-chart-card::before {
  top: 5px; left: 5px;
  border-right: none; border-bottom: none;
}
.signal-chart-card::after {
  bottom: 5px; right: 5px;
  border-left: none; border-top: none;
}
```

---

## 5. Chart.js Configuration Template

Data visualization rules using customized properties within the library context.

```typescript
const chartConfig = {
  type: 'line',
  data: {
    datasets: [{
      label: 'Signal',
      data: [ { x: 0.1, y: 0 }, { x: 0.3, y: 1 }, { x: 1.5, y: 1 } ], 
      borderColor: '#b0ff44',
      borderWidth: 2,
      // 1. Dataset Options - Stepped Line Interpretation Behavior
      stepped: 'before', 
      // 2. Tail Extension Logic - Keep the final point hidden
      pointRadius: [4, 4, 0], 
      pointHoverRadius: 6,
      fill: false,
      tension: 0
    }]
  },
  options: {
    maintainAspectRatio: false,
    animation: false, // Performance improvement for rapid reload execution
    plugins: {
      // 3. Plugin Setup Configuration
      zoom: {
        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
        pan: { enabled: true, mode: 'x' },
        limits: { x: { min: 0, max: 2 } }
      }
    },
    scales: {
      x: {
        type: 'linear',
        ticks: {
          callback: (v: any) => `+${Number(v).toFixed(2)}s` // Relative Time Ticks format
        }
      },
      y: {
        min: -0.5,
        max: 2.5,
        // 4. Dynamic Y-Axis Alignment System
        afterFit: (scale: any) => { scale.width = 72; }, 
        ticks: {
          // 5. Y-Axis Value Replacement System (Mapping numbers directly to Enum Labels)
          callback: (v: any) => valueMap[Number(v)] ?? String(v)
        }
      }
    }
  }
};
```

---

## 6. Python Parser Template

The fundamental core data layer transformation mapping algorithm.

### Core Loading & Execution Sequence
```python
import xml.etree.ElementTree as ET
import json
import re
import sys

# 1. Bit mask extraction mechanism
def parse_bit_mask(bit_str):
    bit_str = bit_str.strip()
    mask = 0
    for ch in bit_str:
        mask <<= 1
        if ch == '1': mask |= 1
    shift = 0
    for ch in reversed(bit_str): # Calculates trailing x's for right-shift padding
        if ch == 'x': shift += 1
        else: break
    return mask, shift

# 2. Decoding Logic Evaluation Structure
def decode_frame(frame, db):
    msg_def = db[frame["address"]]
    data = frame["data"]
    decoded_signals = {}
    
    for byte_num, signals in msg_def["bytes"].items():
        if byte_num >= len(data): continue
        byte_val = data[byte_num]
        
        for sig in signals:
            # 3. Apply standard binary mapping calculation
            extracted = (byte_val & sig["mask"]) >> sig["shift"]
            
            if extracted in sig["values"]:
                label = sig["values"][extracted]
                is_valid = True
            else:
                label = f"Unknown({extracted})"
                is_valid = False
                
            decoded_signals[sig["signal"]] = {
                "raw_value": extracted,
                "label": label,
                "is_valid": is_valid
            }
            
    return {"timestamp": frame["timestamp"], "signals": decoded_signals}

# 4. Stream Mode Runtime Format
def print_output(results, is_stream=False):
    if is_stream:
        # Pushes chunk line directly onto execution standard out stream
        for r in results: print(json.dumps(r))
        print("__END__") 
        sys.stdout.flush() 
    else:
        # Standard Batch Export Pipeline
        with open("decoded_frames.json", "w") as f: json.dump(results, f, indent=2)
```

---

## 7. Spring Boot Endpoint Template

This dictates the file interaction standard proxy execution on the server backend architecture.

### SSE Stream Process Engine
```java
@PostMapping(value = "-stream", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter streamFrames(MultipartFile logFile, List<MultipartFile> xmlFiles) throws IOException {
    SseEmitter emitter = new SseEmitter(5 * 60 * 1000L); // Extend Timeout to 5 Minutes
    
    // 1. Thread isolation workspace protocol mapping
    Path sessionDir = Files.createTempDirectory("stream_session_");
    Path logPath = saveToDir(sessionDir, logFile);
    Path xmlPath = saveToDir(sessionDir, xmlFiles.get(0));
    
    // 2. Multithread evaluation logic
    ExecutorService executor = Executors.newSingleThreadExecutor();
    executor.submit(() -> {
        try {
            List<String> cmd = List.of("python", "parser.py", "--stream", logPath.toString(), xmlPath.toString());
            ProcessBuilder pb = new ProcessBuilder(cmd);
            Process process = pb.start();
            
            // 3. Pipeline Read Stream evaluation sequence (Capturing Standard Out loop logic)
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.equals("__END__")) {
                        emitter.send(SseEmitter.event().name("end").data("{\"done\":true}"));
                        break;
                    }
                    if (line.startsWith("{")) {
                        emitter.send(SseEmitter.event().name("frame").data(line));
                    }
                }
            }
            process.waitFor();
            emitter.complete();
        } catch (Exception e) {
            emitter.completeWithError(e);
        } finally {
            // Memory cleanup 
            FileSystemUtils.deleteRecursively(sessionDir);
            executor.shutdown();
        }
    });

    return emitter;
}
```

---

## 8. Reusable UI Patterns

Deploy elements uniformly using predefined HTML components across interfaces.

### Standard Panel Wrapper Architecture
```html
<div class="app-body">
    <!-- Focal Selection Space wrapper -->
    <aside class="left-panel">...</aside>
    <!-- Core Data Payload Interface wrapper -->
    <main class="right-panel">...</main>
</div>
```

### Table View Striped Accent System
```html
<div class="frames-table-wrap">
   <!-- Inject dynamic mapping data tables here -->
</div>
```

### Generic ID Badge Component Implementation
```html
<!-- Adjust .addr-, .rx-, .tx- styling hooks appropriately -->
<span class="badge addr-badge">0x2A</span>
```
```css
.badge {
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px; padding: .18rem .55rem;
  font-size: .75rem; font-weight: 800;
}
.addr-badge { color: #b0ff44; background: rgba(176,255,68,.12); }
```

### Interactive Upload Drop Zone System
```html
<div class="drop-zone" [class.has-file]="!!file">
  <div class="dz-icon">📄</div>
  <div class="dz-content">
    <span class="dz-label">Signal Source <span class="dz-hint">.bin</span></span>
  </div>
</div>
```

### Full Size Modals (With KPIT Bracket borders and blur)
```html
<div class="chart-expand-overlay">
  <div class="chart-expand-modal">... Modal Core Execution Layout ...</div>
</div>
```

---

## 9. What To Change For A New Project

To utilize this template effectively for another systems analyzer, simply manipulate the following system parameters while leaving the structural components completely untampered:

1. **Parser Protocol Alignment Mapping** 
   - Modulate the Regex schema in `parser.py` reflecting alternative raw formatting architectures (UART dumps, Ethernet packets, UART CSV output data).
   - Manipulate Python payload variables targeting different definitions beyond `car_can.xml`.

2. **Frontend Structural Properties**
   - Verify `API_BASE_URL` reflects accurate environment pointers.
   - Adjust array mappings (the `PAL` array logic) inside `DashboardComponent` setting `bus-X` custom CSS tags for custom protocol types.

3. **Chart Visualizations System Adjustments**
   - Depending on data payload speed rates - Adjust visual configurations of X-Axis limit markers defining standard deviation lengths from log initiation sequences.

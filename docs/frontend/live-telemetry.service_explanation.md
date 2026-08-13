# `live-telemetry.service.ts` — Architecture Explanation

**Source:** `Frontend_angular/src/app/core/services/live-telemetry.service.ts`

---

## Executive Summary

`LiveTelemetryService` manages the **STOMP over SockJS WebSocket** connection to Spring's `/ws-ecu-gateway` endpoint. It subscribes to topics for live frames, session events, playback streams, and aggregated live telemetry—bridging backend Kafka/WebSocket publishing to Angular sniffer/replay UI.

**Business value:** Real-time CAN frame visualization without polling MySQL; core to "live sniffer" and Influx replay experiences.

---

## Architectural Process Orchestration

```
Component → connect() / subscribeToSession(sessionId)
        ▼
SockJS(API_BASE + '/ws-ecu-gateway') + Stomp Client
        ▼
Spring WebSocketConfig → topics:
  /topic/frames/{sessionId}
  /topic/sessions
  /topic/playback/{sessionId}
  /topic/live-telemetry
        ▼
Backend publishes from Kafka consumer / playback service
        ▼
Observables: frames$, sessions$, playback$, liveTelemetry$
        ▼
Sniffer charts + TelemetryService.appendLiveFrame (optional)
```

---

## Key Controller/Service Capabilities

| Method | Responsibility |
|--------|----------------|
| `connect()` | Open STOMP connection; reconnect logic |
| `disconnect()` | Tear down client and subscriptions |
| `subscribeToSession(sessionId)` | `/topic/frames/{id}` → `frames$` Subject |
| `subscribeToSessions()` | Global session list updates |
| `subscribeToPlayback(sessionId)` | Influx replay stream |
| `subscribeToLiveTelemetry()` | Aggregated telemetry topic |
| `getConfig(sessionId)` | Returns broker URL config (sessionId param unused in URL) |
| Observables | `frames$`, `sessions$`, `playback$`, `liveTelemetry$` |

---

## Critical Design Considerations

- **Subject multicasting** — components must unsubscribe or share one subscription.
- **SockJS fallback** — works through Spring's WebSocket endpoint on port 8080.
- **Connection lifecycle** — must `disconnect()` on component destroy to avoid leaks.

---

## Gotchas & Best Practices

- **`getConfig(sessionId)`** — parameter not used in constructed URL; possible dead API.
- **No auth headers on STOMP** — verify backend WebSocket security (may be open in dev).
- Duplicate `connect()` calls — guard with connection state flag.
- **ReplayEngineService** pairs with `playback$` for timed UI sync.

---

## Architectural Advice & Refactoring

**Add:** JWT in STOMP connect headers if backend secures WS. **Correct:** Use or remove unused `sessionId` in `getConfig`. **Remove:** Leaked subscriptions on route change.

---

## Navigation Strategy

Next: `replay-engine.service.ts`, backend `WebSocketConfig.java`, `CanKafkaConsumer.java`, sniffer live view.

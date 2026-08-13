# AI Workflow Rules — KPIT Smart Real-Time CAN Analyser

## Approach
Build this project incrementally using a spec-driven workflow. Context files
define what to build, how to build it, and the current state of progress.
Always implement against these specs — do not infer or invent behavior from
scratch. The pipeline has five moving parts (Angular, Spring Boot, Python,
Kafka, InfluxDB/MySQL) — changes to one layer almost always affect another.
Always trace the full data path (Kafka topic → consumer → service → DB →
WebSocket → Angular) before starting any implementation step to identify
all files that will need to change. Audit every file before modifying it —
never assume its current state matches what was previously described.

## Scoping Rules
- Work on one feature unit at a time — one Kafka consumer, one REST
  endpoint, one Angular component, one Python script change
- Prefer small, verifiable increments over large speculative changes —
  a change that can be tested end to end in under 5 minutes is the right size
- Do not combine unrelated system boundaries in a single implementation
  step — backend and frontend changes for the same feature are acceptable
  together; changes to two unrelated features are not
- Never use `git add -A` — always stage specific files to avoid
  accidentally committing unrelated changes or dead code
- Always trace the full data flow before implementing — from Kafka topic
  to consumer to service to DB to WebSocket to Angular component

## When to Split Work
Split an implementation step if it combines:
- Python pipeline changes and Spring Boot consumer changes in the same step
- Angular UI changes and new REST endpoint creation without a clear contract
  defined first
- Multiple unrelated REST controllers or Kafka topics in a single step
- A new ML scoring consumer and UI anomaly display in the same step —
  implement and verify the scorer first, then wire the UI
- Any behavior not clearly defined in the context files — stop, define it,
  then implement
- InfluxDB schema changes and MySQL schema changes in the same migration —
  these are independent storage layers and must be verified independently
- WebSocket topic changes and REST API changes that both affect the same
  Angular component — split by communication channel

If a change cannot be verified end to end quickly, the scope is too
broad — split it.

## When to Audit Before Modifying
Always read the current state of a file before modifying it when:
- The file contains Kafka consumer logic — consumer group IDs, topic names,
  and offset commit strategies must be verified before touching them
- The file is an Angular component with an existing RAF loop or
  WebSocket subscription — adding a second subscription without auditing
  causes duplicate frame processing
- The file is a Spring Boot service that touches both MySQL and InfluxDB —
  the transaction boundary must be understood before adding new writes
- The file is a Python script that publishes to Kafka — the topic name,
  message format, and offset commit strategy must match the consumer exactly
- The file is an XML ECU catalog — adding a new message or signal affects
  the decoder, the integrity analyzer, and the simulator simultaneously

## Handling Missing Requirements
- Do not invent product behavior not defined in the context files — if it
  is not in the spec, it does not exist yet
- If a requirement is ambiguous (e.g. "should the anomaly score be stored
  per frame or per session?"), resolve it in `architecture-context.md`
  before writing a single line of implementation
- If a requirement is missing, add it as an open question in
  `progress-tracker.md` before continuing — do not silently make a
  design decision that affects the data model or the API contract
- If two context files contradict each other, flag the conflict explicitly
  and wait for resolution — do not pick one arbitrarily

## Protected Files
Do not modify the following unless explicitly instructed:


## Keeping Docs in Sync
Update the relevant context file whenever implementation changes:
- System architecture or data flow boundaries → `architecture-context.md`
- Storage model decisions (new MySQL table, new InfluxDB measurement,
  new Kafka topic) → `architecture-context.md` Storage Model section
- New or changed code conventions → `code-standards.md`
- Feature scope changes (added, removed, or deferred) → `project-brief.md`
  Scope section
- Sprint progress, completed units, open questions → `progress-tracker.md`
- New API endpoints or changed response shapes → `architecture-context.md`
  System Boundaries section

## Before Moving to the Next Unit
1. The current unit works end to end within its defined scope — frames flow
   from source to Kafka to consumer to DB to WebSocket to Angular component
   without errors in the logs of any layer
2. No invariant defined in `architecture-context.md` was violated — the
   Kafka consumer is non-blocking, the file worker uses parse_log_stream(),
   the frame table is paginated, the ML scorer is in a separate consumer group
3. All debug output is removed — no console.log in Angular, no print() in
   Python, no System.out.println in Java — only SLF4J and Python logging
   module calls at appropriate levels remain
4. `progress-tracker.md` reflects the completed work and any open questions
   discovered during implementation are recorded
5. `mvn compile -DskipTests` passes with zero errors for any backend change
6. `ng build` passes with zero errors for any frontend change
7. The Python script runs without import errors and connects to Kafka
   successfully for any pipeline change
8. No hardcoded secrets, ports, or environment-specific values were
   introduced — all config is read from environment variables or
   application.properties
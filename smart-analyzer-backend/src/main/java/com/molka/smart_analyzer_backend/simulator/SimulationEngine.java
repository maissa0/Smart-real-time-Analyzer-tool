package com.molka.smart_analyzer_backend.simulator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

@Component
public class SimulationEngine {

	private static final Logger log = LoggerFactory.getLogger(SimulationEngine.class);

	private static final String KAFKA_TOPIC      = "can-frames-raw";
	private static final String WS_TOPIC         = "/topic/frames";
	private static final String WS_STATUS_TOPIC  = "/topic/sim-status";
	private static final long   BASE_INTERVAL_MS = 1000L;

	// ── Bit-encoding table (signal → {byteNum, mask, shift}) ─────────────────
	// Derived from car_can.xml and key_can.xml bit patterns using _parse_bit_pattern logic
	private static final Map<String, int[]> SIGNAL_ENCODING;
	static {
		SIGNAL_ENCODING = new HashMap<>();
		// car_can.xml — Car_Status (0x2FC)
		SIGNAL_ENCODING.put("door_latche_status",       new int[]{0, 0x0F, 0}); // xxxx1111
		SIGNAL_ENCODING.put("selective_unlock_statuss", new int[]{0, 0x30, 4}); // xx11xxxx
		SIGNAL_ENCODING.put("Drd_Status",               new int[]{1, 0x03, 0}); // xxxxxx11
		SIGNAL_ENCODING.put("PSD_Status",               new int[]{1, 0x0C, 2}); // xxxx11xx
		SIGNAL_ENCODING.put("DRDR_Status",              new int[]{1, 0x30, 4}); // xx11xxxx
		SIGNAL_ENCODING.put("Psdr_Status",              new int[]{1, 0xC0, 6}); // 11xxxxxx
		SIGNAL_ENCODING.put("Bootlid_Status",           new int[]{2, 0x03, 0}); // xxxxxx11
		SIGNAL_ENCODING.put("Rocker_switch_Status",     new int[]{2, 0xC0, 6}); // 11xxxxxx
		// key_can.xml — key_comm (0x723)
		SIGNAL_ENCODING.put("KEY_Pos",                  new int[]{1, 0xC0, 6}); // 11xxxxxx
		SIGNAL_ENCODING.put("KEY_Butt",                 new int[]{1, 0x3F, 0}); // xx111111
	}

	// ── Human-readable labels from XML values ─────────────────────────────────
	private static final Map<String, Map<Integer, String>> SIGNAL_LABELS;
	static {
		SIGNAL_LABELS = new HashMap<>();
		SIGNAL_LABELS.put("door_latche_status", new HashMap<>(Map.of(
				1, "Unlocked", 2, "locked", 3, "Selective_unlock", 4, "Secured", 6, "Unsecured")));
		SIGNAL_LABELS.put("selective_unlock_statuss", new HashMap<>(Map.of(0, "off", 1, "on")));
		SIGNAL_LABELS.put("Drd_Status",   new HashMap<>(Map.of(0, "Closed", 1, "opened")));
		SIGNAL_LABELS.put("PSD_Status",   new HashMap<>(Map.of(0, "Closed", 1, "opened")));
		SIGNAL_LABELS.put("DRDR_Status",  new HashMap<>(Map.of(0, "Closed", 1, "opened")));
		SIGNAL_LABELS.put("Psdr_Status",  new HashMap<>(Map.of(0, "Closed", 1, "opened")));
		SIGNAL_LABELS.put("Bootlid_Status", new HashMap<>(Map.of(0, "Closed", 1, "opened")));
		SIGNAL_LABELS.put("Rocker_switch_Status", new HashMap<>(Map.of(0, "not_pressed", 1, "Unlock", 2, "Lock")));
		SIGNAL_LABELS.put("KEY_Pos",  new HashMap<>(Map.of(1, "Inside", 2, "Outside", 3, "Unknown")));
		SIGNAL_LABELS.put("KEY_Butt", new HashMap<>(Map.of(1, "Unlock_button", 2, "Lock_button", 3, "3rd_button")));
	}

	// ── Scenario step ─────────────────────────────────────────────────────────

	private record ScenarioStep(
			String address,
			String messageName,
			String bus,
			Map<String, Integer> signalValues
	) {}

	// ── Spring dependencies ───────────────────────────────────────────────────

	private final KafkaTemplate<String, Object> kafkaTemplate;
	private final SimpMessagingTemplate          messaging;
	private final XmlDefinitionLoader            loader;
	private final Random random = new Random();

	// ── Runtime state ─────────────────────────────────────────────────────────

	private List<MessageDef> definitions = new ArrayList<>();
	private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
	private ScheduledFuture<?> task;
	private final AtomicBoolean           running          = new AtomicBoolean(false);
	private final AtomicBoolean           paused           = new AtomicBoolean(false);
	private final AtomicReference<Double> speedMultiplier  = new AtomicReference<>(1.0);
	private final AtomicLong              frameCounter     = new AtomicLong(0);
	private double logStartTime = -1;

	// ── Scenario state ────────────────────────────────────────────────────────

	private final AtomicReference<ScenarioType> currentScenario = new AtomicReference<>(ScenarioType.RANDOM);
	private final AtomicInteger                 scenarioIndex   = new AtomicInteger(0);
	private volatile List<ScenarioStep>         scenarioSteps   = Collections.emptyList();

	// ── Fault injection state ─────────────────────────────────────────────────

	private volatile boolean injectValueErrors   = false;
	private volatile boolean injectTimingGaps    = false;
	private volatile boolean injectCounterErrors = false;

	// ── Constructor ───────────────────────────────────────────────────────────

	public SimulationEngine(KafkaTemplate<String, Object> kafkaTemplate,
	                        SimpMessagingTemplate messaging,
	                        XmlDefinitionLoader loader) {
		this.kafkaTemplate = kafkaTemplate;
		this.messaging     = messaging;
		this.loader        = loader;
	}

	// ── Public controls ───────────────────────────────────────────────────────

	public synchronized void start() {
		log.info("[SIM] start() called. already running={}", running.get());
		if (running.get()) return;
		definitions = loader.loadAll();
		log.info("[SIM] loaded {} message definitions from XML", definitions.size());
		if (definitions.isEmpty() && currentScenario.get() == ScenarioType.RANDOM) {
			log.warn("[SIM] No definitions found — check simulator.definitions-dir in application.properties.");
			return;
		}
		logStartTime = System.currentTimeMillis() / 1000.0;
		frameCounter.set(0);
		scenarioIndex.set(0);
		running.set(true);
		paused.set(false);
		log.info("[SIM] Simulation started. scenario={} interval={}ms speed={}x",
				currentScenario.get(), BASE_INTERVAL_MS, speedMultiplier.get());
		scheduleNext();
	}

	public synchronized void pause()  { paused.set(true); }

	public synchronized void resume() {
		if (!running.get()) return;
		paused.set(false);
	}

	public synchronized void stop() {
		log.info("[SIM] stop() called.");
		running.set(false);
		paused.set(false);
		if (task != null) { task.cancel(false); task = null; }
	}

	public synchronized void reset() {
		stop();
		frameCounter.set(0);
		scenarioIndex.set(0);
		currentScenario.set(ScenarioType.RANDOM);
		injectValueErrors   = false;
		injectTimingGaps    = false;
		injectCounterErrors = false;
		logStartTime = -1;
	}

	public void setSpeed(double multiplier) {
		speedMultiplier.set(multiplier <= 0 ? 0.1 : multiplier);
	}

	public synchronized void setScenario(ScenarioType type) {
		log.info("[SIM] setScenario({})", type);
		currentScenario.set(type);
		scenarioIndex.set(0);
		scenarioSteps = (type == ScenarioType.RANDOM) ? Collections.emptyList() : buildScenarioSteps(type);
	}

	public void setFaultInjection(boolean valueErrors, boolean timingGaps, boolean counterErrors) {
		this.injectValueErrors   = valueErrors;
		this.injectTimingGaps    = timingGaps;
		this.injectCounterErrors = counterErrors;
		log.info("[SIM] Fault injection — valueErrors={} timingGaps={} counterErrors={}",
				valueErrors, timingGaps, counterErrors);
	}

	// ── Scheduling ────────────────────────────────────────────────────────────

	private void scheduleNext() {
		if (!running.get()) return;
		long intervalMs = (long) (BASE_INTERVAL_MS / speedMultiplier.get());
		task = scheduler.schedule(this::tick, intervalMs, TimeUnit.MILLISECONDS);
	}

	private void tick() {
		if (!running.get()) return;
		if (!paused.get()) {
			ScenarioType scenario = currentScenario.get();
			if (scenario == ScenarioType.RANDOM) {
				produceRandomFrame();
			} else {
				int idx = scenarioIndex.getAndIncrement();
				List<ScenarioStep> steps = scenarioSteps;
				if (idx < steps.size()) {
					produceScenarioFrame(steps.get(idx));
				}
				if (idx >= steps.size() - 1) {
					// Last frame delivered — stop and notify Angular
					running.set(false);
					paused.set(false);
					if (task != null) { task.cancel(false); task = null; }
					messaging.convertAndSend(WS_STATUS_TOPIC, Map.of("type", "SCENARIO_DONE"));
					log.info("[SIM] Scenario complete: {}", scenario);
					return;
				}
			}
		}
		scheduleNext();
	}

	// ── Random frame production (existing behaviour) ──────────────────────────

	private void produceRandomFrame() {
		if (definitions.isEmpty()) return;
		MessageDef msgDef = definitions.get(random.nextInt(definitions.size()));

		// Counter errors (8% chance): skip increment — reuse last counter value
		long count;
		if (injectCounterErrors && random.nextDouble() < 0.08) {
			count = frameCounter.get();   // don't advance
			log.info("[FAULT] Counter error injected — duplicate frame counter {}", count);
		} else {
			count = frameCounter.incrementAndGet();
		}
		double timestamp = logStartTime + count * (BASE_INTERVAL_MS / 1000.0 / speedMultiplier.get());

		SimulatorFrame frame = new SimulatorFrame();
		frame.timestamp = timestamp;
		frame.channel   = 1;
		frame.address   = msgDef.address();
		frame.message   = msgDef.messageName();
		frame.bus       = msgDef.bus();
		frame.direction = random.nextBoolean() ? "Rx" : "Tx";
		frame.rawData   = generateRawData();

		List<SimulatorFrame.SignalValue> signals = new ArrayList<>();
		for (SignalDef sigDef : msgDef.signals()) {
			SimulatorFrame.SignalValue sv = new SimulatorFrame.SignalValue();
			sv.name   = sigDef.name();
			ValidValue chosen = sigDef.validValues().get(random.nextInt(sigDef.validValues().size()));
			sv.rawValue = chosen.value();
			sv.value    = chosen.label();
			sv.isValid  = true;
			Map<String, String> allStates = new LinkedHashMap<>();
			for (ValidValue vv : sigDef.validValues()) {
				allStates.put(String.valueOf(vv.value()), vv.label());
			}
			sv.allStates = allStates;
			signals.add(sv);
		}
		frame.parsedSignals = signals;

		// Value errors (10% chance): corrupt one random byte of raw_data
		if (injectValueErrors && random.nextDouble() < 0.10) {
			applyValueError(frame.rawData);
		}

		// Timing gaps (5% chance): sleep 2-5 seconds before sending
		if (injectTimingGaps && random.nextDouble() < 0.05) {
			applyTimingGap();
		}

		kafkaTemplate.send(KAFKA_TOPIC, frame);
		log.info("[SIM] Random frame #{}: message={}, address={}", count, frame.message, frame.address);
		messaging.convertAndSend(WS_TOPIC, frame);
	}

	private List<Integer> generateRawData() {
		List<Integer> bytes = new ArrayList<>();
		for (int i = 0; i < 8; i++) bytes.add(random.nextInt(256));
		return bytes;
	}

	// ── Scenario frame production ─────────────────────────────────────────────

	private void produceScenarioFrame(ScenarioStep step) {
		// Counter errors (8% chance): skip increment — reuse last counter value
		long count;
		if (injectCounterErrors && random.nextDouble() < 0.08) {
			count = frameCounter.get();
			log.info("[FAULT] Counter error injected — duplicate frame counter {}", count);
		} else {
			count = frameCounter.incrementAndGet();
		}
		double timestamp = logStartTime + count * (BASE_INTERVAL_MS / 1000.0 / speedMultiplier.get());

		SimulatorFrame frame = new SimulatorFrame();
		frame.timestamp = timestamp;
		frame.channel   = 1;
		frame.address   = step.address();
		frame.message   = step.messageName();
		frame.bus       = step.bus();
		frame.direction = "Rx";
		frame.rawData   = encodeSignals(step.signalValues());

		List<SimulatorFrame.SignalValue> signals = new ArrayList<>();
		for (Map.Entry<String, Integer> entry : step.signalValues().entrySet()) {
			SimulatorFrame.SignalValue sv = new SimulatorFrame.SignalValue();
			sv.name     = entry.getKey();
			sv.rawValue = entry.getValue();
			sv.value    = resolveLabel(entry.getKey(), entry.getValue());
			sv.isValid  = true;
			sv.allStates = resolveAllStates(entry.getKey());
			signals.add(sv);
		}
		frame.parsedSignals = signals;

		// Value errors (10% chance): corrupt one random byte of raw_data
		if (injectValueErrors && random.nextDouble() < 0.10) {
			applyValueError(frame.rawData);
		}

		// Timing gaps (5% chance): sleep 2-5 seconds before sending
		if (injectTimingGaps && random.nextDouble() < 0.05) {
			applyTimingGap();
		}

		kafkaTemplate.send(KAFKA_TOPIC, frame);
		log.info("[SIM] Scenario frame #{} ({}): address={} signals={}",
				count, currentScenario.get(), frame.address, step.signalValues().keySet());
		messaging.convertAndSend(WS_TOPIC, frame);
	}

	// ── Fault helpers ─────────────────────────────────────────────────────────

	/** Corrupt one random byte of the raw payload to a random 0-255 value. */
	private void applyValueError(List<Integer> rawData) {
		if (rawData == null || rawData.isEmpty()) return;
		int idx = random.nextInt(rawData.size());
		int corrupted = random.nextInt(256);
		rawData.set(idx, corrupted);
		log.info("[FAULT] Value error injected — byte[{}] = 0x{}", idx, Integer.toHexString(corrupted));
	}

	/** Block the scheduler thread for 2-5 seconds to simulate a timing gap. */
	private void applyTimingGap() {
		long gapMs = 2000L + random.nextInt(3001); // 2000..5000 ms
		log.info("[FAULT] Timing gap injected — sleeping {}ms", gapMs);
		try {
			Thread.sleep(gapMs);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}

	// ── encode_frame() — Java port of python_parser/parser.py encode_frame() ──
	// Uses SIGNAL_ENCODING table (byteNum, mask, shift) to pack raw int values
	// into the correct bit positions of an 8-byte CAN payload.

	private List<Integer> encodeSignals(Map<String, Integer> signalValues) {
		int[] raw = new int[8];
		for (Map.Entry<String, Integer> entry : signalValues.entrySet()) {
			int[] enc = SIGNAL_ENCODING.get(entry.getKey());
			if (enc == null) continue;
			int byteNum = enc[0], mask = enc[1], shift = enc[2];
			if (byteNum < 8) {
				raw[byteNum] |= (entry.getValue() << shift) & mask;
			}
		}
		List<Integer> result = new ArrayList<>(8);
		for (int b : raw) result.add(b);
		return result;
	}

	private String resolveLabel(String signalName, int rawValue) {
		Map<Integer, String> labels = SIGNAL_LABELS.get(signalName);
		return labels != null ? labels.getOrDefault(rawValue, String.valueOf(rawValue)) : String.valueOf(rawValue);
	}

	private Map<String, String> resolveAllStates(String signalName) {
		Map<Integer, String> labels = SIGNAL_LABELS.get(signalName);
		if (labels == null) return Collections.emptyMap();
		Map<String, String> result = new LinkedHashMap<>();
		labels.forEach((k, v) -> result.put(String.valueOf(k), v));
		return result;
	}

	// ── Scenario step builders ────────────────────────────────────────────────

	private List<ScenarioStep> buildScenarioSteps(ScenarioType type) {
		return switch (type) {
			case KEY_APPROACH   -> buildKeyApproach();
			case ALL_DOORS_OPEN -> buildAllDoorsOpen();
			case FULL_SEQUENCE  -> buildFullSequence();
			default -> Collections.emptyList();
		};
	}

	/**
	 * KEY_APPROACH — 8 frames, 1 s apart.
	 * Simulates a key detected outside → enters car → doors unlock → open → boot opens.
	 */
	private List<ScenarioStep> buildKeyApproach() {
		return List.of(
			// 1-2: key outside, doors still locked
			new ScenarioStep("0X723", "key_comm",   "Key_CAN", Map.of("KEY_Pos", 2)),
			new ScenarioStep("0X723", "key_comm",   "Key_CAN", Map.of("KEY_Pos", 2)),
			// 3: key moves inside
			new ScenarioStep("0X723", "key_comm",   "Key_CAN", Map.of("KEY_Pos", 1)),
			// 4: doors unlock + selective unlock activates
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN",
					orderedMap("door_latche_status", 1, "selective_unlock_statuss", 1)),
			// 5-6: driver then passenger door opens
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("Drd_Status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("PSD_Status", 1)),
			// 7: latch goes unsecured
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("door_latche_status", 6)),
			// 8: boot opens
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("Bootlid_Status", 1))
		);
	}

	/**
	 * ALL_DOORS_OPEN — 8 frames, 1 s apart.
	 * Simulates all doors and boot opening then closing and locking.
	 */
	private List<ScenarioStep> buildAllDoorsOpen() {
		return List.of(
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("door_latche_status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("Drd_Status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("PSD_Status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("DRDR_Status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("Psdr_Status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("Bootlid_Status", 1)),
			// all doors closed
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN",
					orderedMap("Drd_Status", 0, "PSD_Status", 0, "DRDR_Status", 0,
					           "Psdr_Status", 0, "Bootlid_Status", 0)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("door_latche_status", 2))
		);
	}

	/**
	 * FULL_SEQUENCE — 12 frames, 1 s apart.
	 * Full car lifecycle: secured → key outside → inside → all open → all closed → locked → key leaves.
	 */
	private List<ScenarioStep> buildFullSequence() {
		return List.of(
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("door_latche_status", 4)),
			new ScenarioStep("0X723", "key_comm",   "Key_CAN", Map.of("KEY_Pos", 2)),
			new ScenarioStep("0X723", "key_comm",   "Key_CAN", Map.of("KEY_Pos", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("door_latche_status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("Drd_Status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("PSD_Status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("DRDR_Status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("Psdr_Status", 1)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("Bootlid_Status", 1)),
			// all doors closed
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN",
					orderedMap("Drd_Status", 0, "PSD_Status", 0, "DRDR_Status", 0,
					           "Psdr_Status", 0, "Bootlid_Status", 0)),
			new ScenarioStep("0X2FC", "Car_Status", "Car_CAN", Map.of("door_latche_status", 2)),
			new ScenarioStep("0X723", "key_comm",   "Key_CAN", Map.of("KEY_Pos", 2))
		);
	}

	/** Helper — build an insertion-ordered map from flat key/value pairs. */
	@SafeVarargs
	private static <K, V> Map<K, V> orderedMap(Object... pairs) {
		Map<K, V> map = new LinkedHashMap<>();
		for (int i = 0; i < pairs.length - 1; i += 2) {
			//noinspection unchecked
			map.put((K) pairs[i], (V) pairs[i + 1]);
		}
		return map;
	}
}

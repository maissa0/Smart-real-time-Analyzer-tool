package com.molka.smart_analyzer_backend.simulator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

@Component
public class SimulationEngine {

	private static final Logger log = LoggerFactory.getLogger(SimulationEngine.class);

	private static final String KAFKA_TOPIC  = "can-frames-raw";
	private static final String WS_TOPIC     = "/topic/frames";
	private static final long   BASE_INTERVAL_MS = 1000L;

	private final KafkaTemplate<String, Object> kafkaTemplate;
	private final SimpMessagingTemplate          messaging;
	private final XmlDefinitionLoader            loader;
	private final Random random = new Random();

	private List<MessageDef> definitions = new ArrayList<>();
	private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
	private ScheduledFuture<?> task;
	private final AtomicBoolean running        = new AtomicBoolean(false);
	private final AtomicBoolean paused         = new AtomicBoolean(false);
	private final AtomicReference<Double> speedMultiplier = new AtomicReference<>(1.0);
	private final AtomicLong frameCounter      = new AtomicLong(0);
	private double logStartTime = -1;

	public SimulationEngine(KafkaTemplate<String, Object> kafkaTemplate,
	                        SimpMessagingTemplate messaging,
	                        XmlDefinitionLoader loader) {
		this.kafkaTemplate = kafkaTemplate;
		this.messaging     = messaging;
		this.loader        = loader;
	}

	public synchronized void start() {
		log.info("[SIM] start() called. already running={}", running.get());
		if (running.get()) return;
		definitions = loader.loadAll();
		log.info("[SIM] loaded {} message definitions from XML", definitions.size());
		if (definitions.isEmpty()) {
			log.warn("[SIM] No definitions found — check simulator.definitions-dir in application.properties.");
			return;
		}
		logStartTime = System.currentTimeMillis() / 1000.0;
		frameCounter.set(0);
		running.set(true);
		paused.set(false);
		log.info("[SIM] Simulation started. interval={}ms speed={}x", BASE_INTERVAL_MS, speedMultiplier.get());
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
		logStartTime = -1;
	}

	public void setSpeed(double multiplier) {
		speedMultiplier.set(multiplier <= 0 ? 0.1 : multiplier);
	}

	// ── Scheduling ────────────────────────────────────────────────────────────

	private void scheduleNext() {
		if (!running.get()) return;
		long intervalMs = (long) (BASE_INTERVAL_MS / speedMultiplier.get());
		task = scheduler.schedule(this::tick, intervalMs, TimeUnit.MILLISECONDS);
	}

	private void tick() {
		if (!running.get()) return;
		if (!paused.get()) produceRandomFrame();
		scheduleNext();
	}

	// ── Frame production ──────────────────────────────────────────────────────

	private void produceRandomFrame() {
		if (definitions.isEmpty()) return;
		MessageDef msgDef = definitions.get(random.nextInt(definitions.size()));
		long   count     = frameCounter.incrementAndGet();
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

		// 1. Send to Kafka for persistence / future consumers
		kafkaTemplate.send(KAFKA_TOPIC, frame);
		log.info("[SIM] Producing frame #{} to Kafka: message={}, address={}", count, frame.message, frame.address);

		// 2. Send directly to WebSocket — bypasses Kafka consumer, delivers immediately
		messaging.convertAndSend(WS_TOPIC, frame);
		log.info("[SIM] Sent frame #{} directly to WebSocket {}", count, WS_TOPIC);
	}

	private List<Integer> generateRawData() {
		List<Integer> bytes = new ArrayList<>();
		for (int i = 0; i < 8; i++) bytes.add(random.nextInt(256));
		return bytes;
	}
}

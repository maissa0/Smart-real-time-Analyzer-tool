package com.molka.smart_analyzer_backend.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@RestController
@RequestMapping("/api/unity")
public class UnityController {

	private static final Logger log = LoggerFactory.getLogger(UnityController.class);

	private final SimpMessagingTemplate messaging;

	// Session IDs currently subscribed to /topic/frames
	private final Set<String> frameSubscribers = ConcurrentHashMap.newKeySet();

	// Daemon thread for replay (one replay at a time; new one cancels the previous)
	private final ExecutorService replayExecutor = Executors.newSingleThreadExecutor(r -> {
		Thread t = new Thread(r, "unity-replay");
		t.setDaemon(true);
		return t;
	});

	public UnityController(SimpMessagingTemplate messaging) {
		this.messaging = messaging;
	}

	// ── Subscription tracking ──────────────────────────────────────────────────

	@EventListener
	public void handleSubscribe(SessionSubscribeEvent event) {
		StompHeaderAccessor acc = StompHeaderAccessor.wrap(event.getMessage());
		String dest      = acc.getDestination();
		String sessionId = acc.getSessionId();
		if ("/topic/frames".equals(dest) && sessionId != null) {
			frameSubscribers.add(sessionId);
			log.info("[Unity] subscriber +{} (total={})", sessionId, frameSubscribers.size());
		}
	}

	@EventListener
	public void handleUnsubscribe(SessionUnsubscribeEvent event) {
		StompHeaderAccessor acc = StompHeaderAccessor.wrap(event.getMessage());
		String sessionId = acc.getSessionId();
		if (sessionId != null) {
			frameSubscribers.remove(sessionId);
			log.info("[Unity] unsubscribe -{}  (total={})", sessionId, frameSubscribers.size());
		}
	}

	@EventListener
	public void handleDisconnect(SessionDisconnectEvent event) {
		StompHeaderAccessor acc = StompHeaderAccessor.wrap(event.getMessage());
		String sessionId = acc.getSessionId();
		if (sessionId != null) {
			frameSubscribers.remove(sessionId);
			log.info("[Unity] disconnect  -{}  (total={})", sessionId, frameSubscribers.size());
		}
	}

	// ── REST endpoints ─────────────────────────────────────────────────────────

	/** GET /api/unity/status — {"connected": true/false} */
	@GetMapping("/status")
	public Map<String, Object> getStatus() {
		return Map.of("connected", !frameSubscribers.isEmpty());
	}

	/** POST /api/unity/mode — {"mode":"live"} → broadcast to /topic/unity-control */
	@PostMapping("/mode")
	public Map<String, String> setMode(@RequestBody Map<String, String> body) {
		messaging.convertAndSend("/topic/unity-control", body);
		log.info("[Unity] mode → {}", body.get("mode"));
		return Map.of("status", "ok");
	}

	/** POST /api/unity/frame — receives a single frame and immediately broadcasts it to /topic/frames */
	@PostMapping("/frame")
	public Map<String, String> sendFrame(@RequestBody Object frame) {
		messaging.convertAndSend("/topic/frames", frame);
		log.debug("[Unity] single frame forwarded");
		return Map.of("status", "ok");
	}

	/** POST /api/unity/replay — {frames:[...], speed:1} → sends frames one by one with delay */
	@PostMapping("/replay")
	public Map<String, String> replay(@RequestBody Map<String, Object> body) {
		Object framesObj = body.get("frames");
		Object speedObj  = body.get("speed");
		double speed     = speedObj instanceof Number n ? n.doubleValue() : 1.0;
		speed            = Math.max(0.1, speed);

		if (!(framesObj instanceof List<?> frames) || frames.isEmpty()) {
			return Map.of("status", "error", "message", "No frames provided");
		}

		long delayMs = (long) (1000.0 / speed);
		log.info("[Unity] replay {} frames @ {}x ({}ms delay)", frames.size(), speed, delayMs);

		replayExecutor.submit(() -> {
			for (Object frame : frames) {
				messaging.convertAndSend("/topic/frames", frame);
				if (delayMs > 0) {
					try { Thread.sleep(delayMs); }
					catch (InterruptedException e) {
						Thread.currentThread().interrupt();
						break;
					}
				}
			}
			log.info("[Unity] replay complete");
		});

		return Map.of("status", "started");
	}
}

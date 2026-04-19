package com.molka.smart_analyzer_backend.simulator;

import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

@Controller
public class SimulationController {

	private final SimulationEngine engine;

	public SimulationController(SimulationEngine engine) {
		this.engine = engine;
	}

	@MessageMapping("/simulate/start")
	public void start() {
		engine.start();
	}

	@MessageMapping("/simulate/pause")
	public void pause() {
		engine.pause();
	}

	@MessageMapping("/simulate/resume")
	public void resume() {
		engine.resume();
	}

	@MessageMapping("/simulate/stop")
	public void stop() {
		engine.stop();
	}

	@MessageMapping("/simulate/reset")
	public void reset() {
		engine.reset();
	}

	@MessageMapping("/simulate/speed")
	public void speed(SpeedPayload payload) {
		engine.setSpeed(payload.multiplier());
	}
}

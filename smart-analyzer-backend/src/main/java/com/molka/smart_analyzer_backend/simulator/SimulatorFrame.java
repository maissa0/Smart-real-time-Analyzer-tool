package com.molka.smart_analyzer_backend.simulator;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

public class SimulatorFrame {

	public double timestamp;
	public int channel;
	public String address;
	public String message;
	public String bus;
	public String direction;

	@JsonProperty("raw_data")
	public List<Integer> rawData;

	@JsonProperty("parsed_signals")
	public List<SignalValue> parsedSignals;

	public static class SignalValue {
		public String name;

		@JsonProperty("raw_value")
		public int rawValue;

		public String value;

		@JsonProperty("is_valid")
		public boolean isValid;

		@JsonProperty("all_states")
		public Map<String, String> allStates;
	}
}

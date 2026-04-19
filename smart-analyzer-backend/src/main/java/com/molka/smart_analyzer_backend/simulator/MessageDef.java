package com.molka.smart_analyzer_backend.simulator;

import java.util.List;

public record MessageDef(String messageName, String address, String bus, List<SignalDef> signals) {}

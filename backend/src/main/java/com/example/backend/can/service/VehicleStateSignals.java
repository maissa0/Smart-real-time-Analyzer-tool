package com.example.backend.can.service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The vehicle-state signals captured as operating-context for a fault. Shared by
 * {@link IntegrityAnalyzerService} (snapshot at detection) and
 * {@link DiagnosticEnrichmentService} (on-demand back-fill from InfluxDB) so both
 * describe context identically. Names come straight from the CAN catalogues.
 */
final class VehicleStateSignals {

    private VehicleStateSignals() {}

    /** Always-captured vehicle state: gear / speed / engine / key / doors. */
    static final Set<String> BASE = new LinkedHashSet<>(List.of(
            "Gear_Position", "Gear_Number", "Transmission_Mode",
            "Speed_High", "Wheel_Speed_FL", "Wheel_Speed_FR", "Wheel_Speed_RL", "Wheel_Speed_RR",
            "Engine_State", "Engine_RPM_High", "Engine_Temp",
            "KEY_Pos", "Key_In_Ignition_Alert",
            "Drd_Status", "PSD_Status", "DRDR_Status", "Psdr_Status", "Bootlid_Status", "Hood_Status"));

    /** Extra context added only for faults on the ADAS_CAN bus (driving-assist state). */
    static final Set<String> ADAS = new LinkedHashSet<>(List.of(
            "ACC_State", "Forward_Collision_State", "Lane_Departure_State", "Lane_Keep_Assist_State",
            "Left_Blind_Spot_State", "Right_Blind_Spot_State", "Following_Distance"));

    static final String ADAS_BUS = "ADAS_CAN";

    /** BASE ∪ ADAS — the full set to query when the subsystem is unknown (on-demand back-fill). */
    static final Set<String> ALL;
    static {
        Set<String> all = new LinkedHashSet<>(BASE);
        all.addAll(ADAS);
        ALL = all;
    }
}

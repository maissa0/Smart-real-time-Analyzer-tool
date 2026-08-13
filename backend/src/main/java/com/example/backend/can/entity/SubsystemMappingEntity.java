package com.example.backend.can.entity;

import jakarta.persistence.*;
import lombok.*;

/** Maps a CAN message name to its owning subsystem (seeded from the catalogue Bus name). */
@Entity
@Table(name = "subsystem_mapping",
        uniqueConstraints = @UniqueConstraint(name = "uk_subsystem_msg", columnNames = "msg_name"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SubsystemMappingEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "msg_name", nullable = false)
    private String msgName;

    /** Friendly subsystem label, e.g. "ADAS & Safety". */
    @Column(name = "subsystem", nullable = false)
    private String subsystem;
}

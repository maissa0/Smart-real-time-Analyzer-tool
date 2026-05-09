package com.example.backend.can.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "can_frames")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CanFrameEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id")
    private String sessionId;

    @Column(name = "timestamp")
    private Double timestamp;

    @Column(name = "channel")
    private Integer channel;

    @Column(name = "channel_name")
    private String channelName;

    @Column(name = "msg_id")
    private String msgId;

    @Column(name = "msg_name")
    private String msgName;

    @Column(name = "direction")
    private String direction;

    @Column(name = "raw_bytes", length = 30)
    private String rawBytes;

    @Column(name = "signals", columnDefinition = "json")
    private String signals;
}

package com.example.backend.can.repository;

import com.example.backend.can.entity.CanFrameEntity;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * CanFrameEntity is no longer persisted (frames live in InfluxDB — see
 * InfluxWriteService/InfluxQueryService); this repository is kept only for
 * deleteBySessionId(), which cleans up any legacy rows from before the
 * InfluxDB migration when a session is deleted.
 */
public interface CanFrameRepository extends JpaRepository<CanFrameEntity, Long> {
    void deleteBySessionId(String sessionId);
}

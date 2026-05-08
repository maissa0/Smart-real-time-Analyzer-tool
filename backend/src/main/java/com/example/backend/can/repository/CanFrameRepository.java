package com.example.backend.can.repository;

import com.example.backend.can.entity.CanFrameEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CanFrameRepository extends JpaRepository<CanFrameEntity, Long> {

    List<CanFrameEntity> findBySessionIdOrderByTimestampAsc(String sessionId);

    List<CanFrameEntity> findBySessionIdAndMsgIdOrderByTimestampAsc(String sessionId, String msgId);

    long countBySessionId(String sessionId);

    void deleteBySessionId(String sessionId);
}

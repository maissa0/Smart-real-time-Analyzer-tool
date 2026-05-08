package com.example.backend.can.repository;

import com.example.backend.can.entity.IntegrityFaultEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface IntegrityFaultRepository extends JpaRepository<IntegrityFaultEntity, Long> {

    List<IntegrityFaultEntity> findBySessionIdOrderByFrameTimestampAsc(String sessionId);

    long countBySessionId(String sessionId);

    long countBySessionIdAndFaultType(String sessionId, String faultType);

    @Query("SELECT DISTINCT i.msgId FROM IntegrityFaultEntity i WHERE i.sessionId = :sessionId")
    List<String> findDistinctMsgIdsBySessionId(String sessionId);

    void deleteBySessionId(String sessionId);
}

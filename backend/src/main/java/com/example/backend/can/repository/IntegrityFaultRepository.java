package com.example.backend.can.repository;

import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.entity.IntegrityFaultEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Repository
public interface IntegrityFaultRepository extends JpaRepository<IntegrityFaultEntity, Long> {

    List<IntegrityFaultEntity> findBySessionIdOrderByFrameTimestampAsc(String sessionId);

    /**
     * Findings of one detection layer (SPEC | REQUIREMENT | ML) for a session —
     * used by the requirements report fallback once in-memory state is cleared.
     */
    List<IntegrityFaultEntity> findBySessionIdAndLayerOrderByFrameTimestampAsc(
            String sessionId, String layer);

    /**
     * Findings NOT from the given layer — the clean-session verdict counts
     * SPEC+REQUIREMENT findings (excluding advisory ML ones) so the anomaly
     * engine only trains its baselines on genuinely clean sessions.
     */
    long countBySessionIdAndLayerNot(String sessionId, String layer);

    long countBySessionId(String sessionId);

    /**
     * Count total faults for all sessions belonging to a car.
     * Used to compute fault rate per car.
     */
    @Query("SELECT COUNT(f) FROM IntegrityFaultEntity f " +
           "JOIN CanSessionEntity s ON f.sessionId = s.sessionId " +
           "WHERE s.carId = :carId")
    long countFaultsByCarId(@Param("carId") Long carId);

    long countBySessionIdAndFaultType(String sessionId, String faultType);

    @Query("SELECT DISTINCT i.msgId FROM IntegrityFaultEntity i WHERE i.sessionId = :sessionId")
    List<String> findDistinctMsgIdsBySessionId(String sessionId);

    void deleteBySessionId(String sessionId);

    /**
     * Record a repeat occurrence of an already-persisted fault without inserting
     * a new row — flood control for stuck signals on fast cyclic messages.
     */
    @Modifying
    @Transactional
    @Query("UPDATE IntegrityFaultEntity f SET f.occurrences = f.occurrences + 1, "
            + "f.lastSeenTs = :ts WHERE f.id = :id")
    int incrementOccurrences(@Param("id") Long id, @Param("ts") Double ts);

    /**
     * Count faults grouped by fault type — for dashboard fault breakdown widget.
     * Returns List<Object[]> { faultType(String), count(Long) }
     */
    @Query("SELECT f.faultType, COUNT(f) FROM IntegrityFaultEntity f GROUP BY f.faultType")
    List<Object[]> countByFaultType();

    // ── Phase 5 correlation (targeted updates so they cannot race the
    //    occurrence counter the way a full entity save() would) ──────────────

    /** Assign a finding to a root-cause cluster. */
    @Modifying
    @Transactional
    @Query("UPDATE IntegrityFaultEntity f SET f.clusterId = :clusterId WHERE f.id = :id")
    int updateClusterId(@Param("id") Long id, @Param("clusterId") String clusterId);

    /** Replace a finding's correlation links. */
    @Modifying
    @Transactional
    @Query("UPDATE IntegrityFaultEntity f SET f.correlationJson = :json WHERE f.id = :id")
    int updateCorrelationJson(@Param("id") Long id, @Param("json") String json);

    /**
     * Apply an ML↔REQUIREMENT merge to an ML finding: adopt the requirement
     * finding's cluster, record the link, and boost the advisory severity.
     */
    @Modifying
    @Transactional
    @Query("UPDATE IntegrityFaultEntity f SET f.clusterId = :clusterId, "
            + "f.severity = :severity, f.correlationJson = :json WHERE f.id = :id")
    int applyMlCorrelation(@Param("id") Long id, @Param("clusterId") String clusterId,
                           @Param("severity") String severity, @Param("json") String json);
}

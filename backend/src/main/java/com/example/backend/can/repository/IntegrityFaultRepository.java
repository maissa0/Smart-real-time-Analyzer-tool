package com.example.backend.can.repository;

import com.example.backend.can.entity.CanSessionEntity;
import com.example.backend.can.entity.IntegrityFaultEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface IntegrityFaultRepository extends JpaRepository<IntegrityFaultEntity, Long> {

    List<IntegrityFaultEntity> findBySessionIdOrderByFrameTimestampAsc(String sessionId);

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
     * Count faults grouped by fault type — for dashboard fault breakdown widget.
     * Returns List<Object[]> { faultType(String), count(Long) }
     */
    @Query("SELECT f.faultType, COUNT(f) FROM IntegrityFaultEntity f GROUP BY f.faultType")
    List<Object[]> countByFaultType();
}

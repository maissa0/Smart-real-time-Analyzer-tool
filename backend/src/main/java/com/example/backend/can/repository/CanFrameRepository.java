package com.example.backend.can.repository;

import com.example.backend.can.entity.CanFrameEntity;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface CanFrameRepository extends JpaRepository<CanFrameEntity, Long> {

    List<CanFrameEntity> findBySessionIdOrderByTimestampAsc(String sessionId);

    List<CanFrameEntity> findBySessionIdAndMsgIdOrderByTimestampAsc(String sessionId, String msgId);

    long countBySessionId(String sessionId);

    void deleteBySessionId(String sessionId);

    /**
     * Top N message IDs by frame count — for dashboard "top messages" widget.
     * Returns List<Object[]> { msgId(String), count(Long) }
     */
    @Query("SELECT f.msgId, COUNT(f) FROM CanFrameEntity f " +
           "WHERE f.msgId IS NOT NULL " +
           "GROUP BY f.msgId ORDER BY COUNT(f) DESC")
    List<Object[]> findTopMsgIds(Pageable pageable);
}

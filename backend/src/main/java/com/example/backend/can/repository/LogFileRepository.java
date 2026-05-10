package com.example.backend.can.repository;

import com.example.backend.can.entity.LogFileEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface LogFileRepository extends JpaRepository<LogFileEntity, Long> {
    Optional<LogFileEntity> findBySessionId(String sessionId);

    void deleteBySessionId(String sessionId);

    @Query(value = "SELECT * FROM log_files ORDER BY created_at DESC LIMIT :size",
            nativeQuery = true)
    List<LogFileEntity> findTopNOrderByCreatedAtDesc(@Param("size") int size);
}

package com.example.backend.can.repository;

import com.example.backend.can.entity.LogFileEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface LogFileRepository extends JpaRepository<LogFileEntity, Long> {
    Optional<LogFileEntity> findBySessionId(String sessionId);

    void deleteBySessionId(String sessionId);
}

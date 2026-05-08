package com.example.backend.repository;

import com.example.backend.entity.SessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SessionRepository extends JpaRepository<SessionEntity, UUID> {

    List<SessionEntity> findByUserIdOrderByLastActiveDesc(UUID userId);
}

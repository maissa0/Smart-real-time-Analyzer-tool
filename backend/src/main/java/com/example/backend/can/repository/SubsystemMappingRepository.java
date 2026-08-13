package com.example.backend.can.repository;

import com.example.backend.can.entity.SubsystemMappingEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SubsystemMappingRepository extends JpaRepository<SubsystemMappingEntity, Long> {

    Optional<SubsystemMappingEntity> findByMsgName(String msgName);
}

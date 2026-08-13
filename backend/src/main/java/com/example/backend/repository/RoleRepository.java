package com.example.backend.repository;

import com.example.backend.entity.RoleEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RoleRepository extends JpaRepository<RoleEntity, UUID> {

    Optional<RoleEntity> findByName(String name);

    List<RoleEntity> findByIdIn(List<UUID> ids);
}

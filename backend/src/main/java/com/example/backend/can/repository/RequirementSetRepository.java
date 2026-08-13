package com.example.backend.can.repository;

import com.example.backend.can.entity.RequirementSetEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface RequirementSetRepository extends JpaRepository<RequirementSetEntity, Long> {

    Optional<RequirementSetEntity> findByFilename(String filename);

    boolean existsByFilename(String filename);

    void deleteByFilename(String filename);

    List<RequirementSetEntity> findAllByOrderByFilenameAsc();
}

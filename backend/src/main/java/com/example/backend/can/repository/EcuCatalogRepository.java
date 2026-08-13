package com.example.backend.can.repository;

import com.example.backend.can.entity.EcuCatalogEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface EcuCatalogRepository extends JpaRepository<EcuCatalogEntity, Long> {
    Optional<EcuCatalogEntity> findByFilename(String filename);
    void deleteByFilename(String filename);

    @Query("SELECT e.filename FROM EcuCatalogEntity e")
    List<String> findAllFilenames();
}

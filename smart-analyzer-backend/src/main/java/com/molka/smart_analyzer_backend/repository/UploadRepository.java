package com.molka.smart_analyzer_backend.repository;

import com.molka.smart_analyzer_backend.entity.UploadRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface UploadRepository extends JpaRepository<UploadRecord, Long> {
	List<UploadRecord> findByUsernameOrderByUploadedAtDesc(String username);
}

package com.molka.smart_analyzer_backend.repository;

import com.molka.smart_analyzer_backend.entity.Frame;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FrameRepository extends JpaRepository<Frame, Long> {
	List<Frame> findByAddress(String address);

	List<Frame> findByBus(String bus);
}


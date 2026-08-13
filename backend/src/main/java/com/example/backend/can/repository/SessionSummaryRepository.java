package com.example.backend.can.repository;

import com.example.backend.can.entity.SessionSummary;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SessionSummaryRepository extends JpaRepository<SessionSummary, String> {}
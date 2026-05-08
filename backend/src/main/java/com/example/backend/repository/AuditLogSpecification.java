package com.example.backend.repository;

import com.example.backend.entity.AuditLogEntity;
import org.springframework.data.jpa.domain.Specification;

import java.util.UUID;

public final class AuditLogSpecification {

    private AuditLogSpecification() {}

    public static Specification<AuditLogEntity> withAction(String action) {
        if (action == null || action.isBlank()) return (root, query, cb) -> cb.conjunction();
        return (root, query, cb) -> cb.equal(root.get("action"), action);
    }

    public static Specification<AuditLogEntity> withUserId(UUID userId) {
        if (userId == null) return (root, query, cb) -> cb.conjunction();
        return (root, query, cb) -> cb.equal(root.get("userId"), userId);
    }
}

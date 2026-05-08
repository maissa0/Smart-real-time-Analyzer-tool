package com.example.backend.specification;

import com.example.backend.entity.UserEntity;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * JPA Specification for dynamic user filtering.
 * Supports: search (fuzzy on name/email/username), status (is_active), role.
 */
public final class UserSpecification {

    private UserSpecification() {
    }

    public static Specification<UserEntity> withFilters(
            String search,
            Boolean isActive,
            UUID roleId
    ) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            predicates.add(cb.isNull(root.get("deletedAt")));

            if (search != null && !search.isBlank()) {
                String pattern = "%" + search.toLowerCase() + "%";
                predicates.add(cb.or(
                        cb.like(cb.lower(root.get("email")), pattern),
                        cb.like(cb.lower(root.get("username")), pattern),
                        cb.like(cb.lower(cb.coalesce(root.get("fullName"), "")), pattern)
                ));
            }

            if (isActive != null) {
                predicates.add(cb.equal(root.get("isActive"), isActive));
            }

            if (roleId != null) {
                predicates.add(cb.equal(
                        root.join("roles", JoinType.INNER).get("id"),
                        roleId
                ));
            }

            return cb.and(predicates.toArray(Predicate[]::new));
        };
    }
}

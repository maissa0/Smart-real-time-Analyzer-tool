package com.example.backend.can.dto;

import com.example.backend.can.entity.DiagnosticRuleEntity;

/** API shape for a diagnostic rule (create/update/list). */
public record DiagnosticRuleDto(
        Long id,
        String scope,
        String matchKey,
        String faultType,
        String subsystem,
        String title,
        String meaning,
        String likelyCause,
        String whatToCheck,
        int severityWeight,
        String displayName,
        boolean enabled,
        boolean builtin,
        String updatedBy
) {
    public static DiagnosticRuleDto from(DiagnosticRuleEntity e) {
        return new DiagnosticRuleDto(
                e.getId(), e.getScope(), e.getMatchKey(), e.getFaultType(),
                e.getSubsystem(), e.getTitle(), e.getMeaning(), e.getLikelyCause(),
                e.getWhatToCheck(), e.getSeverityWeight(), e.getDisplayName(),
                e.isEnabled(), e.isBuiltin(), e.getUpdatedBy());
    }
}

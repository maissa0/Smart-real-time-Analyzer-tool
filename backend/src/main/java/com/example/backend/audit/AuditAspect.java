package com.example.backend.audit;

import com.example.backend.security.CurrentUserService;
import com.example.backend.service.AuditService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Map;
import java.util.UUID;

/**
 * AOP Aspect that automatically logs audit entries for methods annotated with @AuditLog.
 * Captures: userId (actor), action, resourceId, timestamp, clientIp.
 */
@Aspect
@Component
@RequiredArgsConstructor
@Slf4j
public class AuditAspect {

    private final AuditService auditService;
    private final CurrentUserService currentUserService;

    @Around("@annotation(auditLog)")
    public Object aroundAuditedMethod(ProceedingJoinPoint joinPoint, AuditLog auditLog) throws Throwable {
        Object result = joinPoint.proceed();

        try {
            UUID userId = currentUserService.getCurrentUserId().orElse(null);
            String resourceId = extractResourceId(joinPoint, auditLog.resourceIdParam());
            HttpServletRequest request = getCurrentRequest();

            auditService.logAudit(
                    auditLog.action(),
                    auditLog.resource(),
                    resourceId,
                    userId,
                    Map.of("endpoint", joinPoint.getSignature().getName()),
                    request
            );
        } catch (Exception e) {
            log.warn("Failed to write audit log for {}: {}", auditLog.action(), e.getMessage());
        }

        return result;
    }

    private String extractResourceId(ProceedingJoinPoint joinPoint, String paramName) {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        String[] paramNames = signature.getParameterNames();
        Object[] args = joinPoint.getArgs();

        for (int i = 0; i < paramNames.length; i++) {
            if (paramNames[i].equals(paramName) && args[i] != null) {
                return args[i].toString();
            }
        }
        return null;
    }

    private HttpServletRequest getCurrentRequest() {
        ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return attrs != null ? attrs.getRequest() : null;
    }
}

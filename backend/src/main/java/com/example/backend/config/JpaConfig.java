package com.example.backend.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

import java.util.concurrent.TimeUnit;

@Configuration
@EnableJpaAuditing
@EnableCaching
public class JpaConfig {

    /**
     * Caffeine cache manager with 30-second TTL.
     * Used by @Cacheable("dashboard-stats") on DashboardController.
     * Prevents full table scans on every dashboard page load.
     */
    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager("dashboard-stats");
        manager.setCaffeine(
            Caffeine.newBuilder()
                .expireAfterWrite(30, TimeUnit.SECONDS)
                .maximumSize(100)
        );
        return manager;
    }
}

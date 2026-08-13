package com.example.backend.can.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import java.time.LocalDateTime;

@Entity
@Table(name = "ecu_catalogs")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EcuCatalogEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "filename", nullable = false, unique = true, length = 255)
    private String filename;

    @Column(name = "bus_name", nullable = false, length = 64)
    private String busName;

    @Column(name = "version", length = 20)
    private String version;

    @Column(name = "description", length = 500)
    private String description;

    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private Boolean isActive = true;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}

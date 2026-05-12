package com.example.backend.dto.user;

import com.example.backend.dto.role.RoleResponse;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserResponse {

    private String id;
    private String email;
    private String username;
    private String fullName;
    private String jobTitle;
    private String department;
    private String timezone;
    private String phone;
    private String bio;
    private String avatarUrl;
    private Boolean isActive;
    private Boolean mfaEnabled;
    private Boolean verified;
    private String status;
    private Instant createdAt;
    private List<RoleResponse> roles;
}

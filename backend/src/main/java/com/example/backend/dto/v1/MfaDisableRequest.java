package com.example.backend.dto.v1;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MfaDisableRequest {

    @NotBlank(message = "Current password is required")
    private String password;
}

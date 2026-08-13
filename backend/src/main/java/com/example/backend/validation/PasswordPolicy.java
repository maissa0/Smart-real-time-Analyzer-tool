package com.example.backend.validation;

public final class PasswordPolicy {

    // Length is enforced here directly ({8,}) so the complexity guarantee holds
    // even if a future call site applies this pattern without a separate @Size.
    public static final String PATTERN = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$";
    public static final String MESSAGE =
            "Password must be at least 8 characters and contain at least one uppercase letter, "
                    + "one lowercase letter, and one digit";

    private PasswordPolicy() {
    }
}

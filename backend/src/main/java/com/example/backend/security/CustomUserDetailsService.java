package com.example.backend.security;

import com.example.backend.entity.RoleEntity;
import com.example.backend.entity.UserEntity;
import com.example.backend.repository.PermissionRepository;
import com.example.backend.repository.RoleRepository;
import com.example.backend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        UserEntity user = userRepository.findByEmailAndDeletedAtIsNull(email)
                .orElseThrow(() -> new UsernameNotFoundException("User not found: " + email));

        if (!Boolean.TRUE.equals(user.getIsActive())) {
            throw new UsernameNotFoundException("Account Disabled");
        }

        List<RoleEntity> roles = (user.getRoleIds() == null || user.getRoleIds().isEmpty())
                ? List.of()
                : roleRepository.findByIdIn(new ArrayList<>(user.getRoleIds()));

        // Collect all permission IDs: role permissions + per-user overrides
        var permIdSet = roles.stream()
                .flatMap(r -> r.getPermissionIds().stream())
                .collect(Collectors.toCollection(HashSet::new));
        if (user.getExtraPermissionIds() != null) {
            permIdSet.addAll(user.getExtraPermissionIds());
        }

        var authorities = permIdSet.isEmpty()
                ? new HashSet<SimpleGrantedAuthority>()
                : permissionRepository.findByIdIn(new ArrayList<>(permIdSet)).stream()
                        .map(p -> new SimpleGrantedAuthority(p.getSlug()))
                        .collect(Collectors.toCollection(HashSet::new));

        // Add role-based authority for @PreAuthorize("hasRole('ADMIN')")
        roles.forEach(role ->
                authorities.add(new SimpleGrantedAuthority("ROLE_" + role.getName().toUpperCase().replace(" ", "_")))
        );

        return User.builder()
                .username(user.getEmail())
                .password(user.getPasswordHash())
                .authorities(authorities)
                .accountExpired(false)
                .accountLocked(false)
                .credentialsExpired(false)
                .disabled(!user.getIsActive())
                .build();
    }
}

package com.example.backend.can.controller;

import com.example.backend.audit.AuditLog;
import com.example.backend.can.dto.CanSessionResponse;
import com.example.backend.can.dto.CarCatalogAssignRequest;
import com.example.backend.can.dto.CarCatalogDto;
import com.example.backend.can.dto.CarCreateRequest;
import com.example.backend.can.dto.CarDto;
import com.example.backend.can.dto.CarUpdateRequest;
import com.example.backend.can.dto.RequirementDtos.AssignRequest;
import com.example.backend.can.dto.RequirementDtos.CarRequirementDto;
import com.example.backend.can.service.CarService;
import com.example.backend.security.CurrentUserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/cars")
@RequiredArgsConstructor
@Slf4j
public class CarController {

    private final CarService carService;
    private final CurrentUserService currentUserService;

    @PreAuthorize("hasAuthority('car:read') or hasRole('ADMIN')")
    @GetMapping
    public ResponseEntity<List<CarDto>> getMyCars() {
        return ResponseEntity.ok(carService.getAllCars());
    }

    @PreAuthorize("hasAuthority('car:write') or hasRole('ADMIN')")
    @AuditLog(action = "CAR_CREATE", resource = "cars")
    @PostMapping
    public ResponseEntity<CarDto> createCar(@Valid @RequestBody CarCreateRequest request) {
        UUID userId = requireCurrentUserId();
        CarDto created = carService.createCar(request, uuidToBytes(userId));
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PreAuthorize("hasAuthority('car:read') or hasRole('ADMIN')")
    @GetMapping("/{carUid}")
    public ResponseEntity<CarDto> getCar(@PathVariable String carUid) {
        return ResponseEntity.ok(carService.getCarByUid(carUid));
    }

    @PreAuthorize("hasAuthority('car:write') or hasRole('ADMIN')")
    @AuditLog(action = "CAR_UPDATE", resource = "cars", resourceIdParam = "carUid")
    @PutMapping("/{carUid}")
    public ResponseEntity<CarDto> updateCar(
            @PathVariable String carUid,
            @Valid @RequestBody CarUpdateRequest request) {
        return ResponseEntity.ok(carService.updateCar(carUid, request));
    }

    @PreAuthorize("hasAuthority('car:delete') or hasRole('ADMIN')")
    @AuditLog(action = "CAR_DELETE", resource = "cars", resourceIdParam = "carUid")
    @DeleteMapping("/{carUid}")
    public ResponseEntity<Void> deleteCar(@PathVariable String carUid) {
        carService.softDeleteCar(carUid);
        return ResponseEntity.noContent().build();
    }

    @PreAuthorize("hasAuthority('car:read') or hasRole('ADMIN')")
    @GetMapping("/{carUid}/sessions")
    public ResponseEntity<List<CanSessionResponse>> getCarSessions(
            @PathVariable String carUid) {
        return ResponseEntity.ok(carService.getSessionsByCarUid(carUid));
    }

    /** Catalogs assigned to this car — empty list means "all catalogs". */
    @PreAuthorize("hasAuthority('car:read') or hasRole('ADMIN')")
    @GetMapping("/{carUid}/catalogs")
    public ResponseEntity<List<CarCatalogDto>> getCarCatalogs(@PathVariable String carUid) {
        return ResponseEntity.ok(carService.getCarCatalogs(carUid));
    }

    /** Replace the car's assigned catalog set (empty list clears the assignment). */
    @PreAuthorize("hasAuthority('car:write') or hasRole('ADMIN')")
    @AuditLog(action = "CAR_CATALOGS_UPDATE", resource = "cars", resourceIdParam = "carUid")
    @PutMapping("/{carUid}/catalogs")
    public ResponseEntity<List<CarCatalogDto>> setCarCatalogs(
            @PathVariable String carUid,
            @Valid @RequestBody CarCatalogAssignRequest request) {
        return ResponseEntity.ok(carService.setCarCatalogs(carUid, request.filenames()));
    }

    /** Requirement sets assigned to this car — empty list = requirements engine off. */
    @PreAuthorize("hasAuthority('car:read') or hasRole('ADMIN')")
    @GetMapping("/{carUid}/requirements")
    public ResponseEntity<List<CarRequirementDto>> getCarRequirements(@PathVariable String carUid) {
        return ResponseEntity.ok(carService.getCarRequirements(carUid));
    }

    /** Replace the car's assigned requirement sets (empty list clears the assignment). */
    @PreAuthorize("hasAuthority('car:write') or hasRole('ADMIN')")
    @AuditLog(action = "CAR_REQUIREMENTS_UPDATE", resource = "cars", resourceIdParam = "carUid")
    @PutMapping("/{carUid}/requirements")
    public ResponseEntity<List<CarRequirementDto>> setCarRequirements(
            @PathVariable String carUid,
            @RequestBody AssignRequest request) {
        List<String> filenames = request != null && request.filenames() != null
                ? request.filenames() : List.of();
        return ResponseEntity.ok(carService.setCarRequirements(carUid, filenames));
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private UUID requireCurrentUserId() {
        return currentUserService.getCurrentUserId()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "Authentication required"));
    }

    private byte[] uuidToBytes(UUID uuid) {
        long msb = uuid.getMostSignificantBits();
        long lsb = uuid.getLeastSignificantBits();
        byte[] bytes = new byte[16];
        for (int i = 7; i >= 0; i--) {
            bytes[i]     = (byte) (msb & 0xFF); msb >>= 8;
            bytes[i + 8] = (byte) (lsb & 0xFF); lsb >>= 8;
        }
        return bytes;
    }
}

package com.example.backend.can.controller;

import com.example.backend.can.dto.CanSessionResponse;
import com.example.backend.can.dto.CarCreateRequest;
import com.example.backend.can.dto.CarDto;
import com.example.backend.can.dto.CarUpdateRequest;
import com.example.backend.can.entity.CarEntity;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.service.CanSessionService;
import com.example.backend.can.service.CarService;
import com.example.backend.security.CurrentUserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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

/**
 * REST controller for vehicle (Car) fleet management.
 *
 * All endpoints require authentication (enforced by SecurityConfig
 * anyRequest().authenticated()).
 *
 * Ownership check: users can only access their own cars unless they
 * have ROLE_ADMIN. Admin bypass is handled in isOwnerOrAdmin().
 *
 * Base path: /api/cars
 */
@RestController
@RequestMapping("/api/cars")
@RequiredArgsConstructor
@Slf4j
public class CarController {

    private final CarService carService;
    private final CarRepository carRepository;
    private final CanSessionService canSessionService;
    private final CurrentUserService currentUserService;

    // ── GET /api/cars ─────────────────────────────────────────────────────────

    /**
     * List all active cars owned by the authenticated user.
     * Admin users see all active cars.
     *
     * @return 200 OK with list of CarDto
     */
    @GetMapping
    public ResponseEntity<List<CarDto>> getMyCars() {
        // Return all active cars for all authenticated users.
        // Per-user ownership filtering is reserved for a future
        // multi-tenant deployment where users manage private fleets.
        // For the current single-organisation deployment (KPIT PFE),
        // all users share visibility of the full vehicle fleet.
        return ResponseEntity.ok(carService.getAllCars());
    }

    // ── POST /api/cars ────────────────────────────────────────────────────────

    /**
     * Create a new car for the authenticated user.
     *
     * @param request validated create request (make, model, year required)
     * @return 201 Created with the new CarDto
     */
    @PostMapping
    public ResponseEntity<CarDto> createCar(@Valid @RequestBody CarCreateRequest request) {
        UUID userId = requireCurrentUserId();
        byte[] ownerUserIdBytes = uuidToBytes(userId);
        CarDto created = carService.createCar(request, ownerUserIdBytes);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    // ── GET /api/cars/{carUid} ────────────────────────────────────────────────

    /**
     * Get a single car with computed stats (sessionCount, totalFrames, faultRate).
     *
     * @param carUid public UUID of the car
     * @return 200 OK with CarDto including stats, or 403/404
     */
    @GetMapping("/{carUid}")
    public ResponseEntity<CarDto> getCar(@PathVariable String carUid) {
        CarDto dto = carService.getCarByUid(carUid);
        return ResponseEntity.ok(dto);
    }

    // ── PUT /api/cars/{carUid} ────────────────────────────────────────────────

    /**
     * Update a car's mutable fields (PATCH semantics — only non-null fields applied).
     *
     * @param carUid   public UUID of the car
     * @param request  fields to update
     * @return 200 OK with updated CarDto
     */
    @PutMapping("/{carUid}")
    public ResponseEntity<CarDto> updateCar(
            @PathVariable String carUid,
            @Valid @RequestBody CarUpdateRequest request) {
        CarDto updated = carService.updateCar(carUid, request);
        return ResponseEntity.ok(updated);
    }

    // ── DELETE /api/cars/{carUid} ─────────────────────────────────────────────

    /**
     * Soft-delete a car (sets deletedAt, isActive = false).
     * Sessions and frames are preserved.
     *
     * @param carUid public UUID of the car
     * @return 204 No Content
     */
    @DeleteMapping("/{carUid}")
    public ResponseEntity<Void> deleteCar(@PathVariable String carUid) {
        carService.softDeleteCar(carUid);
        return ResponseEntity.noContent().build();
    }

    // ── GET /api/cars/{carUid}/sessions ───────────────────────────────────────

    /**
     * List all CAN sessions belonging to a specific car.
     *
     * @param carUid public UUID of the car
     * @return 200 OK with list of CanSessionResponse
     */
    @GetMapping("/{carUid}/sessions")
    public ResponseEntity<List<CanSessionResponse>> getCarSessions(
            @PathVariable String carUid) {
        // No ownership check — all authenticated users can view sessions
        // for any fleet car (single-org deployment).
        Long carId = carRepository.findByCarUid(carUid)
                .filter(c -> c.getDeletedAt() == null)
                .map(CarEntity::getId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Car not found: " + carUid));
        List<CanSessionResponse> sessions = canSessionService.getSessionsByCarId(carId);
        return ResponseEntity.ok(sessions);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Get the current user's UUID or throw 401 if not authenticated.
     */
    private UUID requireCurrentUserId() {
        return currentUserService.getCurrentUserId()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "Authentication required"));
    }

    /**
     * Convert UUID to byte[16] for BINARY(16) column comparison.
     * UUID bytes: most significant bits first, then least significant bits.
     */
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

    /**
     * Check if the authenticated user owns the car, is an admin, or the car
     * has no owner (organisation-wide fleet / seeded vehicles like Legacy).
     * Throws 403 Forbidden only when the car is privately owned by another user.
     */
    private void checkOwnershipOrAdmin(String carUid) {
        if (isAdmin()) return;
        CarEntity car = carRepository.findByCarUid(carUid)
                .filter(c -> c.getDeletedAt() == null)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Car not found: " + carUid));
        if (car.getOwnerUserId() == null) {
            return;
        }
        UUID userId = requireCurrentUserId();
        byte[] ownerBytes = uuidToBytes(userId);
        if (java.util.Arrays.equals(car.getOwnerUserId(), ownerBytes)) {
            return;
        }
        throw new ResponseStatusException(
                HttpStatus.FORBIDDEN,
                "You do not have access to this car");
    }

    /**
     * Return true if the current user has ROLE_ADMIN.
     */
    private boolean isAdmin() {
        return currentUserService.getCurrentUserEmail()
                .map(email -> {
                    var auth = org.springframework.security.core.context
                            .SecurityContextHolder.getContext().getAuthentication();
                    return auth != null && auth.getAuthorities().stream()
                            .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
                })
                .orElse(false);
    }
}

package com.molka.smart_analyzer_backend.controller;

import com.molka.smart_analyzer_backend.dto.FrameRequest;
import com.molka.smart_analyzer_backend.dto.FrameResponse;
import com.molka.smart_analyzer_backend.entity.Frame;
import com.molka.smart_analyzer_backend.repository.FrameRepository;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/frames")
public class FrameController {

	private final FrameRepository frameRepository;

	public FrameController(FrameRepository frameRepository) {
		this.frameRepository = frameRepository;
	}

	@PostMapping
	public ResponseEntity<List<FrameResponse>> saveFrames(@Valid @RequestBody List<FrameRequest> frames) {
		List<Frame> toSave = frames.stream().map(this::toEntity).toList();
		List<Frame> saved = frameRepository.saveAll(toSave);
		return ResponseEntity.status(HttpStatus.CREATED).body(saved.stream().map(this::toResponse).toList());
	}

	@GetMapping
	public ResponseEntity<List<FrameResponse>> getAll() {
		List<FrameResponse> frames = frameRepository.findAll().stream()
				.map(this::toResponse)
				.collect(Collectors.toList());
		return ResponseEntity.ok(frames);
	}

	@GetMapping("/address/{address}")
	public ResponseEntity<List<FrameResponse>> getByAddress(@PathVariable String address) {
		String normalized = address.trim().toUpperCase();
		List<FrameResponse> frames = frameRepository.findByAddress(normalized).stream()
				.map(this::toResponse)
				.collect(Collectors.toList());
		return ResponseEntity.ok(frames);
	}

	@GetMapping("/bus/{bus}")
	public ResponseEntity<List<FrameResponse>> getByBus(@PathVariable String bus) {
		String normalized = bus.trim();
		List<FrameResponse> frames = frameRepository.findByBus(normalized).stream()
				.map(this::toResponse)
				.collect(Collectors.toList());
		return ResponseEntity.ok(frames);
	}

	@DeleteMapping
	public ResponseEntity<Void> deleteAll() {
		frameRepository.deleteAll();
		return ResponseEntity.noContent().build();
	}

	private Frame toEntity(FrameRequest req) {
		String normalizedAddress = req.address().trim().toUpperCase();
		return Frame.builder()
				.timestamp(req.timestamp())
				.address(normalizedAddress)
				.bus(req.bus().trim())
				.message(req.message().trim())
				.direction(req.direction().trim())
				.rawData(req.rawData())
				.signals(req.signals())
				.build();
	}

	private FrameResponse toResponse(Frame f) {
		return new FrameResponse(
				f.getId(),
				f.getTimestamp(),
				f.getAddress(),
				f.getBus(),
				f.getMessage(),
				f.getDirection(),
				f.getRawData(),
				f.getSignals(),
				f.getCreatedAt()
		);
	}
}


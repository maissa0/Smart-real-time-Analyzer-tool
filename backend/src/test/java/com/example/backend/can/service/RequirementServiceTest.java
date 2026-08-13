package com.example.backend.can.service;

import com.example.backend.can.config.RequirementProperties;
import com.example.backend.can.dto.CatalogDetailDto;
import com.example.backend.can.dto.CatalogSummaryDto;
import com.example.backend.can.dto.MessageDto;
import com.example.backend.can.dto.RequirementDtos.CreateRequest;
import com.example.backend.can.dto.RequirementDtos.EdgeDto;
import com.example.backend.can.dto.RequirementDtos.ExpectDto;
import com.example.backend.can.dto.RequirementDtos.MetaUpdateDto;
import com.example.backend.can.dto.RequirementDtos.RuleEditDto;
import com.example.backend.can.dto.RequirementDtos.SignalContextDto;
import com.example.backend.can.dto.RequirementDtos.SummaryDto;
import com.example.backend.can.dto.SignalDto;
import com.example.backend.can.dto.SignalValueDto;
import com.example.backend.can.entity.CarEntity;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.RequirementSetRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Structured-mutation + signal-context tests for RequirementService
 * (Phase A of docs/REQUIREMENTS_AUTHORING_PLAN.md). Uses a real loader over a
 * temp directory; DB repositories and the catalog service are mocked.
 */
class RequirementServiceTest {

    @TempDir
    Path dir;

    private RequirementSetRepository requirementSetRepository;
    private CarRepository carRepository;
    private CatalogService catalogService;
    private RequirementService service;

    @BeforeEach
    void setUp() {
        RequirementProperties props = new RequirementProperties();
        props.setPath(dir.toString());
        RequirementLoaderService loader = new RequirementLoaderService(props);
        requirementSetRepository = mock(RequirementSetRepository.class);
        carRepository = mock(CarRepository.class);
        catalogService = mock(CatalogService.class);
        when(requirementSetRepository.findByFilename(any())).thenReturn(Optional.empty());
        when(requirementSetRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service = new RequirementService(loader, requirementSetRepository, carRepository, catalogService);
    }

    private static RuleEditDto rule(String id) {
        return new RuleEditDto(id, "t", null, "high", "response", false,
                List.of(), List.of(), new EdgeDto("A", null, "x"), null,
                new ExpectDto("B", "y"), List.of(),
                500L, null, null, null, null, List.of(), null, List.of());
    }

    @Test
    @DisplayName("createFile writes an empty valid file and registers it")
    void createFile_writesAndRegisters() throws IOException {
        SummaryDto summary = service.createFile(new CreateRequest("new_set.yaml", "My set", null));

        assertEquals("new_set.yaml", summary.filename());
        assertEquals("My set", summary.name());
        assertEquals(0, summary.ruleCount());
        assertTrue(Files.exists(dir.resolve("new_set.yaml")));
        verify(requirementSetRepository).save(any());
    }

    @Test
    @DisplayName("createFile with carUid assigns the new set to the car")
    void createFile_assignsCar() throws IOException {
        CarEntity car = new CarEntity();
        when(carRepository.findByCarUidWithRequirements("uid-1")).thenReturn(Optional.of(car));

        service.createFile(new CreateRequest("car_set.yaml", "S", "uid-1"));

        assertEquals(1, car.getRequirementSets().size());
        verify(carRepository).save(car);
    }

    @Test
    @DisplayName("createFile rejects an existing filename")
    void createFile_duplicate_rejected() throws IOException {
        service.createFile(new CreateRequest("dup.yaml", "S", null));
        assertThrows(IllegalArgumentException.class,
                () -> service.createFile(new CreateRequest("dup.yaml", "S", null)));
    }

    @Test
    @DisplayName("addRule appends and creates a timestamped backup")
    void addRule_appendsAndBacksUp() throws IOException {
        service.createFile(new CreateRequest("s.yaml", "S", null));

        SummaryDto summary = service.addRule("s.yaml", rule("R1"));

        assertEquals(1, summary.ruleCount());
        assertEquals(1, service.getParsed("s.yaml").orElseThrow().ruleCount());
        try (var files = Files.list(dir)) {
            assertTrue(files.anyMatch(p -> p.getFileName().toString().startsWith("s.yaml.bak-")));
        }
    }

    @Test
    @DisplayName("invalid rule is rejected and the file on disk is unchanged")
    void addRule_invalid_rejectedWithoutWrite() throws IOException {
        service.createFile(new CreateRequest("s.yaml", "S", null));
        String before = Files.readString(dir.resolve("s.yaml"));

        RuleEditDto missingDeadline = new RuleEditDto("BAD", null, null, "high", "response", false,
                List.of(), List.of(), new EdgeDto("A", null, "x"), null,
                new ExpectDto("B", "y"), List.of(),
                null, null, null, null, null, List.of(), null, List.of());
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.addRule("s.yaml", missingDeadline));

        assertTrue(e.getMessage().contains("deadline_ms"));
        assertEquals(before, Files.readString(dir.resolve("s.yaml")));
    }

    @Test
    @DisplayName("addRules appends several rules in one write (bulk accept)")
    void addRules_batch() throws IOException {
        service.createFile(new CreateRequest("s.yaml", "S", null));

        SummaryDto summary = service.addRules("s.yaml", List.of(rule("R1"), rule("R2")));

        assertEquals(2, summary.ruleCount());
        assertThrows(IllegalArgumentException.class,
                () -> service.addRules("s.yaml", List.of()));
    }

    @Test
    @DisplayName("updateRule and deleteRule round-trip through the file")
    void updateAndDeleteRule() throws IOException {
        service.createFile(new CreateRequest("s.yaml", "S", null));
        service.addRule("s.yaml", rule("R1"));

        service.updateRule("s.yaml", "R1", rule("R2"));
        assertEquals("R2", service.getParsed("s.yaml").orElseThrow().rules().get(0).id());

        SummaryDto afterDelete = service.deleteRule("s.yaml", "R2");
        assertEquals(0, afterDelete.ruleCount());
    }

    @Test
    @DisplayName("updateMeta renames the set and registry row")
    void updateMeta_renames() throws IOException {
        service.createFile(new CreateRequest("s.yaml", "Old", null));
        SummaryDto summary = service.updateMeta("s.yaml",
                new MetaUpdateDto("New", null, Map.of(), List.of()));
        assertEquals("New", summary.name());
    }

    @Test
    @DisplayName("signal context uses assigned cars' catalogs when assigned")
    void signalContext_scopedToAssignedCars() {
        when(carRepository.countCarsByRequirementFilename("s.yaml")).thenReturn(1L);
        when(carRepository.findCatalogFilenamesByRequirementFilename("s.yaml"))
                .thenReturn(List.of("car_can.xml"));
        when(catalogService.getCatalogDetail("car_can.xml")).thenReturn(Optional.of(
                new CatalogDetailDto("car_can.xml", "CAR_CAN", List.of(
                        new MessageDto("0x2FC", "DOOR_STATUS", 100L, List.of(
                                new SignalDto("Drd_Status", "xxxx0011", 0, List.of(
                                        new SignalValueDto("0", "Closed"),
                                        new SignalValueDto("1", "Open")))))))));

        SignalContextDto ctx = service.signalContext("s.yaml", null);

        assertTrue(ctx.scoped());
        assertEquals(1, ctx.signals().size());
        assertEquals("Drd_Status", ctx.signals().get(0).name());
        assertEquals("DOOR_STATUS", ctx.signals().get(0).message());
        assertEquals(List.of("Closed", "Open"), ctx.signals().get(0).labels());
    }

    @Test
    @DisplayName("signal context falls back to all catalogs when unassigned")
    void signalContext_unassignedFallsBackToAllCatalogs() {
        when(carRepository.countCarsByRequirementFilename("s.yaml")).thenReturn(0L);
        when(catalogService.listCatalogs()).thenReturn(List.of(
                new CatalogSummaryDto("a.xml", "A", 1, 1, 10L, "2026-01-01")));
        when(catalogService.getCatalogDetail("a.xml")).thenReturn(Optional.of(
                new CatalogDetailDto("a.xml", "A", List.of(
                        new MessageDto("1", "M", null, List.of(
                                new SignalDto("Sig", "xxxxxxx1", 0, List.of())))))));

        SignalContextDto ctx = service.signalContext("s.yaml", null);

        assertFalse(ctx.scoped());
        assertEquals(1, ctx.signals().size());
    }

    @Test
    @DisplayName("signal context with carUid scopes to that car only")
    void signalContext_carScoped() {
        when(carRepository.findCatalogFilenamesByCarUid("uid-1")).thenReturn(List.of());

        SignalContextDto ctx = service.signalContext("s.yaml", "uid-1");

        assertTrue(ctx.scoped());
        assertTrue(ctx.signals().isEmpty());
        Mockito.verifyNoInteractions(catalogService);
    }
}

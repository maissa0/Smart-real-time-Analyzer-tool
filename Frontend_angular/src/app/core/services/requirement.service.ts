import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import {
  MetaUpdatePayload,
  NlConvertResponse,
  RequirementFileDetail,
  RequirementReport,
  RequirementSource,
  RequirementSummary,
  RuleEditPayload,
  SignalContext,
} from '../models/requirement.model';

/**
 * Requirement-set management + session report API (Phase 3).
 * Requirement files are dynamic per-car YAML uploads; guarded server-side by
 * the requirement:read / requirement:write authorities.
 */
@Injectable({ providedIn: 'root' })
export class RequirementService {
  private http = inject(HttpClient);

  /** All requirement-set files known to the backend (invalid ones flagged). */
  list(): Observable<RequirementSummary[]> {
    return this.http.get<RequirementSummary[]>(`${API_BASE_URL}/api/requirements`);
  }

  /** Parsed detail (meta + rules) of one file. */
  getParsed(filename: string): Observable<RequirementFileDetail> {
    return this.http.get<RequirementFileDetail>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}`);
  }

  /** Raw YAML source for the editor. */
  getSource(filename: string): Observable<RequirementSource> {
    return this.http.get<RequirementSource>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}/source`);
  }

  /** Validate + save edited YAML (backend rejects invalid files with a message). */
  saveSource(filename: string, yaml: string): Observable<RequirementSummary> {
    return this.http.put<RequirementSummary>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}/source`,
      { filename, yaml });
  }

  /** Upload a new .yaml/.yml requirement-set file. */
  upload(file: File): Observable<RequirementSummary> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<RequirementSummary>(`${API_BASE_URL}/api/requirements/upload`, form);
  }

  delete(filename: string): Observable<unknown> {
    return this.http.delete(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}`);
  }

  /** Re-scan the requirements directory and re-sync the registry. */
  reload(): Observable<RequirementSummary[]> {
    return this.http.post<RequirementSummary[]>(`${API_BASE_URL}/api/requirements/reload`, {});
  }

  // ── Structured editing (Phase A, docs/REQUIREMENTS_AUTHORING_PLAN.md) ─────

  /** Signals in scope for a file's rules; carUid scopes to one car (builder). */
  getSignalContext(filename: string, carUid?: string): Observable<SignalContext> {
    const params = carUid ? { params: { carUid } } : {};
    return this.http.get<SignalContext>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}/signal-context`,
      params);
  }

  /** Create a new empty requirement file, optionally assigned to a car. */
  createFile(filename: string, name: string, carUid?: string): Observable<RequirementSummary> {
    return this.http.post<RequirementSummary>(
      `${API_BASE_URL}/api/requirements/create`,
      { filename, name, carUid: carUid ?? null });
  }

  /** Append one rule (validated server-side against the whole file). */
  addRule(filename: string, rule: RuleEditPayload): Observable<RequirementSummary> {
    return this.http.post<RequirementSummary>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}/rules`, rule);
  }

  /** Replace the rule with id `ruleId` (the edit may rename it). */
  updateRule(filename: string, ruleId: string, rule: RuleEditPayload): Observable<RequirementSummary> {
    return this.http.put<RequirementSummary>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}/rules/${encodeURIComponent(ruleId)}`,
      rule);
  }

  /** Delete the rule with id `ruleId`. */
  deleteRule(filename: string, ruleId: string): Observable<RequirementSummary> {
    return this.http.delete<RequirementSummary>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}/rules/${encodeURIComponent(ruleId)}`);
  }

  /** Update the meta section (name, version, signal_map, derived_signals). */
  updateMeta(filename: string, meta: MetaUpdatePayload): Observable<RequirementSummary> {
    return this.http.put<RequirementSummary>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}/meta`, meta);
  }

  /**
   * Natural language sentence -> structured rule draft(s) (Phase C).
   * Nothing is saved; the draft opens pre-filled in the structured form.
   */
  nlConvert(text: string, filename: string, carUid?: string,
            mode: 'single' | 'bulk' = 'single'): Observable<NlConvertResponse> {
    return this.http.post<NlConvertResponse>(
      `${API_BASE_URL}/api/requirements/nl-convert`,
      { text, filename, carUid: carUid ?? null, language: 'auto', mode });
  }

  /** Append several accepted drafts in one write (bulk review, Phase D). */
  addRulesBatch(filename: string, rules: RuleEditPayload[]): Observable<RequirementSummary> {
    return this.http.post<RequirementSummary>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}/rules/batch`,
      { rules });
  }

  /** Per-rule outcome + coverage report for one session (plan §2.3). */
  getReport(sessionId: string): Observable<RequirementReport> {
    return this.http.get<RequirementReport>(
      `${API_BASE_URL}/api/requirements/sessions/${encodeURIComponent(sessionId)}/report`);
  }
}

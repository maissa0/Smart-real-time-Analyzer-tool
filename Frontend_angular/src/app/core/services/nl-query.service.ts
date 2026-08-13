import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, throwError } from "rxjs";
import { API_BASE_URL } from "../config/api.config";

// Mirrors NlQueryRequest's server-side @Size(max = 500) constraint — fails fast on
// obviously-invalid input instead of round-tripping to the server (and its LLM call) first.
const MAX_QUESTION_LENGTH = 500;

export interface NlQueryResponse {
  queryType: string;
  generatedQuery: string;
  explanation: string;
  results: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
}

@Injectable({ providedIn: "root" })
export class NlQueryService {
  private http = inject(HttpClient);

  query(question: string): Observable<NlQueryResponse> {
    const trimmed = question.trim();
    if (!trimmed) {
      return throwError(() => new Error('Question must not be blank'));
    }
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      return throwError(() => new Error(`Question must not exceed ${MAX_QUESTION_LENGTH} characters`));
    }
    return this.http.post<NlQueryResponse>(`${API_BASE_URL}/api/nl-query`, { question: trimmed });
  }
}

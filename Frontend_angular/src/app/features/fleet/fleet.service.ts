import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/config/api.config';
import { CanSession } from '../../core/models/can.model';
import { CarRequirementSet, RequirementSummary } from '../../core/models/requirement.model';

export interface Car {
  carUid: string;
  make: string;
  model: string;
  year: number;
  color: string | null;
  vin: string | null;
  isVirtual: boolean;
  isActive: boolean;
  createdAt: string | null;
  sessionCount?: number;
  lastSessionAt?: string | null;
  totalFrames?: number;
  faultRate?: number;
}

export interface CarForm {
  make: string;
  model: string;
  year: number;
  color: string | null;
  vin: string | null;
  isVirtual: boolean;
}

/** One ECU catalog assigned (or assignable) to a car. */
export interface CarCatalog {
  filename: string;
  name: string;
  busName: string;
}

/** Catalog file summary from GET /api/catalogs (catalog management API). */
export interface CatalogSummary {
  filename: string;
  busName: string;
  messageCount: number;
  signalCount: number;
  fileSize: number;
  lastModified: string;
}

/** Result of POST /api/catalogs/upload. */
export interface CatalogUploadResult {
  success: boolean;
  filename: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class FleetService {
  private readonly http = inject(HttpClient);

  getCars(): Observable<Car[]> {
    return this.http.get<Car[]>(`${API_BASE_URL}/api/cars`);
  }

  getCar(carUid: string): Observable<Car> {
    return this.http.get<Car>(`${API_BASE_URL}/api/cars/${encodeURIComponent(carUid)}`);
  }

  getCarSessions(carUid: string): Observable<CanSession[]> {
    return this.http.get<CanSession[]>(`${API_BASE_URL}/api/cars/${encodeURIComponent(carUid)}/sessions`);
  }

  createCar(body: CarForm): Observable<Car> {
    return this.http.post<Car>(`${API_BASE_URL}/api/cars`, body);
  }

  updateCar(carUid: string, body: CarForm): Observable<Car> {
    return this.http.put<Car>(`${API_BASE_URL}/api/cars/${encodeURIComponent(carUid)}`, body);
  }

  deleteCar(carUid: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/api/cars/${encodeURIComponent(carUid)}`);
  }

  /** Catalogs assigned to a car — empty array means "all catalogs". */
  getCarCatalogs(carUid: string): Observable<CarCatalog[]> {
    return this.http.get<CarCatalog[]>(
      `${API_BASE_URL}/api/cars/${encodeURIComponent(carUid)}/catalogs`);
  }

  /** Replace the car's assigned catalog set (empty array clears the assignment). */
  setCarCatalogs(carUid: string, filenames: string[]): Observable<CarCatalog[]> {
    return this.http.put<CarCatalog[]>(
      `${API_BASE_URL}/api/cars/${encodeURIComponent(carUid)}/catalogs`, { filenames });
  }

  /** All catalog files known to the backend (for the assignment picker). */
  getAllCatalogs(): Observable<CatalogSummary[]> {
    return this.http.get<CatalogSummary[]>(`${API_BASE_URL}/api/catalogs`);
  }

  /** Requirement sets assigned to a car — empty array = requirements engine off. */
  getCarRequirements(carUid: string): Observable<CarRequirementSet[]> {
    return this.http.get<CarRequirementSet[]>(
      `${API_BASE_URL}/api/cars/${encodeURIComponent(carUid)}/requirements`);
  }

  /** Replace the car's assigned requirement sets (empty array clears them). */
  setCarRequirements(carUid: string, filenames: string[]): Observable<CarRequirementSet[]> {
    return this.http.put<CarRequirementSet[]>(
      `${API_BASE_URL}/api/cars/${encodeURIComponent(carUid)}/requirements`, { filenames });
  }

  /** All requirement-set files known to the backend (for the assignment picker). */
  getAllRequirementSets(): Observable<RequirementSummary[]> {
    return this.http.get<RequirementSummary[]>(`${API_BASE_URL}/api/requirements`);
  }

  /** Permanently delete a catalog file (affects every car referencing it). */
  deleteCatalogFile(filename: string): Observable<void> {
    return this.http.delete<void>(
      `${API_BASE_URL}/api/catalogs/${encodeURIComponent(filename)}`);
  }

  /** Permanently delete a requirement-set file (affects every car referencing it). */
  deleteRequirementSetFile(filename: string): Observable<void> {
    return this.http.delete<void>(
      `${API_BASE_URL}/api/requirements/${encodeURIComponent(filename)}`);
  }

  /** Upload an XML catalog file; the backend saves it and reloads the catalog set. */
  uploadCatalog(file: File): Observable<CatalogUploadResult> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<CatalogUploadResult>(`${API_BASE_URL}/api/catalogs/upload`, form);
  }
}

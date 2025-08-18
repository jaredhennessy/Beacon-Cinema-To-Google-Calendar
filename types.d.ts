/**
 * Type definitions for the Beacon Cinema Calendar project
 */

// CSV Row Types
export interface SeriesRow {
  Title: string;
  SeriesTag: string;
  DateRecorded: string;
}

export interface ScheduleRow {
  Title: string;
  Date: string;
  Time: string;
  URL: string;
  SeriesTag: string;
  DateRecorded: string;
}

export interface RuntimeRow {
  Title: string;
  Runtime: string;
}

export interface SeriesIndexRow {
  seriesName: string;
  seriesURL: string;
  seriesTag: string;
}

// Logger Types
export interface Logger {
  error(message: string, error?: Error): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  summary(processed: number, skipped: number, errors?: number): void;
}

// Configuration Types
export interface ServiceAccountConfig {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

export interface EnvironmentConfig {
  CALENDAR_ID: string;
  TIME_ZONE?: string;
}

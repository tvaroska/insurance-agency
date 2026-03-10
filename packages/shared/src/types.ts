// ── Pagination ──

export interface PaginationParams {
  limit?: number;
  cursor?: string;
}

export interface PaginationMeta {
  limit: number;
  cursor: string | null;
  next_cursor: string | null;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ── Error Envelope ──

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export type FieldErrorCode =
  | "required"
  | "invalid_format"
  | "out_of_range"
  | "too_long"
  | "invalid_enum"
  | "conflict";

export interface FieldError {
  field: string;
  message: string;
  code: FieldErrorCode;
}

export interface ErrorResponse {
  error_code: ErrorCode;
  message: string;
  correlation_id?: string;
  details?: FieldError[];
}

// ── Common Schemas ──

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}

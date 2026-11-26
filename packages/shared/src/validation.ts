import type { FieldError } from "./types";
import { validationError } from "./errors";

export function checkRequired(field: string, value: unknown): FieldError | null {
  if (value === null || value === undefined || value === "") {
    return { field, message: `${field} is required.`, code: "required" };
  }
  return null;
}

export function checkFormat(
  field: string,
  value: string | undefined | null,
  pattern: RegExp,
  message?: string,
): FieldError | null {
  if (value == null) return null;
  if (!pattern.test(value)) {
    return {
      field,
      message: message ?? `${field} has an invalid format.`,
      code: "invalid_format",
    };
  }
  return null;
}

export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function checkCalendarDate(
  field: string,
  value: unknown,
  message?: string,
): FieldError | null {
  if (value == null) return null;
  if (!isValidCalendarDate(value)) {
    return {
      field,
      message: message ?? `${field} must be YYYY-MM-DD.`,
      code: "invalid_format",
    };
  }
  return null;
}

export function checkEnum(
  field: string,
  value: unknown,
  allowed: readonly string[],
): FieldError | null {
  if (value == null) return null;
  if (!allowed.includes(value as string)) {
    return {
      field,
      message: `${field} must be one of: ${allowed.join(", ")}.`,
      code: "invalid_enum",
    };
  }
  return null;
}

export function checkRange(
  field: string,
  value: number | undefined | null,
  opts: { min?: number; max?: number },
): FieldError | null {
  if (value == null) return null;
  if (typeof value !== "number" || Number.isNaN(value)) {
    return { field, message: `${field} must be a valid number.`, code: "invalid_format" };
  }
  if (opts.min !== undefined && value < opts.min) {
    return { field, message: `${field} must be at least ${opts.min}.`, code: "out_of_range" };
  }
  if (opts.max !== undefined && value > opts.max) {
    return { field, message: `${field} must be at most ${opts.max}.`, code: "out_of_range" };
  }
  return null;
}

export function checkMaxLength(
  field: string,
  value: string | undefined | null,
  max: number,
): FieldError | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    return { field, message: `${field} must be a string.`, code: "invalid_format" };
  }
  if (value.length > max) {
    return {
      field,
      message: `${field} must be at most ${max} characters.`,
      code: "too_long",
    };
  }
  return null;
}

export function throwIfErrors(errors: (FieldError | null)[]): void {
  const actual = errors.filter((e): e is FieldError => e !== null);
  if (actual.length > 0) {
    throw validationError(actual);
  }
}

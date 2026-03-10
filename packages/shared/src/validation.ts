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

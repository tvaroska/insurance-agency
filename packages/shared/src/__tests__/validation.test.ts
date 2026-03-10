import { describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";
import {
  checkRequired,
  checkFormat,
  checkEnum,
  checkRange,
  checkMaxLength,
  throwIfErrors,
} from "../validation";

describe("checkRequired", () => {
  test("returns error for null", () => {
    expect(checkRequired("name", null)).toEqual({
      field: "name",
      message: "name is required.",
      code: "required",
    });
  });

  test("returns error for undefined", () => {
    expect(checkRequired("name", undefined)?.code).toBe("required");
  });

  test("returns error for empty string", () => {
    expect(checkRequired("name", "")?.code).toBe("required");
  });

  test("returns null for valid value", () => {
    expect(checkRequired("name", "Alice")).toBeNull();
  });

  test("returns null for zero", () => {
    expect(checkRequired("count", 0)).toBeNull();
  });
});

describe("checkFormat", () => {
  test("returns null when value is null", () => {
    expect(checkFormat("email", null, /@/)).toBeNull();
  });

  test("returns null when format matches", () => {
    expect(checkFormat("email", "a@b.com", /@/)).toBeNull();
  });

  test("returns error when format doesn't match", () => {
    const err = checkFormat("email", "not-an-email", /@/);
    expect(err?.code).toBe("invalid_format");
  });

  test("uses custom message when provided", () => {
    const err = checkFormat("email", "bad", /@/, "Must be a valid email.");
    expect(err?.message).toBe("Must be a valid email.");
  });
});

describe("checkEnum", () => {
  const statuses = ["active", "inactive", "pending"] as const;

  test("returns null when value is null", () => {
    expect(checkEnum("status", null, statuses)).toBeNull();
  });

  test("returns null for valid enum value", () => {
    expect(checkEnum("status", "active", statuses)).toBeNull();
  });

  test("returns error for invalid enum value", () => {
    const err = checkEnum("status", "deleted", statuses);
    expect(err?.code).toBe("invalid_enum");
    expect(err?.message).toContain("active");
  });
});

describe("checkRange", () => {
  test("returns null when value is null", () => {
    expect(checkRange("age", null, { min: 0 })).toBeNull();
  });

  test("returns null when in range", () => {
    expect(checkRange("age", 25, { min: 0, max: 120 })).toBeNull();
  });

  test("returns error when below min", () => {
    const err = checkRange("age", -1, { min: 0 });
    expect(err?.code).toBe("out_of_range");
    expect(err?.message).toContain("at least 0");
  });

  test("returns error when above max", () => {
    const err = checkRange("age", 200, { max: 120 });
    expect(err?.code).toBe("out_of_range");
    expect(err?.message).toContain("at most 120");
  });
});

describe("checkMaxLength", () => {
  test("returns null when value is null", () => {
    expect(checkMaxLength("bio", null, 100)).toBeNull();
  });

  test("returns null when within limit", () => {
    expect(checkMaxLength("bio", "short", 100)).toBeNull();
  });

  test("returns error when exceeding limit", () => {
    const err = checkMaxLength("bio", "a".repeat(101), 100);
    expect(err?.code).toBe("too_long");
    expect(err?.message).toContain("100");
  });
});

describe("throwIfErrors", () => {
  test("does nothing when all entries are null", () => {
    expect(() => throwIfErrors([null, null, null])).not.toThrow();
  });

  test("throws HTTPException with collected errors", () => {
    const errors = [
      null,
      checkRequired("name", null),
      null,
      checkRange("age", -1, { min: 0 }),
    ];
    try {
      throwIfErrors(errors);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(HTTPException);
      const res = (err as HTTPException).getResponse();
      expect(res.status).toBe(400);
    }
  });

  test("thrown error body contains field details", async () => {
    try {
      throwIfErrors([checkRequired("email", "")]);
    } catch (err) {
      const body = await (err as HTTPException).getResponse().json();
      expect(body.error_code).toBe("VALIDATION_ERROR");
      expect(body.details).toHaveLength(1);
      expect(body.details[0].field).toBe("email");
    }
  });
});

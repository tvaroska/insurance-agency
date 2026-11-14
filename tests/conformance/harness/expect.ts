import type { HttpResult } from "./service";

export interface FieldErrorExpectation {
  field: string;
  code: string;
}

function describe(res: HttpResult): string {
  return `${res.request.method} ${res.request.path} -> ${res.status} ${res.text.slice(0, 400)}`;
}

/**
 * Asserts the shared error envelope: the HTTP status, `error_code`, a string
 * `message`, a string `correlation_id`, and (when given) one entry of
 * `details` per expected field error.
 */
export function expectError(
  res: HttpResult,
  status: number,
  errorCode: string,
  ...fieldErrors: FieldErrorExpectation[]
): void {
  const problems: string[] = [];
  if (res.status !== status) problems.push(`expected status ${status}`);
  const body = res.body;
  if (typeof body !== "object" || body === null) {
    problems.push("expected a JSON error envelope");
  } else {
    if (body.error_code !== errorCode) problems.push(`expected error_code ${errorCode}, got ${body.error_code}`);
    if (typeof body.message !== "string") problems.push("expected a string message");
    if (typeof body.correlation_id !== "string") problems.push("expected a string correlation_id");
    for (const wanted of fieldErrors) {
      const details: any[] = Array.isArray(body.details) ? body.details : [];
      if (!details.some((d) => d?.field === wanted.field && d?.code === wanted.code)) {
        problems.push(`expected details to contain { field: ${wanted.field}, code: ${wanted.code} }`);
      }
    }
  }
  if (problems.length > 0) throw new Error(`${describe(res)}\n  - ${problems.join("\n  - ")}`);
}

/** Asserts the status and returns the body, with the response text in the failure message. */
export function expectStatus(res: HttpResult, status: number): any {
  if (res.status !== status) throw new Error(`${describe(res)}\n  - expected status ${status}`);
  return res.body;
}

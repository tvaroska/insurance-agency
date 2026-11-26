# Conformance tests

Black-box tests that prove a service does what its behaviour specification says. They talk to a running service over HTTP and nothing else, so they stay valid when the code under `services/<svc>/src` is rebuilt from the durable contracts.

| Per service | Location |
| :--- | :--- |
| Behaviour specification, with numbered rules | `specs/<svc>.spec.md` |
| OpenAPI file | `specs/<svc>.yaml` |
| Public smoke contract (given to regenerators) | `specs/smoke/<svc>.smoke.yaml` |
| Held-out validation fixtures (blind evaluation) | `data/validation/<svc>/*.json` |
| Tests, each named after the rule it proves | `tests/conformance/<svc>/*.test.ts` |
| Shared harness | `tests/conformance/harness/` |

## Running

From the repository root:

```bash
bun test tests/conformance/claims      # one service
bun test tests/conformance             # everything, including the harness self-test
```

By default the harness starts each service as a child process on a free port, with a temporary data directory and an empty database. To test a deployment that is already running, set `CONFORMANCE_<SVC>_URL` (for example `CONFORMANCE_CLAIMS_URL=http://localhost:3007`, `CONFORMANCE_CARRIER_SUMMIT_URL=...`). The tests reseed that deployment through `/sim/seed` and `/sim/reset`, so never point them at data you want to keep.

When the environment does not allow binding a port, the harness loads the service into the test process instead. That happens in one function in `harness/service.ts`; it is the only place where test-side code touches service code. In that mode peer stubs are not available and all services share one simulated clock.

## Rules for test files

- Import only from `../harness` (and from helper files in the same directory). Never import from `services/`, `packages/` or generated database code.
- Set and read state over HTTP only: `svc.seed`, `svc.reset`, `svc.snapshot`, `svc.table`, `svc.changes`.
- Get tokens from the service's own `POST /oauth/token` through `svc.client(...)`.
- Start each test title with the rule id it proves, for example `CLM-R52: ...`.
- Check responses against the OpenAPI file with `contract.check(res)`.
- A service process is shared by every test file of a run. Seed the state a test needs in the test or in `beforeEach`; do not rely on what an earlier test left behind.
- Where the OpenAPI file and the service disagree, fix the contract or implementation directly instead of leaving `test.todo` placeholders; if an intentional boundary remains (such as browser layout rendering outside headless DOM smokes), document it honestly in the spec's "Known gaps" / boundary section.

## Harness reference

```ts
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { startService, loadContract, expectError, type Client, type Service } from "../harness";

const contract = loadContract("claims");
let svc: Service;
let api: Client;

beforeAll(async () => {
  svc = await startService("claims");
  api = await svc.client();                       // agent-full, every scope
}, 30_000);

beforeEach(async () => {
  await svc.seed({ base: "empty", tables: { adjusters: [/* rows */], claims: [/* rows */] } });
});

test("CLM-R40: an unknown claim is 404 NOT_FOUND", async () => {
  const { result: res, diff } = await svc.changes(() => api.get("/v1/claims/CLM-0000-000000"));
  expectError(res, 404, "NOT_FOUND");
  contract.check(res);
  expect(diff).toEqual({});                       // nothing was written
});
```

### Services

| Call | What it does |
| :--- | :--- |
| `startService(name, { env?, seedScript? })` | Returns a running `Service`. Calls with the same name and options share one process; a different `env` (for example `{ MODALITY_MODE: "strict" }`) starts a second instance with its own port and data directory. The process gets a minimal environment: peer URLs point at a closed port unless `env` sets them, so an unexpected call to a peer fails fast. With `seedScript: true` the service's own `bun run src/seed.ts` fills the database before the server starts. |
| `svc.http` | Client without credentials, for `/health`, `/oauth/token`, `/sim/*` and negative auth tests. |
| `svc.client({ clientId?, scopes? })` | Client with a bearer token from `POST /oauth/token`. `clientId` is `agent-full` (default), `agent-csr` or `agent-readonly`; `scopes` narrows the token. |
| `svc.token(opts)`, `svc.withToken(text)` | The raw token, and a client that sends any text as the bearer token. |
| `client.with(headers)` | A client that adds headers to every request. |
| `client.get/post/put/patch/delete/request` | Send a request. Object bodies are sent as JSON; strings, `FormData` and byte arrays are sent unchanged. The result has `status`, `headers`, `body` (parsed JSON or text), `text`, `bytes` and `request`. Redirects are not followed. |
| `svc.logs()`, `svc.dataDir` | Recent stdout and stderr of the service process, and its temporary `EVERGREEN_DATA_DIR`. |

### State and clock

| Call | Endpoint |
| :--- | :--- |
| `svc.seed({ base?, tables? })` | `POST /sim/seed`. `base` is `empty` (default), `clean` or `realistic`; `tables` maps table names to rows inserted on top. |
| `svc.reset("clean" \| "realistic")` | `POST /sim/reset`. |
| `svc.snapshot()`, `svc.table(name)` | `GET /sim/snapshot`: all tables, or the rows of one. |
| `svc.changes(action, opts?)` | Snapshots before and after `action` and returns `{ result, diff }`. |
| `diffTables(before, after, opts?)` | The diff itself: per changed table `{ added, removed, changed: [{ key, before, after, fields }] }`. Unchanged tables are left out, so `{}` means nothing was written. `opts.keys` names key columns (default: first column); `opts.ignore` leaves columns out. |
| `svc.timeTravel({ days } \| { target_date })` | `POST /sim/time-travel`. Returns the response, including `transitions`. |
| `svc.status()`, `svc.now()` | `GET /sim/status`, and the simulated time as a `Date`. |
| `svc.chaos(config)` | `POST /sim/chaos`. |
| `svc.trace()` | `GET /sim/trace`: `{ serviceName, scope, spans, raw }`, each span flattened to `{ name, kind, method, url, status, port, body, attributes }`. |

### OpenAPI checks

| Call | What it does |
| :--- | :--- |
| `loadContract(name)` | Loads `specs/<name>.yaml`. Each call returns a fresh object. |
| `contract.check(res, opts?)` | Finds the operation from the request's method and path, requires the status to be documented, and validates a JSON body against the documented schema. Throws with every issue listed. Options: `operationId` (check against that operation), `allowUndocumentedStatus`, `allow` (issue texts to tolerate). Use the last two only for a gap the spec lists. |
| `contract.inspect(res, opts?)` | The same, returning `{ operationId, status, schemaChecked, issues }` instead of throwing. |
| `contract.checkSchema(name, value)` | Validates any value against `#/components/schemas/<name>`. |
| `contract.operations()`, `contract.operation(id)` | Method, path (with the server base path), required scopes and documented statuses, for writing one test per operation. |
| `contract.unchecked()` | Operation ids this contract object has not seen in `check` or `inspect`. Assert it is empty at the end of a test that walks every operation. |

The validator covers the JSON Schema subset the OpenAPI files use: `$ref`, `type`, `nullable`, `enum`, `format` (`date`, `date-time`, `uuid`, `email`, `uri`), `properties`, `required`, `additionalProperties`, `items`, `allOf`, `oneOf`, `anyOf`, numeric and length bounds, `pattern`, and item and property counts. Keywords written next to a `$ref` (the files use `nullable: true` that way) are honoured. Properties a schema does not mention are allowed unless it sets `additionalProperties: false`.

### Other helpers

| Call | What it does |
| :--- | :--- |
| `expectError(res, status, errorCode, ...fieldErrors)` | Asserts the shared error envelope and, when given, `{ field, code }` entries in `details`. |
| `expectStatus(res, status)` | Asserts the status and returns the body; the failure message shows the response. |
| `startStub()` | A stand-in for a peer service: `stub.url`, `stub.on(method, path, reply)`, `stub.calls`, `stub.clear()`, `stub.stop()`. Pass its URL through `startService(name, { env })` to script the peer's answers and assert the calls made to it. |
| `mcpCall(client, message \| messages)` | Posts JSON-RPC to `/mcp` with the right `Accept` header and returns the replies, whether the server answers with JSON or a server-sent-event stream. |

### Runtime contract suite

`runtimeContractTests` (import from `"../harness/runtime-suite"`) holds the tests for the part of a service outside its route handlers, which is the same for every service: the seed script and the database location, `SEED_MODE` and the reset modes, `/sim/status`, fault injection through `/sim/chaos`, the request log at `/sim/trace`, and the access log on standard output (rule id `accessLog`, optional). A service's `runtime.test.ts` calls it with the service's rule ids, its canonical port, one read path, one write request and the row counts of both data sets; see [`claims/runtime.test.ts`](claims/runtime.test.ts).

## Worked example

[`claims/`](claims/) with [`specs/claims.spec.md`](../../specs/claims.spec.md): `support.ts` holds row builders and constants, `auth.test.ts` walks every operation of the OpenAPI file for the 401 and 403 rules, `update.test.ts` runs the full status matrix, `sim.test.ts` covers seed facts and the simulated clock, `runtime.test.ts` the runtime contract, and `lifecycle.test.ts` ends with `contract.unchecked()` to prove every operation was exercised.

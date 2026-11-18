import { beforeAll, describe, test } from "bun:test";
import { runSmokeContract } from "../harness/smoke";
import { start, type Ctx } from "./support";

describe("public smoke contract (specs/smoke/rater.smoke.yaml)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("replays every declarative step in specs/smoke/rater.smoke.yaml", async () => {
    await runSmokeContract(ctx.svc, "rater");
  });
});

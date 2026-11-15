/**
 * Gold Rubric Calibration & Inter-Rater Reliability (IRR) Runner (`eval/calibration/calibrate-judge.ts`).
 *
 * Evaluates the 120-item dual-annotated insurance communication gold benchmark
 * (`eval/calibration/rubric_gold_120.json`) across all 10 `EVAL-P01..P10` criteria:
 *   1. Computes human-human Gwet's AC1/AC2 (`>= 0.85` gate) and Krippendorff's alpha (`>= 0.80` gate).
 *   2. Evaluates either the deterministic rule checker (offline default) or the live Vertex AI
 *      LLM judge (`--llm-judge` / `EVERGREEN_USE_LLM_JUDGE=1`) against adjudicated gold labels.
 *   3. Computes confusion matrix `(TP, FP, TN, FN)` and empirical `(TPR, TNR, nPos, nNeg, Youden's J)`
 *      and writes `eval/calibration/calibration-receipt.json` for Rogan-Gladen / PPI debiasing.
 *
 * Usage:
 *   bun eval/calibration/calibrate-judge.ts [--llm-judge] [--model gemini-4-argon] [--out eval/calibration/calibration-receipt.json]
 */

import { parseArgs } from "util";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { appendFile, mkdir, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import type { RubricCriterion } from "../types";
import {
  BINARY_SCALE_STEPS,
  buildAtomicJudgePrompt,
  createVertexJudgeFn,
  DEFAULT_CALIBRATION_RECEIPT_PATH,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_LLM_CALIBRATION_RECEIPT_PATH,
  evaluateCriterionDeterministic,
  FOUR_POINT_GROUNDEDNESS_STEPS,
  type JudgeInferenceFn,
} from "../evaluators/rubric";

export interface GoldRubricItem {
  id: string;
  criterion_id: string;
  principle: string;
  scale_type: "binary" | "ordinal_4";
  criterion: {
    id: string;
    name: string;
    question: string;
    requiredPatterns?: string[];
    forbiddenPatterns?: string[];
  };
  source_context: string;
  candidate_output: string;
  rater_a: 0 | 1;
  rater_b: 0 | 1;
  label: 0 | 1;
  adjudication_notes: string;
}

export interface GoldRubricBenchmark {
  benchmark: string;
  version: string;
  total_items: number;
  criteria_count: number;
  items_per_criterion: number;
  items: GoldRubricItem[];
}

export interface ConfusionMatrixSummary {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  nPos: number;
  nNeg: number;
  total: number;
  tprSensitivity: number;
  tnrSpecificity: number;
  youdenJ: number;
  accuracy: number;
  f1: number;
}

export interface CalibrationReceipt {
  schemaVersion: "1.0";
  generatedAt: string;
  benchmarkPath: string;
  totalItems: number;
  criteriaCount: number;
  evaluatorMode: "deterministic-rule" | "vertex-llm-judge";
  judgeModel: string;
  interRaterReliability: {
    rawPercentAgreement: number;
    gwetsAc2: number;
    krippendorffAlpha: number;
    passesIrrGate: boolean;
  };
  confusionMatrix: ConfusionMatrixSummary;
  perPrincipleAccuracy: Record<
    string,
    { total: number; correct: number; accuracy: number }
  >;
}

const DEFAULT_GOLD_PATH = join(import.meta.dir, "rubric_gold_120.json");
const DEFAULT_RECEIPT_PATH = DEFAULT_CALIBRATION_RECEIPT_PATH;
const DEFAULT_LLM_RECEIPT_PATH = DEFAULT_LLM_CALIBRATION_RECEIPT_PATH;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function differenceWeight(
  v1: number,
  v2: number,
  scaleValues: number[],
  metric: "nominal" | "quadratic",
): number {
  if (v1 === v2) return 0.0;
  if (metric === "nominal" || scaleValues.length <= 2) return 1.0;
  const span = Math.max(...scaleValues) - Math.min(...scaleValues);
  if (span <= 0) return 0.0;
  return ((v1 - v2) / span) ** 2;
}

/**
 * Computes Gwet's AC1 (binary/nominal) / AC2 (quadratic ordinal) chance-corrected agreement,
 * immune to the high-prevalence kappa paradox (`EVAL-P04`).
 */
export function computeGwetsAc2(
  ratingsMatrix: Array<Array<number | null | undefined>>,
  scaleValues: number[] = [0, 1],
  metric: "nominal" | "quadratic" = "quadratic",
): number {
  if (ratingsMatrix.length === 0) {
    throw new Error("ratingsMatrix must contain at least one item.");
  }
  const categories = [...new Set(scaleValues)].sort((a, b) => a - b);
  const q = categories.length;
  if (q < 2) {
    throw new Error("scaleValues must have at least 2 distinct categories.");
  }
  const catIdx = new Map(categories.map((c, idx) => [c, idx]));

  let weightedDisagreementSum = 0.0;
  let validItems = 0;
  const categoryPropSum = new Array<number>(q).fill(0.0);

  for (const row of ratingsMatrix) {
    const valid = row.filter(
      (r): r is number => r !== null && r !== undefined && catIdx.has(r),
    );
    const m = valid.length;
    if (m < 2) continue;
    validItems++;

    for (const v of valid) {
      categoryPropSum[catIdx.get(v)!] += 1.0 / m;
    }

    let itemDis = 0.0;
    let pairs = 0;
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        itemDis += differenceWeight(valid[i], valid[j], categories, metric);
        pairs++;
      }
    }
    weightedDisagreementSum += itemDis / pairs;
  }

  if (validItems === 0) {
    throw new Error("No items with >= 2 valid ratings found.");
  }

  const pObserved = 1.0 - weightedDisagreementSum / validItems;
  const pi = categoryPropSum.map((s) => s / validItems);

  let twSum = 0.0;
  let piTerm = 0.0;
  for (let k = 0; k < q; k++) {
    piTerm += pi[k] * (1.0 - pi[k]);
    for (let l = 0; l < q; l++) {
      const wAgree =
        1.0 - differenceWeight(categories[k], categories[l], categories, metric);
      if (k !== l) {
        twSum += 1.0 - wAgree;
      }
    }
  }

  const denomFactor = q > 1 ? q * (q - 1) : 1;
  const pChance =
    metric === "nominal" || q === 2
      ? piTerm / (q - 1)
      : (twSum / denomFactor) * piTerm;

  if (Math.abs(1.0 - pChance) <= 1e-12) return 1.0;
  return round4((pObserved - pChance) / (1.0 - pChance));
}

/**
 * Computes Krippendorff's alpha across `N` items x `R` raters.
 */
export function computeKrippendorffAlpha(
  ratingsMatrix: Array<Array<number | null | undefined>>,
  scaleValues: number[] = [0, 1],
  metric: "nominal" | "quadratic" = "quadratic",
): number {
  const categories = [...new Set(scaleValues)].sort((a, b) => a - b);
  let totalRatings = 0;
  let observedDisagreement = 0.0;
  const globalCounts = new Map<number, number>(categories.map((c) => [c, 0]));

  for (const row of ratingsMatrix) {
    const valid = row.filter(
      (r): r is number => r !== null && r !== undefined,
    );
    const m = valid.length;
    if (m < 2) continue;
    totalRatings += m;
    for (const v of valid) {
      globalCounts.set(v, (globalCounts.get(v) ?? 0) + 1);
    }

    let rowDis = 0.0;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        if (i !== j) {
          rowDis += differenceWeight(valid[i], valid[j], categories, metric);
        }
      }
    }
    observedDisagreement += rowDis / (m - 1);
  }

  if (totalRatings < 2) {
    throw new Error("Insufficient ratings to compute Krippendorff's alpha.");
  }

  const dO = observedDisagreement / totalRatings;

  let expectedDisagreementNum = 0.0;
  for (const c1 of categories) {
    for (const c2 of categories) {
      if (c1 !== c2) {
        expectedDisagreementNum +=
          (globalCounts.get(c1) ?? 0) *
          (globalCounts.get(c2) ?? 0) *
          differenceWeight(c1, c2, categories, metric);
      }
    }
  }
  const dE = expectedDisagreementNum / (totalRatings * (totalRatings - 1));
  if (dE <= 1e-12) return dO <= 1e-12 ? 1.0 : 0.0;
  return round4(1.0 - dO / dE);
}

/**
 * Computes confusion matrix `(TP, FP, TN, FN)` and sensitivity/specificity `(TPR, TNR)`
 * against adjudicated gold binary labels (`0 | 1`).
 */
export function computeConfusionMatrix(
  goldLabels: Array<0 | 1>,
  predictedLabels: Array<0 | 1>,
): ConfusionMatrixSummary {
  if (goldLabels.length === 0 || goldLabels.length !== predictedLabels.length) {
    throw new Error("goldLabels and predictedLabels must be non-empty and equal length.");
  }

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (let i = 0; i < goldLabels.length; i++) {
    const gold = goldLabels[i];
    const pred = predictedLabels[i];
    if (gold === 1 && pred === 1) tp++;
    else if (gold === 0 && pred === 1) fp++;
    else if (gold === 0 && pred === 0) tn++;
    else fn++;
  }

  const nPos = tp + fn;
  const nNeg = tn + fp;
  const total = goldLabels.length;
  const tprSensitivity = nPos > 0 ? round4(tp / nPos) : 1.0;
  const tnrSpecificity = nNeg > 0 ? round4(tn / nNeg) : 1.0;
  const youdenJ = round4(tprSensitivity + tnrSpecificity - 1.0);
  const accuracy = round4((tp + tn) / total);
  const f1 =
    2 * tp + fp + fn > 0 ? round4((2 * tp) / (2 * tp + fp + fn)) : 1.0;

  return {
    tp,
    fp,
    tn,
    fn,
    nPos,
    nNeg,
    total,
    tprSensitivity,
    tnrSpecificity,
    youdenJ,
    accuracy,
    f1,
  };
}

export function loadGoldBenchmark(
  goldPath: string = DEFAULT_GOLD_PATH,
): GoldRubricBenchmark {
  return JSON.parse(readFileSync(goldPath, "utf-8")) as GoldRubricBenchmark;
}

function resolveVertexAuthDefaults(): {
  projectId?: string;
  accessToken?: string;
} {
  let projectId =
    process.env.GOOGLE_CLOUD_PROJECT ?? process.env.VERTEX_PROJECT_ID;
  let accessToken =
    process.env.VERTEX_ACCESS_TOKEN ?? process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

  if (!projectId) {
    try {
      projectId = execFileSync("gcloud", ["config", "get-value", "project"], {
        encoding: "utf-8",
        timeout: 5_000,
      }).trim();
    } catch {
      projectId = undefined;
    }
  }
  if (!accessToken && !process.env.GEMINI_API_KEY && !process.env.VERTEX_OPENAI_BASE_URL) {
    try {
      accessToken = execFileSync(
        "gcloud",
        ["auth", "application-default", "print-access-token"],
        { encoding: "utf-8", timeout: 10_000 },
      ).trim();
    } catch {
      try {
        accessToken = execFileSync("gcloud", ["auth", "print-access-token"], {
          encoding: "utf-8",
          timeout: 10_000,
        }).trim();
      } catch {
        accessToken = undefined;
      }
    }
  }
  return { projectId, accessToken };
}

async function invokeJudgeWithRetry(
  judgeFn: JudgeInferenceFn,
  prompt: string,
  criterion: RubricCriterion,
  judgeModel: string,
  retries: number,
): Promise<{ reasoning_trace: string; score: number; passed: boolean }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await judgeFn(prompt, criterion, judgeModel);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delayMs = Math.min(8_000, 500 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function runJudgeCalibration(options?: {
  goldPath?: string;
  useLlmJudge?: boolean;
  judgeModel?: string;
  judgeFn?: JudgeInferenceFn;
  outPath?: string;
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  checkpointPath?: string;
}): Promise<CalibrationReceipt> {
  const goldPath = options?.goldPath ?? DEFAULT_GOLD_PATH;
  const benchmark = loadGoldBenchmark(goldPath);
  const useLlmJudge = Boolean(options?.useLlmJudge);
  const judgeModel = useLlmJudge
    ? (options?.judgeModel ?? DEFAULT_JUDGE_MODEL)
    : "deterministic-rule";
  const timeoutMs = Math.max(1_000, options?.timeoutMs ?? 45_000);
  const concurrency = Math.max(1, options?.concurrency ?? (useLlmJudge ? 8 : 1));
  const retries = Math.max(0, options?.retries ?? 3);

  const authDefaults = useLlmJudge && !options?.judgeFn ? resolveVertexAuthDefaults() : {};
  const judgeFn = useLlmJudge
    ? (options?.judgeFn ??
      createVertexJudgeFn({
        projectId: authDefaults.projectId,
        accessToken: authDefaults.accessToken,
        location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
        timeoutMs,
      }))
    : undefined;

  const ratingsMatrix = benchmark.items.map((it) => [it.rater_a, it.rater_b]);
  const agreeCount = benchmark.items.filter(
    (it) => it.rater_a === it.rater_b,
  ).length;
  const rawPercentAgreement = round4(agreeCount / benchmark.items.length);
  const gwetsAc2 = computeGwetsAc2(ratingsMatrix, [0, 1], "quadratic");
  const krippendorffAlpha = computeKrippendorffAlpha(
    ratingsMatrix,
    [0, 1],
    "quadratic",
  );

  const checkpointMap = new Map<string, 0 | 1>();
  if (options?.checkpointPath && existsSync(options.checkpointPath)) {
    const lines = readFileSync(options.checkpointPath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as { id?: string; pred?: 0 | 1; model?: string };
        if (rec.id && (rec.pred === 0 || rec.pred === 1) && (!rec.model || rec.model === judgeModel)) {
          checkpointMap.set(rec.id, rec.pred);
        }
      } catch {
        // Ignore malformed checkpoint tail line
      }
    }
    if (options.checkpointPath) {
      await mkdir(dirname(resolve(options.checkpointPath)), { recursive: true });
    }
  } else if (options?.checkpointPath) {
    await mkdir(dirname(resolve(options.checkpointPath)), { recursive: true });
  }

  const predictions = new Array<0 | 1>(benchmark.items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= benchmark.items.length) return;
      const item = benchmark.items[idx];
      const cached = checkpointMap.get(item.id);
      if (cached !== undefined) {
        predictions[idx] = cached;
        continue;
      }

      const isOrdinal = item.scale_type === "ordinal_4";
      const passThreshold = isOrdinal ? 0.66 : 1.0;
      const criterion: RubricCriterion = {
        id: item.criterion.id,
        name: item.criterion.name,
        question: item.criterion.question,
        weight: 1.0,
        service: "comm",
        path: "/messages?limit=50",
        field: "body",
        sourceContext: item.source_context,
        scaleType: item.scale_type,
        scaleSteps: isOrdinal ? FOUR_POINT_GROUNDEDNESS_STEPS : BINARY_SCALE_STEPS,
        passThreshold,
        requiredPatterns: item.criterion.requiredPatterns,
        forbiddenPatterns: item.criterion.forbiddenPatterns,
      };

      let passed: boolean;
      if (useLlmJudge && judgeFn) {
        const prompt = buildAtomicJudgePrompt(
          criterion,
          item.candidate_output,
          item.source_context,
        );
        const verdict = await invokeJudgeWithRetry(
          judgeFn,
          prompt,
          criterion,
          judgeModel,
          retries,
        );
        passed = verdict.passed && verdict.score >= passThreshold;
      } else {
        const verdict = evaluateCriterionDeterministic(criterion, [
          item.candidate_output,
        ]);
        passed = verdict.passed;
      }

      const pred: 0 | 1 = passed ? 1 : 0;
      predictions[idx] = pred;

      if (options?.checkpointPath) {
        await appendFile(
          resolve(options.checkpointPath),
          JSON.stringify({ id: item.id, pred, label: item.label, model: judgeModel }) + "\n",
          "utf-8",
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, benchmark.items.length) }, () => worker()),
  );

  const goldLabels: Array<0 | 1> = [];
  const predictedLabels: Array<0 | 1> = [];
  const perPrinciple: Record<string, { total: number; correct: number }> = {};

  for (let i = 0; i < benchmark.items.length; i++) {
    const item = benchmark.items[i];
    const pred = predictions[i];
    goldLabels.push(item.label);
    predictedLabels.push(pred);

    const bucket = (perPrinciple[item.principle] ??= { total: 0, correct: 0 });
    bucket.total += 1;
    if (pred === item.label) bucket.correct += 1;
  }

  const confusionMatrix = computeConfusionMatrix(goldLabels, predictedLabels);
  const perPrincipleAccuracy = Object.fromEntries(
    Object.entries(perPrinciple).map(([principle, stats]) => [
      principle,
      {
        total: stats.total,
        correct: stats.correct,
        accuracy: round4(stats.correct / Math.max(1, stats.total)),
      },
    ]),
  );

  const receipt: CalibrationReceipt = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    benchmarkPath: "eval/calibration/rubric_gold_120.json",
    totalItems: benchmark.items.length,
    criteriaCount: benchmark.criteria_count,
    evaluatorMode: useLlmJudge ? "vertex-llm-judge" : "deterministic-rule",
    judgeModel,
    interRaterReliability: {
      rawPercentAgreement,
      gwetsAc2,
      krippendorffAlpha,
      passesIrrGate: gwetsAc2 >= 0.85 && krippendorffAlpha >= 0.8,
    },
    confusionMatrix,
    perPrincipleAccuracy,
  };

  if (options?.outPath) {
    const resolvedOut = resolve(options.outPath);
    await mkdir(dirname(resolvedOut), { recursive: true });
    await writeFile(resolvedOut, JSON.stringify(receipt, null, 2) + "\n", "utf-8");
  }

  return receipt;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "llm-judge": { type: "boolean", default: false },
      model: { type: "string" },
      out: { type: "string" },
      concurrency: { type: "string" },
      "timeout-ms": { type: "string" },
      retries: { type: "string" },
      checkpoint: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(
      "Usage: bun eval/calibration/calibrate-judge.ts [--llm-judge] [--model gemini-4-argon] [--concurrency 8] [--timeout-ms 45000] [--retries 3] [--checkpoint /tmp/cal-ckpt.jsonl] [--out <path>]",
    );
    process.exit(0);
  }

  const useLlmJudge =
    Boolean(values["llm-judge"]) ||
    process.env.EVERGREEN_USE_LLM_JUDGE === "1" ||
    process.env.EVERGREEN_USE_LLM_JUDGE === "true";

  const outPath =
    values.out ?? (useLlmJudge ? DEFAULT_LLM_RECEIPT_PATH : DEFAULT_RECEIPT_PATH);

  const receipt = await runJudgeCalibration({
    useLlmJudge,
    judgeModel: values.model,
    outPath,
    concurrency: values.concurrency ? Number(values.concurrency) : undefined,
    timeoutMs: values["timeout-ms"] ? Number(values["timeout-ms"]) : undefined,
    retries: values.retries ? Number(values.retries) : undefined,
    checkpointPath: values.checkpoint,
  });

  console.log(
    `Calibrated ${receipt.judgeModel} (${receipt.evaluatorMode}) on ${receipt.totalItems} gold items: ` +
      `Gwet AC2=${receipt.interRaterReliability.gwetsAc2.toFixed(4)}, ` +
      `TPR=${receipt.confusionMatrix.tprSensitivity.toFixed(4)} (${receipt.confusionMatrix.tp}/${receipt.confusionMatrix.nPos}), ` +
      `TNR=${receipt.confusionMatrix.tnrSpecificity.toFixed(4)} (${receipt.confusionMatrix.tn}/${receipt.confusionMatrix.nNeg})`,
  );
}

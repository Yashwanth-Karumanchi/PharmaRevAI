import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local", override: true });

type EvalCategory =
  | "RAG_ONLY"
  | "HYBRID_SQL_RAG"
  | "PRIVATE_UNANSWERABLE"
  | "UNRELATED_FIREWALL"
  | "AMBIGUOUS"
  | "SQL_ONLY";

type EvalQuestion = {
  id: string;
  category: EvalCategory;
  question: string;
  expectedToolName: string;
  expectedRoute: string;
  expectedCitationPrefixes: string[];
  expectedEvidenceTerms?: string[];
  expectedSql?: boolean;
  expectedRefusal?: boolean;
  notes?: string;
};

type EvalCaseResult = {
  id: string;
  category: EvalCategory;
  question: string;
  expectedToolName: string;
  plannerToolName: string;
  executedToolName: string;
  expectedRoute: string;
  actualRoute: string;
  toolPass: boolean;
  routePass: boolean;
  citationPass: boolean;
  sqlPass: boolean;
  refusalPass: boolean;
  evidenceRecallAt5: number;
  evidenceRecallPass: boolean;
  evidenceMrr: number;
  verifierStatus: string;
  registryStatus: string;
  plannerStatus: string;
  plannerUsedLlm: boolean;
  ragGeneratorStatus: string;
  latencyMs: number;
  sourceCount: number;
  rowCount: number;
  answerPreview: string;
  errors: string[];
  pass: boolean;
};

type EvalReport = {
  createdAt: string;
  environment: Record<string, unknown>;
  totals: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  };
  metrics: {
    toolAccuracy: string;
    routeAccuracy: string;
    citationSupport: string;
    sqlSuccess: string;
    privateRefusalAccuracy: string;
    evidenceRecallAt5PassRate: string;
    averageEvidenceMrr: number;
    verifierPassOrWarningRate: string;
    latencyAvgMs: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
    latencyMaxMs: number;
  };
  byCategory: Record<
    string,
    {
      total: number;
      passed: number;
      passRate: number;
      avgLatencyMs: number;
    }
  >;
  failedCases: EvalCaseResult[];
  cases: EvalCaseResult[];
};

const inputPath =
  process.argv[2] || "evaluation/questions.generated.routes.750.json";

const outputDir = "evaluation/reports";

const sqlToolNames = new Set([
  "part_d_top_spending_agent",
  "part_d_spending_increase_agent",
  "part_d_drug_trend_agent",
  "part_d_prescriber_agent",
  "open_payments_agent",
  "pharma_sales_agent",
]);

const refusalCategories = new Set([
  "PRIVATE_UNANSWERABLE",
  "UNRELATED_FIREWALL",
  "AMBIGUOUS",
]);

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s\[\]-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function percent(numerator: number, denominator: number) {
  if (denominator === 0) return "N/A";
  return `${Number(((numerator / denominator) * 100).toFixed(2))}%`;
}

function numericPassRate(numerator: number, denominator: number) {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;

  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function getAnswer(result: any) {
  return clean(result?.answer || result?.content || "");
}

function getSources(result: any) {
  return Array.isArray(result?.sources) ? result.sources : [];
}

function getRows(result: any) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function getCitationLabelsFromAnswer(answer: string) {
  const matches = Array.from(answer.matchAll(/\[([^\]]+)\]/g));

  return matches.flatMap((match) =>
    match[1]
      .split(",")
      .map((label) => label.trim().toUpperCase())
      .filter(Boolean)
  );
}

function hasCitationPrefix({
  answer,
  sources,
  prefix,
}: {
  answer: string;
  sources: any[];
  prefix: string;
}) {
  const normalizedPrefix = prefix.toUpperCase();

  const answerLabels = getCitationLabelsFromAnswer(answer);

  if (answerLabels.some((label) => label.startsWith(`${normalizedPrefix}-`))) {
    return true;
  }

  return sources.some((source) => {
    const citationLabel = String(source?.citationLabel || "").toUpperCase();
    const citationType = String(source?.citationType || "").toUpperCase();

    return (
      citationLabel.startsWith(`${normalizedPrefix}-`) ||
      citationType === normalizedPrefix
    );
  });
}

function citationPassForQuestion({
  question,
  answer,
  sources,
}: {
  question: EvalQuestion;
  answer: string;
  sources: any[];
}) {
  const prefixes = question.expectedCitationPrefixes || [];

  if (prefixes.length === 0) return true;

  return prefixes.every((prefix) =>
    hasCitationPrefix({
      answer,
      sources,
      prefix,
    })
  );
}

function detectRefusalBehavior({
  answer,
  actualToolName,
  actualRoute,
}: {
  answer: string;
  actualToolName: string;
  actualRoute: string;
}) {
  const text = normalize(answer);
  const route = normalize(actualRoute);
  const tool = normalize(actualToolName);

  if (tool === "data_limitation_agent" || tool === "unsupported_agent") {
    if (answer.includes("[LIMIT-1]")) return true;
  }

  if (route === "data limitation" || route === "unsupported" || route === "limitation") {
    if (answer.includes("[LIMIT-1]")) return true;
  }

  const refusalSignals = [
    "cannot answer",
    "can not answer",
    "cannot access",
    "can not access",
    "could not match",
    "not available",
    "not in the loaded public datasets",
    "loaded public datasets",
    "private internal",
    "private data",
    "internal business",
    "crm",
    "sales rep",
    "sales-rep",
    "rebate",
    "discount",
    "contract",
    "customer account",
    "net revenue",
    "profit",
    "margin",
    "unsupported",
    "please specify",
    "specify the dataset",
    "data limitation",
  ];

  return refusalSignals.some((signal) => text.includes(signal));
}

function routePassForQuestion({
  question,
  actualRoute,
}: {
  question: EvalQuestion;
  actualRoute: string;
}) {
  const expected = clean(question.expectedRoute).toUpperCase();
  const actual = clean(actualRoute).toUpperCase();

  if (question.category === "PRIVATE_UNANSWERABLE") {
    return actual === "DATA_LIMITATION" || actual === "LIMITATION";
  }

  if (question.category === "HYBRID_SQL_RAG") {
    return actual === "HYBRID_SQL_RAG";
  }

  return actual === expected;
}

function toolPassForQuestion({
  question,
  actualToolName,
}: {
  question: EvalQuestion;
  actualToolName: string;
}) {
  if (question.category === "HYBRID_SQL_RAG") {
    return sqlToolNames.has(actualToolName);
  }

  if (question.category === "PRIVATE_UNANSWERABLE") {
    return actualToolName === "data_limitation_agent";
  }

  return actualToolName === question.expectedToolName;
}

function normalizeTerm(value: string) {
  return normalize(value)
    .replace(/\*/g, "")
    .replace(/\bcf\b/g, "")
    .replace(/\bpen\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceText({
  answer,
  sources,
}: {
  answer: string;
  sources: any[];
}) {
  return normalize(
    [
      answer,
      ...sources.map((source) =>
        [
          source?.title,
          source?.dataset,
          source?.excerpt,
          Array.isArray(source?.metadata)
            ? source.metadata.join(" ")
            : JSON.stringify(source?.metadata || {}),
        ].join(" ")
      ),
    ].join(" ")
  );
}

function calculateEvidenceRecall({
  question,
  answer,
  sources,
}: {
  question: EvalQuestion;
  answer: string;
  sources: any[];
}) {
  const terms = (question.expectedEvidenceTerms || [])
    .map((term) => normalizeTerm(term))
    .filter((term) => term.length >= 3 && term !== "low");

  if (terms.length === 0) {
    return {
      recall: 1,
      pass: true,
      mrr: 1,
      missingTerms: [],
    };
  }

  if (refusalCategories.has(question.category)) {
    return {
      recall: 1,
      pass: true,
      mrr: 1,
      missingTerms: [],
    };
  }

  const combinedEvidence = evidenceText({ answer, sources });

  const foundTerms = terms.filter((term) => {
    const firstToken = term.split(" ")[0];
    return (
      combinedEvidence.includes(term) ||
      (firstToken.length >= 4 && combinedEvidence.includes(firstToken))
    );
  });

  const missingTerms = terms.filter((term) => !foundTerms.includes(term));
  const recall = foundTerms.length / terms.length;

  let reciprocalRank = 0;

  for (const term of terms) {
    const matchingIndex = sources.findIndex((source) => {
      const sourceText = normalize(
        [source?.title, source?.excerpt, JSON.stringify(source?.metadata || {})].join(" ")
      );

      const firstToken = term.split(" ")[0];

      return (
        sourceText.includes(term) ||
        (firstToken.length >= 4 && sourceText.includes(firstToken))
      );
    });

    if (matchingIndex >= 0) {
      reciprocalRank = Math.max(reciprocalRank, 1 / (matchingIndex + 1));
    }
  }

  if (reciprocalRank === 0 && foundTerms.length > 0) {
    reciprocalRank = 0.5;
  }

  return {
    recall,
    pass: recall >= 0.5,
    mrr: reciprocalRank,
    missingTerms,
  };
}

function verifierStatus(result: any) {
  return clean(
    result?.verification?.status ||
      result?.verifierStatus ||
      result?.metadata?.verification?.status ||
      "unknown"
  );
}

function registryStatus(result: any) {
  return clean(result?.registry?.status || result?.registryStatus || "unknown");
}

function ragGeneratorStatus(result: any) {
  return clean(
    result?.composer?.ragGeneratorStatus ||
      result?.metadata?.ragGeneratorStatus ||
      result?.ragGeneratorStatus ||
      result?.composer?.status ||
      "unknown"
  );
}

function plannerStatus(router: any) {
  return clean(router?.planner?.status || router?.status || "unknown");
}

function plannerUsedLlm(router: any) {
  return Boolean(router?.planner?.usedLlm || router?.usedLlm);
}

function answerPreview(answer: string) {
  return answer.slice(0, 700);
}

async function evaluateCase(question: EvalQuestion): Promise<EvalCaseResult> {
  const startedAt = Date.now();

  let router: any = null;
  let result: any = null;
  let plannerToolName = "unsupported_agent";
  let executedToolName = "unsupported_agent";
  let actualRoute = "UNSUPPORTED";
  let answer = "";
  let sources: any[] = [];
  let rows: any[] = [];
  const errors: string[] = [];

  try {
    const { routeQuestion } = await import("../lib/agents/queryRouter");
    const { executeRegisteredTool } = await import("../lib/agents/safeToolRegistry");

    router = await routeQuestion(question.question);

    plannerToolName = clean(router?.toolName || router?.selectedToolName || "unsupported_agent");

    result = await executeRegisteredTool({
      toolName: plannerToolName,
      question: question.question,
      extractedEntities: router?.extractedEntities || {},
      router,
    });

    executedToolName = clean(
      result?.registry?.executedToolName ||
        result?.executedToolName ||
        plannerToolName ||
        "unsupported_agent"
    );

    actualRoute = clean(result?.route || router?.route || "UNSUPPORTED");
    answer = getAnswer(result);
    sources = getSources(result);
    rows = getRows(result);
  } catch (error) {
    answer = error instanceof Error ? error.message : "Unknown evaluation error.";
    errors.push(answer);
  }

  const latencyMs = Date.now() - startedAt;

  const toolPass = toolPassForQuestion({
    question,
    actualToolName: executedToolName,
  });

  const routePass = routePassForQuestion({
    question,
    actualRoute,
  });

  const citationPass = citationPassForQuestion({
    question,
    answer,
    sources,
  });

  const expectedSql = Boolean(question.expectedSql);
  const hasSqlCitation = hasCitationPrefix({
    answer,
    sources,
    prefix: "SQL",
  });

  const sqlPass = expectedSql ? rows.length > 0 || hasSqlCitation : true;

  const expectedRefusal = Boolean(question.expectedRefusal);
  const refusalDetected = detectRefusalBehavior({
    answer,
    actualToolName: executedToolName,
    actualRoute,
  });

  const refusalPass = expectedRefusal ? refusalDetected : true;

  const recall = calculateEvidenceRecall({
    question,
    answer,
    sources,
  });

  const evidenceRecallAt5 = Number(recall.recall.toFixed(4));
  const evidenceRecallPass = recall.pass;
  const evidenceMrr = Number(recall.mrr.toFixed(4));

  if (!toolPass) {
    errors.push(
      `Tool mismatch. Expected ${question.expectedToolName}, got ${executedToolName}.`
    );
  }

  if (!routePass) {
    errors.push(
      `Route mismatch. Expected ${question.expectedRoute}, got ${actualRoute}.`
    );
  }

  if (!citationPass) {
    errors.push(
      `Citation mismatch. Expected prefixes: ${question.expectedCitationPrefixes.join(
        ", "
      )}.`
    );
  }

  if (!sqlPass) {
    errors.push("SQL evidence missing for a question that expected SQL evidence.");
  }

  if (!refusalPass) {
    errors.push("Refusal behavior did not match expectation.");
  }

  if (!evidenceRecallPass) {
    errors.push(
      `Evidence Recall@5 failed for terms: ${recall.missingTerms.join(", ")}.`
    );
  }

  const pass =
    toolPass &&
    routePass &&
    citationPass &&
    sqlPass &&
    refusalPass &&
    evidenceRecallPass;

  return {
    id: question.id,
    category: question.category,
    question: question.question,
    expectedToolName: question.expectedToolName,
    plannerToolName,
    executedToolName,
    expectedRoute: question.expectedRoute,
    actualRoute,
    toolPass,
    routePass,
    citationPass,
    sqlPass,
    refusalPass,
    evidenceRecallAt5,
    evidenceRecallPass,
    evidenceMrr,
    verifierStatus: verifierStatus(result),
    registryStatus: registryStatus(result),
    plannerStatus: plannerStatus(router),
    plannerUsedLlm: plannerUsedLlm(router),
    ragGeneratorStatus: ragGeneratorStatus(result),
    latencyMs,
    sourceCount: sources.length,
    rowCount: rows.length,
    answerPreview: answerPreview(answer),
    errors,
    pass,
  };
}

function buildCategoryBreakdown(cases: EvalCaseResult[]) {
  const grouped: Record<
    string,
    {
      total: number;
      passed: number;
      latencyTotal: number;
    }
  > = {};

  for (const item of cases) {
    if (!grouped[item.category]) {
      grouped[item.category] = {
        total: 0,
        passed: 0,
        latencyTotal: 0,
      };
    }

    grouped[item.category].total += 1;
    grouped[item.category].passed += item.pass ? 1 : 0;
    grouped[item.category].latencyTotal += item.latencyMs;
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([category, value]) => [
      category,
      {
        total: value.total,
        passed: value.passed,
        passRate: numericPassRate(value.passed, value.total),
        avgLatencyMs: Number((value.latencyTotal / value.total).toFixed(2)),
      },
    ])
  );
}

function buildMarkdownReport(report: EvalReport) {
  const lines: string[] = [];

  lines.push("# PharmaRev AI Evaluation Report");
  lines.push("");
  lines.push(`Created: ${report.createdAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Total | Passed | Failed | Pass Rate |");
  lines.push("|---:|---:|---:|---:|");
  lines.push(
    `| ${report.totals.total} | ${report.totals.passed} | ${report.totals.failed} | ${report.totals.passRate}% |`
  );
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");

  for (const [key, value] of Object.entries(report.metrics)) {
    lines.push(`| ${key} | ${value} |`);
  }

  lines.push("");
  lines.push("## Category Breakdown");
  lines.push("");
  lines.push("| Category | Total | Passed | Pass Rate | Avg Latency ms |");
  lines.push("|---|---:|---:|---:|---:|");

  for (const [category, value] of Object.entries(report.byCategory)) {
    lines.push(
      `| ${category} | ${value.total} | ${value.passed} | ${value.passRate}% | ${value.avgLatencyMs} |`
    );
  }

  lines.push("");
  lines.push("## Failed Cases");
  lines.push("");
  lines.push("| Case | Category | Expected Tool | Actual Tool | Errors |");
  lines.push("|---|---|---|---|---|");

  for (const item of report.failedCases) {
    lines.push(
      `| ${item.id} | ${item.category} | ${item.expectedToolName} | ${item.executedToolName} | ${item.errors.join(
        "<br>"
      )} |`
    );
  }

  return lines.join("\n");
}

async function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Evaluation question file not found: ${inputPath}`);
  }

  const questions = JSON.parse(fs.readFileSync(inputPath, "utf8")) as EvalQuestion[];

  console.log("Running PharmaRev evaluation...");
  console.log({
    inputPath,
    totalQuestions: questions.length,
  });

  const cases: EvalCaseResult[] = [];

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const result = await evaluateCase(question);
    cases.push(result);

    const marker = result.pass ? "PASS" : "FAIL";
    console.log(
      `${index + 1}/${questions.length} ${marker} ${question.id} ${question.category} ${result.latencyMs}ms`
    );
  }

  const passed = cases.filter((item) => item.pass).length;
  const failed = cases.length - passed;
  const latencies = cases.map((item) => item.latencyMs);

  const expectedSqlCases = cases.filter((item, index) => questions[index]?.expectedSql);
  const expectedRefusalCases = cases.filter((item, index) => questions[index]?.expectedRefusal);

  const verifierPassOrWarning = cases.filter((item) =>
    ["pass", "warning", "unknown"].includes(item.verifierStatus.toLowerCase())
  ).length;

  const report: EvalReport = {
    createdAt: new Date().toISOString(),
    environment: {
      DATABASE_URL_LOADED: Boolean(process.env.DATABASE_URL),
      GEMINI_API_KEY_LOADED: Boolean(process.env.GEMINI_API_KEY),
      LLM_PLANNER_ENABLED: process.env.LLM_PLANNER_ENABLED,
      RAG_GENERATOR_ENABLED: process.env.RAG_GENERATOR_ENABLED,
      LLM_COMPOSER_ENABLED: process.env.LLM_COMPOSER_ENABLED,
      EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
      LOCAL_EMBEDDING_MODEL: process.env.LOCAL_EMBEDDING_MODEL,
      ENABLE_VECTOR_RETRIEVAL: process.env.ENABLE_VECTOR_RETRIEVAL,
    },
    totals: {
      total: cases.length,
      passed,
      failed,
      passRate: numericPassRate(passed, cases.length),
    },
    metrics: {
      toolAccuracy: percent(cases.filter((item) => item.toolPass).length, cases.length),
      routeAccuracy: percent(cases.filter((item) => item.routePass).length, cases.length),
      citationSupport: percent(
        cases.filter((item) => item.citationPass).length,
        cases.length
      ),
      sqlSuccess: percent(
        expectedSqlCases.filter((item) => item.sqlPass).length,
        expectedSqlCases.length
      ),
      privateRefusalAccuracy: percent(
        expectedRefusalCases.filter((item) => item.refusalPass).length,
        expectedRefusalCases.length
      ),
      evidenceRecallAt5PassRate: percent(
        cases.filter((item) => item.evidenceRecallPass).length,
        cases.length
      ),
      averageEvidenceMrr: Number(
        (
          cases.reduce((sum, item) => sum + item.evidenceMrr, 0) /
          Math.max(cases.length, 1)
        ).toFixed(4)
      ),
      verifierPassOrWarningRate: percent(verifierPassOrWarning, cases.length),
      latencyAvgMs: Number(
        (latencies.reduce((sum, item) => sum + item, 0) / Math.max(latencies.length, 1)).toFixed(2)
      ),
      latencyP50Ms: percentile(latencies, 50),
      latencyP95Ms: percentile(latencies, 95),
      latencyMaxMs: Math.max(...latencies, 0),
    },
    byCategory: buildCategoryBreakdown(cases),
    failedCases: cases.filter((item) => !item.pass),
    cases,
  };

  fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = report.createdAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outputDir, `report-${timestamp}.json`);
  const markdownPath = path.join(outputDir, `report-${timestamp}.md`);
  const latestJsonPath = path.join(outputDir, "latest.json");
  const latestMarkdownPath = path.join(outputDir, "latest.md");

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(markdownPath, buildMarkdownReport(report));
  fs.writeFileSync(latestJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestMarkdownPath, buildMarkdownReport(report));

  console.log("Evaluation complete.");
  console.log({
    total: report.totals.total,
    passed: report.totals.passed,
    failed: report.totals.failed,
    passRate: report.totals.passRate,
    latestJsonPath,
    latestMarkdownPath,
  });

  console.table(report.byCategory);
  console.table(report.metrics);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Evaluation failed:");
  console.error(error);
  process.exit(1);
});
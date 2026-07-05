import type { AgentStep, SourceEvidence } from "../../types/evidence";
import { verifyGroundedAnswer } from "./groundingVerifier";
import { augmentHybridResultWithLabelEvidence } from "./hybridRagAugmenter";
import { composePharmaAnswer } from "./llmComposer";

export type SafeToolName =
  | "part_d_top_spending_agent"
  | "part_d_spending_increase_agent"
  | "part_d_drug_trend_agent"
  | "part_d_prescriber_agent"
  | "open_payments_agent"
  | "pharma_sales_agent"
  | "openfda_label_agent"
  | "data_limitation_agent"
  | "unsupported_agent";

export type RegistryCheckStatus = "pass" | "warning" | "fail";

export type RegistryValidationCheck = {
  name: string;
  status: RegistryCheckStatus;
  detail: string;
};

export type RegistryDecisionStatus =
  | "approved"
  | "overridden"
  | "blocked"
  | "failed";

export type PharmaRevRoute =
  | "SQL_ONLY"
  | "RAG_ONLY"
  | "HYBRID_SQL_RAG"
  | "DATA_LIMITATION"
  | "LIMITATION"
  | "UNSUPPORTED";

export type SafeToolRegistryTrace = {
  selectedToolName: SafeToolName;
  executedToolName: SafeToolName;
  status: RegistryDecisionStatus;
  reason: string;
  requiresSql: boolean;
  requiresRag: boolean;
  allowedDataSources: string[];
  privateDataPolicy: "block" | "allow_public_only";
  validationChecks: RegistryValidationCheck[];
};

export type RegisteredToolResult = {
  answer: string;
  rows: Record<string, string | number>[];
  sqlQuery: string;
  sources: SourceEvidence[];
  entities: Record<string, unknown>;
  route: PharmaRevRoute;
  composer?: Record<string, unknown>;
  verification?: ReturnType<typeof verifyGroundedAnswer>;
  registry: SafeToolRegistryTrace;
  agentSteps: AgentStep[];
};

export type ExecuteRegisteredToolInput = {
  toolName: SafeToolName;
  question: string;
  extractedEntities?: unknown;
  router?: unknown;
};

type RawAgentResult = {
  answer?: unknown;
  rows?: unknown;
  sqlQuery?: unknown;
  sources?: unknown;
  entities?: unknown;
  route?: unknown;
  composer?: unknown;
  verification?: unknown;
  agentSteps?: unknown;
};

type SafeToolDefinition = {
  toolName: SafeToolName;
  label: string;
  description: string;
  requiresSql: boolean;
  requiresRag: boolean;
  allowedDataSources: string[];
  privateDataPolicy: "block" | "allow_public_only";
};

type AgentFunction = (question: string) => Promise<RawAgentResult> | RawAgentResult;

const safeToolDefinitions: Record<SafeToolName, SafeToolDefinition> = {
  part_d_top_spending_agent: {
    toolName: "part_d_top_spending_agent",
    label: "CMS Part D Top Spending Agent",
    description: "Ranks public Medicare Part D drugs by total spending.",
    requiresSql: true,
    requiresRag: false,
    allowedDataSources: ["cms_part_d_spending"],
    privateDataPolicy: "allow_public_only",
  },
  part_d_spending_increase_agent: {
    toolName: "part_d_spending_increase_agent",
    label: "CMS Part D Spending Increase Agent",
    description: "Finds public Medicare Part D drug spending growth or increase.",
    requiresSql: true,
    requiresRag: false,
    allowedDataSources: ["cms_part_d_spending"],
    privateDataPolicy: "allow_public_only",
  },
  part_d_drug_trend_agent: {
    toolName: "part_d_drug_trend_agent",
    label: "CMS Part D Drug Trend Agent",
    description: "Shows public Medicare Part D spending trend for a drug.",
    requiresSql: true,
    requiresRag: false,
    allowedDataSources: ["cms_part_d_spending"],
    privateDataPolicy: "allow_public_only",
  },
  part_d_prescriber_agent: {
    toolName: "part_d_prescriber_agent",
    label: "CMS Part D Prescriber Agent",
    description:
      "Analyzes public Medicare Part D provider, state, specialty, and drug-cost data.",
    requiresSql: true,
    requiresRag: false,
    allowedDataSources: ["cms_part_d_prescribers"],
    privateDataPolicy: "allow_public_only",
  },
  open_payments_agent: {
    toolName: "open_payments_agent",
    label: "CMS Open Payments Agent",
    description:
      "Analyzes public CMS Open Payments transfers of value, companies, specialties, and states.",
    requiresSql: true,
    requiresRag: false,
    allowedDataSources: ["open_payments"],
    privateDataPolicy: "allow_public_only",
  },
  pharma_sales_agent: {
    toolName: "pharma_sales_agent",
    label: "Public Pharma Sales Quantity Agent",
    description:
      "Analyzes public pharma sales quantity/category data and simple trends.",
    requiresSql: true,
    requiresRag: false,
    allowedDataSources: ["pharma_sales"],
    privateDataPolicy: "allow_public_only",
  },
  openfda_label_agent: {
    toolName: "openfda_label_agent",
    label: "openFDA Label RAG Agent",
    description:
      "Retrieves FDA label chunks and answers questions about label use, warnings, adverse reactions, and dosage.",
    requiresSql: false,
    requiresRag: true,
    allowedDataSources: ["document_chunks", "documents", "openfda_drug_labels"],
    privateDataPolicy: "allow_public_only",
  },
  data_limitation_agent: {
    toolName: "data_limitation_agent",
    label: "Data Limitation Agent",
    description:
      "Blocks private/internal/unsupported business-data requests and explains data limits.",
    requiresSql: false,
    requiresRag: false,
    allowedDataSources: ["system_limitation"],
    privateDataPolicy: "block",
  },
  unsupported_agent: {
    toolName: "unsupported_agent",
    label: "Unsupported Question Agent",
    description:
      "Handles questions that do not match the available public datasets.",
    requiresSql: false,
    requiresRag: false,
    allowedDataSources: ["system_limitation"],
    privateDataPolicy: "block",
  },
};

const allToolNames = Object.keys(safeToolDefinitions) as SafeToolName[];

function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRows(value: unknown): Record<string, string | number>[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((row): row is Record<string, string | number> => isRecord(row))
    .map((row) => {
      const cleanRow: Record<string, string | number> = {};

      for (const [key, rawValue] of Object.entries(row)) {
        if (typeof rawValue === "string" || typeof rawValue === "number") {
          cleanRow[key] = rawValue;
        } else if (rawValue !== null && rawValue !== undefined) {
          cleanRow[key] = String(rawValue);
        }
      }

      return cleanRow;
    });
}

function toSources(value: unknown): SourceEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter((source): source is SourceEvidence => isRecord(source));
}

function toAgentSteps(value: unknown): AgentStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter((step): step is AgentStep => isRecord(step));
}

function stringifyForRisk(value: unknown) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "";
  }
}

function normalizeRoute(value: unknown, fallback: PharmaRevRoute): PharmaRevRoute {
  const route = String(value ?? "").trim().toUpperCase();

  if (route === "SQL_ONLY") return "SQL_ONLY";
  if (route === "RAG_ONLY") return "RAG_ONLY";
  if (route === "HYBRID_SQL_RAG") return "HYBRID_SQL_RAG";
  if (route === "DATA_LIMITATION") return "DATA_LIMITATION";
  if (route === "LIMITATION") return "LIMITATION";
  if (route === "UNSUPPORTED") return "UNSUPPORTED";

  return fallback;
}

function getRouterRecord(router: unknown) {
  return isRecord(router) ? router : {};
}

function getRouterRoute(router: unknown): PharmaRevRoute | null {
  const routerRecord = getRouterRecord(router);
  const route = routerRecord.route;

  if (!route) return null;

  return normalizeRoute(route, "UNSUPPORTED");
}

function getFallbackRouteForTool(toolName: SafeToolName): PharmaRevRoute {
  if (toolName === "openfda_label_agent") return "RAG_ONLY";
  if (toolName === "data_limitation_agent") return "DATA_LIMITATION";
  if (toolName === "unsupported_agent") return "UNSUPPORTED";
  return "SQL_ONLY";
}

function hasPrivateDataRisk(question: string, extractedEntities?: unknown) {
  const combined = `${normalizeQuestion(question)} ${stringifyForRisk(
    extractedEntities
  ).toLowerCase()}`;

  const privatePatterns = [
    /\bsales\s*rep\b/,
    /\bsales\s*representative\b/,
    /\brep\s+lost\b/,
    /\blost\s+revenue\b/,
    /\blost\s+deal\b/,
    /\bdeal\s+loss\b/,
    /\bcrm\b/,
    /\bsalesforce\b/,
    /\bhubspot\b/,
    /\bcustomer\s+account\b/,
    /\bcustomer\s+level\b/,
    /\baccount\s+level\b/,
    /\bprivate\s+revenue\b/,
    /\bprivate\s+net\s+revenue\b/,
    /\bnet\s+revenue\b/,
    /\binternal\s+revenue\b/,
    /\brevenue\s+by\s+rep\b/,
    /\bprofit\b/,
    /\bprofitability\b/,
    /\bmargin\b/,
    /\brebate\b/,
    /\bdiscount\b/,
    /\bcontract\b/,
    /\bquota\b/,
    /\bterritory\b/,
    /\binvoice\b/,
    /\bpipeline\b/,
    /\bopportunity\b/,
    /\binternal\b/,
    /\bprivate\b/,
  ];

  return privatePatterns.some((pattern) => pattern.test(combined));
}

function isUnsafeCausalityQuestion(question: string) {
  const normalized = normalizeQuestion(question);

  const causalityWords = [
    "caused",
    "because of",
    "led to",
    "influenced",
    "proof that",
    "prove that",
    "made doctors prescribe",
    "caused prescriptions",
    "caused sales",
  ];

  const publicDataWords = [
    "open payments",
    "part d",
    "medicare",
    "fda label",
    "label",
    "payment",
    "payments",
  ];

  return (
    causalityWords.some((word) => normalized.includes(word)) &&
    publicDataWords.some((word) => normalized.includes(word))
  );
}

function buildValidationChecks({
  selectedToolName,
  executedToolName,
  question,
  extractedEntities,
}: {
  selectedToolName: SafeToolName;
  executedToolName: SafeToolName;
  question: string;
  extractedEntities?: unknown;
}): RegistryValidationCheck[] {
  const checks: RegistryValidationCheck[] = [];

  checks.push({
    name: "allowed_tool_name",
    status: allToolNames.includes(selectedToolName) ? "pass" : "fail",
    detail: `Selected tool: ${selectedToolName}`,
  });

  const privateRisk = hasPrivateDataRisk(question, extractedEntities);

  checks.push({
    name: "private_data_policy",
    status:
      privateRisk && executedToolName !== "data_limitation_agent"
        ? "fail"
        : privateRisk
          ? "warning"
          : "pass",
    detail: privateRisk
      ? "Private/internal business-data risk detected."
      : "No private/internal business-data risk detected.",
  });

  const unsafeCausality = isUnsafeCausalityQuestion(question);

  checks.push({
    name: "public_data_causality_policy",
    status:
      unsafeCausality && executedToolName !== "data_limitation_agent"
        ? "fail"
        : unsafeCausality
          ? "warning"
          : "pass",
    detail: unsafeCausality
      ? "Question may ask public data to prove causality, which is blocked."
      : "No unsafe causality inference detected.",
  });

  checks.push({
    name: "execution_is_registered",
    status: safeToolDefinitions[executedToolName] ? "pass" : "fail",
    detail: `Executed tool: ${executedToolName}`,
  });

  return checks;
}

function validateToolSelection({
  toolName,
  question,
  extractedEntities,
}: ExecuteRegisteredToolInput) {
  let executedToolName: SafeToolName = toolName;
  let status: RegistryDecisionStatus = "approved";
  let reason = "Selected tool passed registry validation.";

  if (!safeToolDefinitions[toolName]) {
    executedToolName = "unsupported_agent";
    status = "blocked";
    reason = "Selected tool was not registered, so the request was blocked.";
  }

  if (hasPrivateDataRisk(question, extractedEntities)) {
    executedToolName = "data_limitation_agent";
    status = toolName === "data_limitation_agent" ? "approved" : "overridden";
    reason =
      "Registry detected private/internal data risk and routed to the data limitation agent.";
  }

  if (isUnsafeCausalityQuestion(question)) {
    executedToolName = "data_limitation_agent";
    status = toolName === "data_limitation_agent" ? "approved" : "overridden";
    reason =
      "Registry blocked an unsafe causality inference from public data.";
  }

  const validationChecks = buildValidationChecks({
    selectedToolName: toolName,
    executedToolName,
    question,
    extractedEntities,
  });

  const hasFailedCheck = validationChecks.some((check) => check.status === "fail");

  if (hasFailedCheck) {
    executedToolName = "data_limitation_agent";
    status = "blocked";
    reason = "Registry blocked execution because one or more safety checks failed.";
  }

  const finalDefinition = safeToolDefinitions[executedToolName];

  const trace: SafeToolRegistryTrace = {
    selectedToolName: toolName,
    executedToolName,
    status,
    reason,
    requiresSql: finalDefinition.requiresSql,
    requiresRag: finalDefinition.requiresRag,
    allowedDataSources: finalDefinition.allowedDataSources,
    privateDataPolicy: finalDefinition.privateDataPolicy,
    validationChecks,
  };

  return {
    executedToolName,
    trace,
  };
}

function buildDefaultAgentSteps({
  registry,
  toolLabel,
}: {
  registry: SafeToolRegistryTrace;
  toolLabel: string;
}): AgentStep[] {
  return [
    {
      id: "registry-validation",
      name: "Safe Tool Registry",
      status: registry.status === "approved" ? "complete" : "warning",
      summary: registry.reason,
      details: registry.validationChecks.map(
        (check) => `${check.name}: ${check.status} — ${check.detail}`
      ),
    },
    {
      id: "tool-execution",
      name: toolLabel,
      status: "complete",
      summary: `Executed ${registry.executedToolName}.`,
      details: [
        `Requires SQL: ${registry.requiresSql}`,
        `Requires RAG: ${registry.requiresRag}`,
        `Allowed data sources: ${registry.allowedDataSources.join(", ")}`,
      ],
    },
  ];
}

function buildLimitationSource(reason: string): SourceEvidence {
  return {
    id: "data-limitation",
    title: "Data limitation",
    dataset: "System limitation",
    score: 1,
    status: "used",
    excerpt: reason,
    metadata: [
      "Citation: [LIMIT-1]",
      "Private/internal business data is not available.",
      "Public datasets cannot prove private revenue, profit, deals, CRM records, rebates, contracts, or sales-rep performance.",
    ],
    citationLabel: "LIMIT-1",
    citationType: "limit",
  };
}

function buildDataLimitationResult(
  question: string,
  registry: SafeToolRegistryTrace
): RawAgentResult {
  const limitationText =
    "PharmaRev AI cannot answer this from the available public datasets because it asks for private/internal business information or an unsupported inference. The system only uses public datasets such as CMS Part D, CMS Open Payments, public pharma sales quantity data, and FDA label evidence. It cannot access CRM records, sales-rep performance, private revenue, profit, margins, rebates, discounts, contracts, customer accounts, or deal-loss data. [LIMIT-1]";

  const limitationSource = buildLimitationSource(limitationText);

  return {
    answer: limitationText,
    rows: [],
    sqlQuery: "",
    sources: [limitationSource],
    entities: {
      question,
      limitationType: "private_or_unsupported_business_data",
    },
    route: "DATA_LIMITATION",
    composer: {
      role: "data_limitation_agent",
      usedLlm: false,
      status: "complete",
    },
    verification: verifyGroundedAnswer({
      answer: limitationText,
      sources: [limitationSource],
      rows: [],
      needsSql: false,
      needsRag: false,
    }),
    agentSteps: buildDefaultAgentSteps({
      registry,
      toolLabel: "Data Limitation Agent",
    }),
  };
}

function buildUnsupportedResult(
  question: string,
  registry: SafeToolRegistryTrace
): RawAgentResult {
  const limitationText =
    "I could not match this question to the available public pharma data. PharmaRev AI can answer questions about Medicare Part D spending, Part D prescribers, Open Payments, public pharma sales quantity/category trends, and FDA label evidence. Please specify the dataset, metric, drug, company, or label section you want to analyze. [LIMIT-1]";

  const limitationSource = buildLimitationSource(limitationText);

  return {
    answer: limitationText,
    rows: [],
    sqlQuery: "",
    sources: [limitationSource],
    entities: {
      question,
      limitationType: "unsupported_or_ambiguous_question",
    },
    route: "UNSUPPORTED",
    composer: {
      role: "unsupported_agent",
      usedLlm: false,
      status: "complete",
    },
    verification: verifyGroundedAnswer({
      answer: limitationText,
      sources: [limitationSource],
      rows: [],
      needsSql: false,
      needsRag: false,
    }),
    agentSteps: buildDefaultAgentSteps({
      registry,
      toolLabel: "Unsupported Question Agent",
    }),
  };
}

function getFunctionFromModule(
  module: Record<string, unknown>,
  exportNames: string[]
): AgentFunction {
  for (const exportName of exportNames) {
    const candidate = module[exportName];

    if (typeof candidate === "function") {
      return candidate as AgentFunction;
    }
  }

  throw new Error(
    `None of these agent exports were found: ${exportNames.join(", ")}`
  );
}

async function invokeRegisteredAgent(
  toolName: SafeToolName,
  question: string,
  registry: SafeToolRegistryTrace
): Promise<RawAgentResult> {
  if (toolName === "data_limitation_agent") {
    return buildDataLimitationResult(question, registry);
  }

  if (toolName === "unsupported_agent") {
    return buildUnsupportedResult(question, registry);
  }

  if (toolName === "part_d_top_spending_agent") {
    const module = (await import("./partDSpendingAgent")) as Record<
      string,
      unknown
    >;

    const fn = getFunctionFromModule(module, [
      "answerPartDTopSpendingQuestion",
      "answerTopPartDSpendingQuestion",
      "answerPartDQuestion",
    ]);

    return fn(question);
  }

  if (toolName === "part_d_spending_increase_agent") {
    const module = (await import("./partDSpendingAgent")) as Record<
      string,
      unknown
    >;

    const fn = getFunctionFromModule(module, [
      "answerPartDSpendingIncreaseQuestion",
      "answerPartDIncreaseQuestion",
      "answerSpendingIncreaseQuestion",
    ]);

    return fn(question);
  }

  if (toolName === "part_d_drug_trend_agent") {
    const module = (await import("./partDSpendingAgent")) as Record<
      string,
      unknown
    >;

    const fn = getFunctionFromModule(module, [
      "answerPartDDrugTrendQuestion",
      "answerPartDTrendQuestion",
      "answerDrugTrendQuestion",
    ]);

    return fn(question);
  }

  if (toolName === "part_d_prescriber_agent") {
    const module = (await import("./partDPrescriberAgent")) as Record<
      string,
      unknown
    >;

    const fn = getFunctionFromModule(module, [
      "answerPartDPrescriberQuestion",
      "answerPartDPrescriberAnalysisQuestion",
      "answerPrescriberQuestion",
    ]);

    return fn(question);
  }

  if (toolName === "open_payments_agent") {
    const module = (await import("./openPaymentsAgent")) as Record<
      string,
      unknown
    >;

    const fn = getFunctionFromModule(module, [
      "answerOpenPaymentsQuestion",
      "answerOpenPaymentsAnalysisQuestion",
      "answerPaymentsQuestion",
    ]);

    return fn(question);
  }

  if (toolName === "pharma_sales_agent") {
    const module = (await import("./pharmaSalesAgent")) as Record<
      string,
      unknown
    >;

    const fn = getFunctionFromModule(module, [
      "answerPharmaSalesQuestion",
      "answerPharmaSalesAnalysisQuestion",
      "answerSalesQuestion",
    ]);

    return fn(question);
  }

  if (toolName === "openfda_label_agent") {
    const module = (await import("./fdaLabelAgent")) as Record<string, unknown>;

    const fn = getFunctionFromModule(module, [
      "answerFdaLabelQuestion",
      "answerOpenFdaLabelQuestion",
      "answerFdaQuestion",
    ]);

    return fn(question);
  }

  return buildUnsupportedResult(question, registry);
}

function hasCitationPrefix(sources: SourceEvidence[], prefix: string) {
  const normalizedPrefix = prefix.toUpperCase();

  return sources.some((source) =>
    String(source.citationLabel ?? "")
      .toUpperCase()
      .startsWith(normalizedPrefix)
  );
}

function answerHasCitation(answer: string, label: string) {
  return answer.includes(`[${label}]`);
}

function ensureLimitCitation({
  answer,
  sources,
}: {
  answer: string;
  sources: SourceEvidence[];
}) {
  const hasLimitSource = hasCitationPrefix(sources, "LIMIT");
  const hasLimitAnswerCitation = /\[LIMIT-\d+\]/i.test(answer);

  const limitText =
    "Data limitation: This answer uses only available public PharmaRev datasets and does not prove private revenue, profit, clinical causality, sales-rep performance, rebates, discounts, contracts, or customer-level outcomes. [LIMIT-1]";

  let nextSources = sources;

  if (!hasLimitSource) {
    nextSources = [...nextSources, buildLimitationSource(limitText)];
  }

  const nextAnswer = hasLimitAnswerCitation
    ? answer
    : `${answer.trim()}\n\n${limitText}`;

  return {
    answer: nextAnswer,
    sources: nextSources,
  };
}

function ensureKbCitationForRag({
  answer,
  sources,
  route,
}: {
  answer: string;
  sources: SourceEvidence[];
  route: PharmaRevRoute;
}) {
  if (route !== "RAG_ONLY" && route !== "HYBRID_SQL_RAG") {
    return answer;
  }

  const kbSource = sources.find(
    (source) =>
      source.citationType === "kb" ||
      String(source.citationLabel || "").toUpperCase().startsWith("KB")
  );

  if (!kbSource) {
    return answer;
  }

  if (/\[KB-\d+\]/i.test(answer)) {
    return answer;
  }

  const label = kbSource.citationLabel || "KB-1";

  return `${answer.trim()}\n\nEvidence note: The FDA label context above is supported by available FDA label evidence. [${label}]`;
}

async function normalizeAgentResult({
  rawResult,
  question,
  registry,
  router,
}: {
  rawResult: RawAgentResult;
  question: string;
  registry: SafeToolRegistryTrace;
  router?: unknown;
}): RegisteredToolResult {
  const definition = safeToolDefinitions[registry.executedToolName];

  const fallbackRoute =
    getRouterRoute(router) || getFallbackRouteForTool(registry.executedToolName);

  const route = normalizeRoute(rawResult.route, fallbackRoute);

  let answer =
    typeof rawResult.answer === "string" && rawResult.answer.trim()
      ? rawResult.answer
      : "I could not generate a valid answer for this request. [LIMIT-1]";

  const rows = toRows(rawResult.rows);
  let sources = toSources(rawResult.sources);
  const sqlQuery = typeof rawResult.sqlQuery === "string" ? rawResult.sqlQuery : "";

  if (route === "RAG_ONLY" || route === "HYBRID_SQL_RAG") {
  answer = ensureKbCitationForRag({
      answer,
      sources,
      route,
    });
  }

  if (
    route === "RAG_ONLY" ||
    route === "HYBRID_SQL_RAG" ||
    route === "SQL_ONLY" ||
    route === "DATA_LIMITATION" ||
    route === "LIMITATION" ||
    route === "UNSUPPORTED"
  ) {
    const withLimit = ensureLimitCitation({ answer, sources });
    answer = withLimit.answer;
    sources = withLimit.sources;
  }

  const rawEntities = isRecord(rawResult.entities) ? rawResult.entities : {};
  let composer = isRecord(rawResult.composer) ? rawResult.composer : undefined;

  const composition = await composePharmaAnswer({
    question,
    draftAnswer: answer,
    sqlQuery,
    rows,
    sources,
  });

  answer = composition.answer;
  composer = {
    ...(composer || {}),
    ...composition.trace,
    role: "answer_composer",
    answerMode: route,
  };

  const verification =
    rawResult.verification && isRecord(rawResult.verification)
      ? (rawResult.verification as ReturnType<typeof verifyGroundedAnswer>)
      : verifyGroundedAnswer({
          answer,
          sources,
          rows,
          needsSql: definition.requiresSql || route === "HYBRID_SQL_RAG",
          needsRag: definition.requiresRag || route === "HYBRID_SQL_RAG",
        });

  const existingSteps = toAgentSteps(rawResult.agentSteps);

  const agentSteps =
    existingSteps.length > 0
      ? [
          ...buildDefaultAgentSteps({
            registry,
            toolLabel: definition.label,
          }),
          ...existingSteps,
        ]
      : buildDefaultAgentSteps({
          registry,
          toolLabel: definition.label,
        });

  return {
    answer,
    rows,
    sqlQuery,
    sources,
    entities: {
      ...rawEntities,
      question,
      route,
      registry,
      executedToolName: registry.executedToolName,
    },
    route,
    composer,
    verification,
    registry,
    agentSteps,
  };
}

export function getSafeToolDefinition(toolName: SafeToolName) {
  return safeToolDefinitions[toolName];
}

export function listRegisteredTools() {
  return Object.values(safeToolDefinitions);
}

export async function executeRegisteredTool(
  input: ExecuteRegisteredToolInput
): Promise<RegisteredToolResult> {
  const validation = validateToolSelection(input);

  try {
    let rawResult = await invokeRegisteredAgent(
      validation.executedToolName,
      input.question,
      validation.trace
    );

    const routerRoute = getRouterRoute(input.router);

    if (routerRoute === "HYBRID_SQL_RAG" || rawResult.route === "HYBRID_SQL_RAG") {
      rawResult = await augmentHybridResultWithLabelEvidence({
        question: input.question,
        result: rawResult,
      });
    }

    return await normalizeAgentResult({
      rawResult,
      question: input.question,
      registry: validation.trace,
      router: input.router,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown registered tool error.";

    const failedTrace: SafeToolRegistryTrace = {
      ...validation.trace,
      status: "failed",
      reason: `Registered tool execution failed: ${message}`,
    };

    const fallback = buildUnsupportedResult(input.question, failedTrace);

    return await normalizeAgentResult({
      rawResult: fallback,
      question: input.question,
      registry: failedTrace,
      router: input.router,
    });
  }
}
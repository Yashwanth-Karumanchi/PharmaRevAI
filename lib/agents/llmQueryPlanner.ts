import type { SafeToolName } from "./safeToolRegistry";

export type PlannerRoute =
  | "SQL_ONLY"
  | "RAG_ONLY"
  | "HYBRID_SQL_RAG"
  | "DATA_LIMITATION"
  | "UNSUPPORTED";

export type PlannerConfidence = "High" | "Medium" | "Low";

export type LlmQueryPlan = {
  toolName: SafeToolName;
  route: PlannerRoute;
  intent: string;
  needsSql: boolean;
  needsRag: boolean;
  privateDataRisk: boolean;
  confidence: PlannerConfidence;
  reason: string;
  entities: {
    drugs: string[];
    generics: string[];
    companies: string[];
    states: string[];
    years: number[];
    categories: string[];
    metrics: string[];
  };
  retrievalFilters: {
    sourceTypes: string[];
    sections: string[];
    datasets: string[];
  };
};

export type LlmPlannerTrace = {
  enabled: boolean;
  usedLlm: boolean;
  status: "success" | "skipped" | "failed" | "fallback";
  model: string;
  promptVersion: string;
  reason: string;
  rawOutput?: string;
  error?: string;
};

export type LlmPlannerDecision = {
  plan: LlmQueryPlan;
  trace: LlmPlannerTrace;
};

type GeminiGenerateResponse = {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

const plannerPromptVersion = "llm-query-planner-v1";

const allowedToolNames: SafeToolName[] = [
  "part_d_top_spending_agent",
  "part_d_spending_increase_agent",
  "part_d_drug_trend_agent",
  "part_d_prescriber_agent",
  "open_payments_agent",
  "pharma_sales_agent",
  "openfda_label_agent",
  "data_limitation_agent",
  "unsupported_agent",
];

const allowedRoutes: PlannerRoute[] = [
  "SQL_ONLY",
  "RAG_ONLY",
  "HYBRID_SQL_RAG",
  "DATA_LIMITATION",
  "UNSUPPORTED",
];

function normalizeModelId(model: string) {
  return model.replace(/^models\//, "").trim();
}

function getPlannerModel() {
  return normalizeModelId(
    process.env.LLM_PLANNER_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-2.0-flash"
  );
}

function isPlannerEnabled() {
  return process.env.LLM_PLANNER_ENABLED === "true";
}

function isSafeToolName(value: unknown): value is SafeToolName {
  return (
    typeof value === "string" &&
    allowedToolNames.includes(value as SafeToolName)
  );
}

function isPlannerRoute(value: unknown): value is PlannerRoute {
  return typeof value === "string" && allowedRoutes.includes(value as PlannerRoute);
}

function normalizeConfidence(value: unknown): PlannerConfidence {
  if (value === "High" || value === "Medium" || value === "Low") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.toLowerCase();

    if (normalized === "high") return "High";
    if (normalized === "medium") return "Medium";
    if (normalized === "low") return "Low";
  }

  return "Medium";
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
    .slice(0, 20);
}

function toNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .slice(0, 20);
}

function toBoolean(value: unknown) {
  return value === true;
}

function extractTextFromGeminiResponse(data: GeminiGenerateResponse) {
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || ""
  );
}

function extractJsonObject(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Planner response did not include a JSON object.");
  }

  const jsonText = cleaned.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonText) as Record<string, unknown>;
}

function safeStringify(value: unknown, maxLength = 7000) {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return "{}";
  }
}

function buildPlannerPrompt({
  question,
  extractedEntities,
  deterministicFallback,
}: {
  question: string;
  extractedEntities: unknown;
  deterministicFallback: LlmQueryPlan;
}) {
  return `
You are the PharmaRev AI LLM Query Planner.

Your job:
Understand the user's pharmaceutical analytics question and choose exactly ONE safe tool.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanations outside JSON.
Do not call tools directly.
Do not write SQL.

Allowed tools:
${allowedToolNames.map((tool) => `- ${tool}`).join("\n")}

Tool meanings:
- openfda_label_agent: FDA label, indications, use, warnings, adverse reactions, dosage, contraindications, label context.
- part_d_top_spending_agent: Medicare Part D highest/top spending drugs by year.
- part_d_spending_increase_agent: Medicare Part D spending growth/increase/change across years.
- part_d_drug_trend_agent: Medicare Part D spending trend for a specific drug.
- part_d_prescriber_agent: Medicare Part D prescriber/provider/state/specialty drug-cost analysis.
- open_payments_agent: CMS Open Payments, companies, physician specialties, recipient states, payment amount/nature.
- pharma_sales_agent: public pharma sales quantity, category trends, seasonality, simple forecast, ATC categories like M01AB, M01AE, N02BA, N02BE, N05B, N05C, R03, R06.
- data_limitation_agent: private/internal/unsupported business data such as CRM, sales reps, margins, rebates, discounts, contracts, private revenue, deal loss, customer/account data.
- unsupported_agent: question cannot be answered by the loaded public datasets.

Routes:
- SQL_ONLY
- RAG_ONLY
- HYBRID_SQL_RAG
- DATA_LIMITATION
- UNSUPPORTED

Strict safety rules:
1. If the user asks about private CRM data, sales reps, internal revenue, lost deals, margins, profits, rebates, discounts, contracts, customer/account data, or internal performance, choose data_limitation_agent.
2. Never infer profit, revenue, prescribing causality, doctor behavior, sales-rep performance, or contract outcomes from public data.
3. Medicare Part D spending is public drug spending/cost data, not company revenue or profit.
4. Open Payments are transfers of value, not sales, prescriptions, or proof of influence.
5. FDA labels explain approved label context, not sales performance.
6. If unsure between safe data and private data, choose data_limitation_agent.
7. If unsupported by loaded data, choose unsupported_agent.

User question:
${question}

Entity hints from deterministic extractor:
${safeStringify(extractedEntities)}

Deterministic fallback plan:
${safeStringify(deterministicFallback)}

Return exactly this JSON shape:
{
  "toolName": "one allowed tool name",
  "route": "SQL_ONLY | RAG_ONLY | HYBRID_SQL_RAG | DATA_LIMITATION | UNSUPPORTED",
  "intent": "short intent label",
  "needsSql": true,
  "needsRag": false,
  "privateDataRisk": false,
  "confidence": "High | Medium | Low",
  "reason": "one short reason",
  "entities": {
    "drugs": [],
    "generics": [],
    "companies": [],
    "states": [],
    "years": [],
    "categories": [],
    "metrics": []
  },
  "retrievalFilters": {
    "sourceTypes": [],
    "sections": [],
    "datasets": []
  }
}
`.trim();
}

function normalizePlanObject(
  value: Record<string, unknown>,
  fallback: LlmQueryPlan
): LlmQueryPlan {
  const toolName = isSafeToolName(value.toolName)
    ? value.toolName
    : fallback.toolName;

  const route = isPlannerRoute(value.route) ? value.route : fallback.route;

  const rawEntities =
    typeof value.entities === "object" && value.entities !== null
      ? (value.entities as Record<string, unknown>)
      : {};

  const rawRetrievalFilters =
    typeof value.retrievalFilters === "object" && value.retrievalFilters !== null
      ? (value.retrievalFilters as Record<string, unknown>)
      : {};

  return {
    toolName,
    route,
    intent:
      typeof value.intent === "string" && value.intent.trim()
        ? value.intent.trim().slice(0, 120)
        : fallback.intent,
    needsSql:
      typeof value.needsSql === "boolean"
        ? toBoolean(value.needsSql)
        : fallback.needsSql,
    needsRag:
      typeof value.needsRag === "boolean"
        ? toBoolean(value.needsRag)
        : fallback.needsRag,
    privateDataRisk:
      typeof value.privateDataRisk === "boolean"
        ? toBoolean(value.privateDataRisk)
        : fallback.privateDataRisk,
    confidence: normalizeConfidence(value.confidence),
    reason:
      typeof value.reason === "string" && value.reason.trim()
        ? value.reason.trim().slice(0, 500)
        : fallback.reason,
    entities: {
      drugs: toStringArray(rawEntities.drugs),
      generics: toStringArray(rawEntities.generics),
      companies: toStringArray(rawEntities.companies),
      states: toStringArray(rawEntities.states),
      years: toNumberArray(rawEntities.years),
      categories: toStringArray(rawEntities.categories),
      metrics: toStringArray(rawEntities.metrics),
    },
    retrievalFilters: {
      sourceTypes: toStringArray(rawRetrievalFilters.sourceTypes),
      sections: toStringArray(rawRetrievalFilters.sections),
      datasets: toStringArray(rawRetrievalFilters.datasets),
    },
  };
}

async function callGeminiPlanner(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = getPlannerModel();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for LLM planner.");
  }

  const temperature = Number(process.env.LLM_PLANNER_TEMPERATURE || 0);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini planner failed with HTTP ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as GeminiGenerateResponse;

  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  const text = extractTextFromGeminiResponse(data);

  if (!text) {
    throw new Error("Gemini planner returned empty response.");
  }

  return text;
}

export async function planQuestionWithLlm({
  question,
  extractedEntities,
  deterministicFallback,
}: {
  question: string;
  extractedEntities: unknown;
  deterministicFallback: LlmQueryPlan;
}): Promise<LlmPlannerDecision> {
  const model = getPlannerModel();

  if (!isPlannerEnabled()) {
    return {
      plan: deterministicFallback,
      trace: {
        enabled: false,
        usedLlm: false,
        status: "skipped",
        model,
        promptVersion: plannerPromptVersion,
        reason: "LLM planner disabled. Used deterministic fallback.",
      },
    };
  }

  try {
    const prompt = buildPlannerPrompt({
      question,
      extractedEntities,
      deterministicFallback,
    });

    const rawOutput = await callGeminiPlanner(prompt);
    const parsed = extractJsonObject(rawOutput);
    const plan = normalizePlanObject(parsed, deterministicFallback);

    return {
      plan,
      trace: {
        enabled: true,
        usedLlm: true,
        status: "success",
        model,
        promptVersion: plannerPromptVersion,
        reason: "LLM planner returned a valid safe JSON plan.",
        rawOutput,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown planner error.";

    return {
      plan: deterministicFallback,
      trace: {
        enabled: true,
        usedLlm: false,
        status: "fallback",
        model,
        promptVersion: plannerPromptVersion,
        reason: "LLM planner failed. Used deterministic fallback.",
        error: message,
      },
    };
  }
}
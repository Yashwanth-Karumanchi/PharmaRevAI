import { tryFastIntentRoute, type FastIntentRoute } from "./fastIntentRouter";
import { planWithLlmSemantics } from "./llmSemanticPlanner";

export type QueryRouteDecision = FastIntentRoute;

type SemanticSafetyDecision = {
  category:
    | "public_pharma_analytics"
    | "specific_fda_label_question"
    | "medical_treatment_recommendation"
    | "private_or_internal_data_request"
    | "unrelated_or_other";
  confidence: "Low" | "Medium" | "High";
  reason: string;
};

type GeminiCandidate = {
  content?: {
    parts?: Array<{
      text?: string;
    }>;
  };
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(normalize(term)));
}

function makeFallbackRoute(
  values: Omit<QueryRouteDecision, "planner"> & {
    reason: string;
  }
): QueryRouteDecision {
  return {
    toolName: values.toolName,
    route: values.route,
    intent: values.intent,
    confidence: values.confidence,
    extractedEntities: values.extractedEntities,
    planner: {
      status: "fallback_route",
      usedLlm: false,
      reason: values.reason,
    },
  };
}

function getGeminiKey() {
  const key = process.env.GEMINI_API_KEY;

  if (!key || !key.trim() || key.includes("your_")) {
    return null;
  }

  return key.trim();
}

function getSafetyModelName() {
  return (
    process.env.MEDICAL_SAFETY_ROUTER_MODEL ||
    process.env.LLM_PLANNER_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-3.1-flash-lite"
  );
}

function extractJson(text: string) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found.");
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

function parseSemanticSafetyDecision(
  text: string
): SemanticSafetyDecision | null {
  try {
    const json = JSON.parse(extractJson(text)) as Partial<SemanticSafetyDecision>;

    const validCategories = new Set([
      "public_pharma_analytics",
      "specific_fda_label_question",
      "medical_treatment_recommendation",
      "private_or_internal_data_request",
      "unrelated_or_other",
    ]);

    const validConfidences = new Set(["Low", "Medium", "High"]);

    if (!json.category || !validCategories.has(json.category)) {
      return null;
    }

    const confidence = validConfidences.has(json.confidence || "")
      ? json.confidence
      : "Medium";

    return {
      category: json.category,
      confidence: confidence as SemanticSafetyDecision["confidence"],
      reason: clean(json.reason) || "Semantic safety router decision.",
    };
  } catch {
    return null;
  }
}

function buildSemanticSafetyPrompt(question: string) {
  return [
    "You are a semantic safety router for PharmaRev AI.",
    "",
    "Classify the user question by meaning, not by keyword matching.",
    "",
    "PharmaRev AI can answer public pharma data questions about:",
    "- Medicare Part D spending",
    "- CMS Part D prescriber costs",
    "- CMS Open Payments",
    "- public pharma sales trends",
    "- FDA label evidence for a specific drug or label topic",
    "",
    "PharmaRev AI must not recommend drugs, treatments, medicines, or therapies for a medical condition.",
    "It may summarize loaded FDA label evidence for a specific drug, but it must not tell a user what drug they should take or what drug helps a condition.",
    "",
    "Categories:",
    "1. public_pharma_analytics: the user asks for rankings, costs, spending, claims, payments, sales, manufacturers, datasets, or public pharma analytics.",
    "2. specific_fda_label_question: the user asks what an FDA label says about a specific drug, warning, indication, adverse event, dosage, or label section.",
    "3. medical_treatment_recommendation: the user asks which drug, medicine, treatment, or therapy helps/treats a condition, or asks what they should take.",
    "4. private_or_internal_data_request: the user asks for private revenue, rebates, contracts, CRM, sales-rep performance, margins, discounts, or internal business data.",
    "5. unrelated_or_other: anything else.",
    "",
    "Important examples:",
    "- 'Which drugs had the highest Medicare Part D spending in 2024?' is public_pharma_analytics.",
    "- 'What is Eliquis used for according to the FDA label?' is specific_fda_label_question.",
    "- 'Which drug helps for jaundice?' is medical_treatment_recommendation.",
    "- 'Which sales rep lost the most private pharma deals?' is private_or_internal_data_request.",
    "",
    "Return only valid JSON with this shape:",
    JSON.stringify({
      category: "public_pharma_analytics",
      confidence: "High",
      reason: "short reason",
    }),
    "",
    "User question:",
    question,
  ].join("\n");
}

async function classifySemanticSafety(
  question: string
): Promise<SemanticSafetyDecision | null> {
  const apiKey = getGeminiKey();

  if (!apiKey) {
    return null;
  }

  const model = getSafetyModelName();
  const prompt = buildSemanticSafetyPrompt(question);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 220,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return null;
    }

    return parseSemanticSafetyDecision(text);
  } catch {
    return null;
  }
}

function medicalRecommendationLimitationRoute({
  question,
  reason,
  confidence,
}: {
  question: string;
  reason: string;
  confidence: "Low" | "Medium" | "High";
}): QueryRouteDecision {
  return makeFallbackRoute({
    toolName: "data_limitation_agent",
    route: "DATA_LIMITATION",
    intent: "medical_treatment_recommendation",
    confidence,
    extractedEntities: {
      originalQuestion: clean(question),
      limitationType: "medical_treatment_recommendation",
      semanticSafetyReason: reason,
    },
    reason:
      "Semantic safety router classified the question as a medical treatment recommendation, so it should not retrieve a random FDA label match.",
  });
}

function privateDataLimitationRoute({
  question,
  reason,
  confidence,
}: {
  question: string;
  reason: string;
  confidence: "Low" | "Medium" | "High";
}): QueryRouteDecision {
  return makeFallbackRoute({
    toolName: "data_limitation_agent",
    route: "DATA_LIMITATION",
    intent: "private_or_internal_data_request",
    confidence,
    extractedEntities: {
      originalQuestion: clean(question),
      limitationType: "private_or_internal_data",
      semanticSafetyReason: reason,
    },
    reason:
      "Semantic safety router classified the question as private/internal data.",
  });
}

function chooseSqlFallbackTool(text: string): QueryRouteDecision["toolName"] {
  if (includesAny(text, ["open payments", "payments", "physician payment"])) {
    return "open_payments_agent";
  }

  if (
    includesAny(text, [
      "sales quantity",
      "quantity sold",
      "sales trend",
      "atc",
    ])
  ) {
    return "pharma_sales_agent";
  }

  if (
    includesAny(text, [
      "prescriber",
      "provider",
      "specialty",
      "state",
      "where",
    ])
  ) {
    return "part_d_prescriber_agent";
  }

  if (
    includesAny(text, [
      "increase",
      "growth",
      "grew",
      "change",
      "trend",
      "trending",
      "over the years",
      "over years",
      "over time",
      "year over year",
      "yearly",
      "historical",
      "history",
      "across years",
      "by year",
      "all years",
    ])
  ) {
    return "part_d_spending_increase_agent";
  }

  if (
    includesAny(text, [
      "top",
      "highest",
      "rank",
      "most",
      "a lot",
      "biggest",
      "largest",
      "costliest",
      "expensive",
      "spent a lot",
      "cost the most",
      "high spend",
    ])
  ) {
    return "part_d_top_spending_agent";
  }

  return "part_d_drug_trend_agent";
}

function fallbackRouteQuestion(questionInput: unknown): QueryRouteDecision {
  const question = clean(questionInput);
  const text = normalize(question);

  if (
    includesAny(text, [
      "private",
      "internal",
      "crm",
      "salesforce",
      "sales rep",
      "rebate",
      "discount",
      "contract",
      "invoice",
      "net revenue",
      "profit",
      "margin",
      "customer account",
    ])
  ) {
    return makeFallbackRoute({
      toolName: "data_limitation_agent",
      route: "DATA_LIMITATION",
      intent: "private_or_internal_data_request",
      confidence: "High",
      extractedEntities: {},
      reason: "Fallback private-data guard.",
    });
  }

  const hasLabelIntent = includesAny(text, [
    "fda",
    "label",
    "used for",
    "warnings",
    "adverse",
    "dosage",
    "contraindication",
    "label evidence",
    "label context",
    "safety",
    "side effects",
  ]);

  const hasSqlIntent = includesAny(text, [
    "cms",
    "medicare",
    "part d",
    "spending",
    "spend",
    "spent",
    "cost",
    "expensive",
    "a lot",
    "trend",
    "trending",
    "over the years",
    "over years",
    "over time",
    "year over year",
    "yearly",
    "historical",
    "history",
    "across years",
    "by year",
    "all years",
    "prescriber",
    "provider",
    "specialty",
    "state",
    "open payments",
    "payment",
    "payments",
    "public data",
    "public signals",
    "sales quantity",
    "sales trend",
  ]);

  if (hasSqlIntent && hasLabelIntent) {
    return makeFallbackRoute({
      toolName: chooseSqlFallbackTool(text),
      route: "HYBRID_SQL_RAG",
      intent: "hybrid_public_data_plus_fda_label",
      confidence: "High",
      extractedEntities: {
        needsSqlEvidence: true,
        needsLabelEvidence: true,
      },
      reason:
        "Fallback hybrid route detected SQL/public-data intent plus FDA-label intent.",
    });
  }

  if (hasSqlIntent) {
    return makeFallbackRoute({
      toolName: chooseSqlFallbackTool(text),
      route: "SQL_ONLY",
      intent: "public_pharma_structured_data_question",
      confidence: "High",
      extractedEntities: {},
      reason: "Fallback public pharma structured-data route.",
    });
  }

  if (hasLabelIntent) {
    return makeFallbackRoute({
      toolName: "openfda_label_agent",
      route: "RAG_ONLY",
      intent: "openfda_label_question",
      confidence: "Medium",
      extractedEntities: {},
      reason: "Fallback FDA label route.",
    });
  }

  return makeFallbackRoute({
    toolName: "unsupported_agent",
    route: "UNSUPPORTED",
    intent: "unsupported_or_ambiguous",
    confidence: "Medium",
    extractedEntities: {},
    reason: "No supported public pharma route matched.",
  });
}

export async function routeQuestion(
  question: string
): Promise<QueryRouteDecision> {
  const semanticSafety = await classifySemanticSafety(question);

  if (semanticSafety?.category === "medical_treatment_recommendation") {
    return medicalRecommendationLimitationRoute({
      question,
      reason: semanticSafety.reason,
      confidence: semanticSafety.confidence,
    });
  }

  if (semanticSafety?.category === "private_or_internal_data_request") {
    return privateDataLimitationRoute({
      question,
      reason: semanticSafety.reason,
      confidence: semanticSafety.confidence,
    });
  }

  const fastRoute = tryFastIntentRoute(question);

  if (fastRoute) {
    return {
      ...fastRoute,
      extractedEntities: {
        ...fastRoute.extractedEntities,
        semanticSafety,
      },
    };
  }

  const llmRoute = await planWithLlmSemantics(question);

  if (llmRoute) {
    return {
      ...llmRoute,
      extractedEntities: {
        ...llmRoute.extractedEntities,
        semanticSafety,
      },
    };
  }

  const fallbackRoute = fallbackRouteQuestion(question);

  return {
    ...fallbackRoute,
    extractedEntities: {
      ...fallbackRoute.extractedEntities,
      semanticSafety,
    },
  };
}

export async function routeQuery(question: string): Promise<QueryRouteDecision> {
  return routeQuestion(question);
}

export default routeQuestion;
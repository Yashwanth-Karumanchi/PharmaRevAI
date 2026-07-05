import { tryFastIntentRoute, type FastIntentRoute } from "./fastIntentRouter";
import { planWithLlmSemantics } from "./llmSemanticPlanner";

export type QueryRouteDecision = FastIntentRoute;

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

function chooseSqlFallbackTool(text: string): QueryRouteDecision["toolName"] {
  if (includesAny(text, ["open payments", "payments", "physician payment"])) {
    return "open_payments_agent";
  }

  if (includesAny(text, ["sales quantity", "quantity sold", "sales trend", "atc"])) {
    return "pharma_sales_agent";
  }

  if (includesAny(text, ["prescriber", "provider", "specialty", "state", "where"])) {
    return "part_d_prescriber_agent";
  }

  if (includesAny(text, ["increase", "growth", "grew", "change"])) {
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
      reason: "Fallback hybrid route detected SQL/public-data intent plus FDA-label intent.",
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

export async function routeQuestion(question: string): Promise<QueryRouteDecision> {
  const fastRoute = tryFastIntentRoute(question);

  if (fastRoute) {
    return fastRoute;
  }

  const llmRoute = await planWithLlmSemantics(question);

  if (llmRoute) {
    return llmRoute;
  }

  return fallbackRouteQuestion(question);
}

export async function routeQuery(question: string): Promise<QueryRouteDecision> {
  return routeQuestion(question);
}

export default routeQuestion;
import type { FastIntentRoute } from "./fastIntentRouter";

type PlannerJson = {
  route?: FastIntentRoute["route"];
  toolName?: FastIntentRoute["toolName"];
  intent?: string;
  confidence?: "High" | "Medium" | "Low";
  drug?: string;
  reason?: string;
};

const allowedTools = new Set<FastIntentRoute["toolName"]>([
  "part_d_top_spending_agent",
  "part_d_spending_increase_agent",
  "part_d_drug_trend_agent",
  "part_d_prescriber_agent",
  "open_payments_agent",
  "pharma_sales_agent",
  "openfda_label_agent",
  "data_limitation_agent",
  "unsupported_agent",
]);

const allowedRoutes = new Set<FastIntentRoute["route"]>([
  "SQL_ONLY",
  "RAG_ONLY",
  "HYBRID_SQL_RAG",
  "DATA_LIMITATION",
  "UNSUPPORTED",
]);

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

function parseJson(text: string): PlannerJson | null {
  const cleaned = text
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as PlannerJson;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);

    if (!match) return null;

    try {
      return JSON.parse(match[0]) as PlannerJson;
    } catch {
      return null;
    }
  }
}

function chooseSqlToolFromQuestion(question: string): FastIntentRoute["toolName"] {
  const text = normalize(question);

  if (includesAny(text, ["open payments", "physician payment", "company payment"])) {
    return "open_payments_agent";
  }

  if (includesAny(text, ["sales quantity", "quantity sold", "atc", "units sold"])) {
    return "pharma_sales_agent";
  }

  if (includesAny(text, ["prescriber", "provider", "specialty", "state", "where"])) {
    return "part_d_prescriber_agent";
  }

  if (includesAny(text, ["increase", "growth", "grew", "rising", "biggest increase"])) {
    return "part_d_spending_increase_agent";
  }

  if (includesAny(text, ["top", "highest", "most", "rank", "costliest", "expensive", "spent a lot"])) {
    return "part_d_top_spending_agent";
  }

  return "part_d_drug_trend_agent";
}

function sanitizePlannerDecision(question: string, json: PlannerJson): FastIntentRoute | null {
  const text = normalize(question);

  let route = json.route;
  let toolName = json.toolName;

  if (!route || !allowedRoutes.has(route)) {
    return null;
  }

  if (!toolName || !allowedTools.has(toolName)) {
    return null;
  }

  const looksPrivate = includesAny(text, [
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
    "hidden",
  ]);

  if (looksPrivate) {
    route = "DATA_LIMITATION";
    toolName = "data_limitation_agent";
  }

  if (route === "RAG_ONLY") {
    toolName = "openfda_label_agent";
  }

  if (route === "DATA_LIMITATION") {
    toolName = "data_limitation_agent";
  }

  if (route === "UNSUPPORTED") {
    toolName = "unsupported_agent";
  }

  if (route === "SQL_ONLY") {
    if (
      toolName === "openfda_label_agent" ||
      toolName === "data_limitation_agent" ||
      toolName === "unsupported_agent"
    ) {
      toolName = chooseSqlToolFromQuestion(question);
    }
  }

  if (route === "HYBRID_SQL_RAG") {
    if (
      toolName === "openfda_label_agent" ||
      toolName === "data_limitation_agent" ||
      toolName === "unsupported_agent"
    ) {
      toolName = chooseSqlToolFromQuestion(question);
    }
  }

  return {
    toolName,
    route,
    intent: json.intent || "llm_semantic_planner_intent",
    confidence: json.confidence || "Medium",
    extractedEntities: {
      drug: json.drug || "",
      plannerReason: json.reason || "",
      needsSqlEvidence: route === "SQL_ONLY" || route === "HYBRID_SQL_RAG",
      needsLabelEvidence: route === "RAG_ONLY" || route === "HYBRID_SQL_RAG",
    },
    planner: {
      status: "llm_semantic_route",
      usedLlm: true,
      reason:
        json.reason ||
        "LLM semantic planner selected the route after deterministic router did not match.",
    },
  };
}

function buildPrompt(question: string) {
  return `You are the semantic router for PharmaRev AI.

The app can answer ONLY using loaded public pharma datasets:
1. CMS Medicare Part D Spending by Drug
2. CMS Part D Prescribers
3. CMS Open Payments
4. public pharma sales quantity/category trends
5. loaded openFDA drug label chunks

Return JSON only.

Allowed routes:
- SQL_ONLY: public structured data question.
- RAG_ONLY: FDA/openFDA label question only.
- HYBRID_SQL_RAG: needs both public structured data and FDA label context.
- DATA_LIMITATION: asks for private/internal/non-loaded business data.
- UNSUPPORTED: outside scope or too ambiguous.

Allowed tools:
- part_d_top_spending_agent
- part_d_spending_increase_agent
- part_d_drug_trend_agent
- part_d_prescriber_agent
- open_payments_agent
- pharma_sales_agent
- openfda_label_agent
- data_limitation_agent
- unsupported_agent

Routing rules:
- "spent a lot", "costliest", "expensive", "high spend", "trend", "how much spent" usually mean CMS Part D spending SQL.
- "used for", "warnings", "adverse reactions", "dosage", "contraindications", "FDA label" mean RAG_ONLY.
- If both public spend/payment/prescriber data and label/warnings/use are requested, use HYBRID_SQL_RAG.
- Private revenue, sales reps, CRM, rebates, discounts, contracts, customer accounts, profit, margins, hidden data -> DATA_LIMITATION.
- Drug name only or "analyze X" without metric/source -> UNSUPPORTED because the user must specify spending, prescriber, payments, sales, or FDA label.
- Do not invent a dataset.

Question:
${question}

Return exactly:
{
  "route": "SQL_ONLY | RAG_ONLY | HYBRID_SQL_RAG | DATA_LIMITATION | UNSUPPORTED",
  "toolName": "one allowed tool",
  "intent": "short intent",
  "confidence": "High | Medium | Low",
  "drug": "normalized drug if present, else empty string",
  "reason": "one sentence"
}`;
}

export async function planWithLlmSemantics(question: string): Promise<FastIntentRoute | null> {
  if (process.env.LLM_PLANNER_ENABLED === "false") {
    return null;
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const model =
    process.env.LLM_PLANNER_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-1.5-flash";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: buildPrompt(question) }],
            },
          ],
          generationConfig: {
            temperature: 0,
            topP: 0.8,
            maxOutputTokens: 350,
          },
        }),
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text || "")
        .join("")
        .trim() || "";

    const parsed = parseJson(text);

    if (!parsed) {
      return null;
    }

    return sanitizePlannerDecision(question, parsed);
  } catch {
    clearTimeout(timeout);
    return null;
  }
}
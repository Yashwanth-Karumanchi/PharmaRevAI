export type FirewallDecision =
  | "allow"
  | "block_unrelated"
  | "block_private_data"
  | "block_unsafe_inference"
  | "clarify";

export type FirewallResult = {
  decision: FirewallDecision;
  allowed: boolean;
  reason: string;
  rewrittenQuestion: string;
  confidence: "High" | "Medium" | "Low";
  rawOutput?: string;
  error?: string;
};

type GeminiFirewallResponse = {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
};

function normalizeModelId(model: string) {
  return model.replace(/^models\//, "").trim();
}

function getFirewallModel() {
  return normalizeModelId(
    process.env.LLM_FIREWALL_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-3.1-flash-lite"
  );
}

function isFirewallEnabled() {
  return process.env.LLM_FIREWALL_ENABLED === "true";
}

function extractText(data: GeminiFirewallResponse) {
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || ""
  );
}

function parseJsonObject(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Firewall response did not include JSON.");
  }

  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function localPrecheck(question: string): FirewallResult | null {
  const normalized = question.toLowerCase();

  const privatePatterns = [
    /\bsales\s*rep\b/,
    /\bcrm\b/,
    /\bprivate revenue\b/,
    /\binternal revenue\b/,
    /\bprofit\b/,
    /\bmargin\b/,
    /\brebate\b/,
    /\bdiscount\b/,
    /\bcontract\b/,
    /\blost deal\b/,
    /\bdeal loss\b/,
    /\bquota\b/,
    /\bterritory\b/,
    /\bcustomer account\b/,
  ];

  if (privatePatterns.some((pattern) => pattern.test(normalized))) {
    return {
      decision: "block_private_data",
      allowed: false,
      reason: "Question asks for private/internal business data or unsupported private business inference.",
      rewrittenQuestion: question,
      confidence: "High",
    };
  }

  const unrelatedPatterns = [
    /\bwrite (a )?(python|java|javascript|typescript|react|sql) code\b/,
    /\bbuild (me )?(a )?(react|todo|website|app)\b/,
    /\brecipe\b/,
    /\bvacation\b/,
    /\bworkout\b/,
    /\bpoem\b/,
    /\bbinary search\b/,
    /\bkubernetes\b/,
  ];

  const pharmaWords = [
    "drug",
    "pharma",
    "medicare",
    "part d",
    "open payments",
    "fda",
    "label",
    "prescriber",
    "provider",
    "sales quantity",
    "adverse",
    "warning",
    "dosage",
  ];

  const hasPharmaContext = pharmaWords.some((word) => normalized.includes(word));

  if (!hasPharmaContext && unrelatedPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      decision: "block_unrelated",
      allowed: false,
      reason: "Question is unrelated to PharmaRev AI public pharmaceutical datasets.",
      rewrittenQuestion: question,
      confidence: "High",
    };
  }

  return null;
}

function buildPrompt({
  question,
  conversationContext,
}: {
  question: string;
  conversationContext: string;
}) {
  return `
You are the PharmaRev AI firewall.

Your job is to decide whether the user message should be allowed into a pharmaceutical public-data RAG system.

Allowed:
- Public pharma data questions.
- CMS Medicare Part D spending questions.
- CMS Part D prescriber/provider/state/specialty questions.
- CMS Open Payments questions.
- openFDA label questions.
- Public pharma sales quantity/category/forecast questions.
- Follow-up questions if the prior context is clearly about those topics.

Block unrelated:
- Coding tasks.
- General homework.
- Recipes, travel, fitness, poems, generic programming help.
- Anything not related to PharmaRev AI's public pharma datasets.

Block private data:
- CRM data.
- Sales rep performance.
- Internal/private revenue or profit.
- Margins, rebates, discounts, contracts.
- Customer accounts, territories, quotas, deal loss.
- Asking public data to prove private business outcomes.

Block unsafe inference:
- Asking Open Payments to prove prescribing/sales causality.
- Asking FDA labels to infer sales/profit/private business performance.
- Asking Medicare spending to infer company profit or private revenue.

Return ONLY JSON:
{
  "decision": "allow | block_unrelated | block_private_data | block_unsafe_inference | clarify",
  "allowed": true,
  "reason": "short reason",
  "rewrittenQuestion": "standalone rewritten question if follow-up, otherwise original",
  "confidence": "High | Medium | Low"
}

Conversation context:
${conversationContext || "No prior context."}

User message:
${question}
`.trim();
}

async function callGeminiFirewall(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for LLM firewall.");
  }

  const model = getFirewallModel();
  const temperature = Number(process.env.LLM_FIREWALL_TEMPERATURE || 0);

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
    throw new Error(`Gemini firewall failed HTTP ${response.status}: ${errorText}`);
  }

  return extractText((await response.json()) as GeminiFirewallResponse);
}

function normalizeDecision(value: unknown): FirewallDecision {
  const allowed = [
    "allow",
    "block_unrelated",
    "block_private_data",
    "block_unsafe_inference",
    "clarify",
  ];

  if (typeof value === "string" && allowed.includes(value)) {
    return value as FirewallDecision;
  }

  return "clarify";
}

function normalizeConfidence(value: unknown): "High" | "Medium" | "Low" {
  if (value === "High" || value === "Medium" || value === "Low") {
    return value;
  }

  return "Medium";
}

export async function runLlmFirewall({
  question,
  conversationContext = "",
}: {
  question: string;
  conversationContext?: string;
}): Promise<FirewallResult> {
  const precheck = localPrecheck(question);

  if (precheck) {
    return precheck;
  }

  if (!isFirewallEnabled()) {
    return {
      decision: "allow",
      allowed: true,
      reason: "Firewall disabled.",
      rewrittenQuestion: question,
      confidence: "Medium",
    };
  }

  try {
    const prompt = buildPrompt({ question, conversationContext });
    const rawOutput = await callGeminiFirewall(prompt);
    const parsed = parseJsonObject(rawOutput);

    const decision = normalizeDecision(parsed.decision);
    const allowed = decision === "allow";

    return {
      decision,
      allowed,
      reason:
        typeof parsed.reason === "string"
          ? parsed.reason
          : "Firewall returned a decision.",
      rewrittenQuestion:
        typeof parsed.rewrittenQuestion === "string" &&
        parsed.rewrittenQuestion.trim()
          ? parsed.rewrittenQuestion.trim()
          : question,
      confidence: normalizeConfidence(parsed.confidence),
      rawOutput,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown firewall error.";

    return {
      decision: "clarify",
      allowed: false,
      reason: "Firewall failed closed to avoid unsafe or unrelated answers.",
      rewrittenQuestion: question,
      confidence: "Low",
      error: message,
    };
  }
}
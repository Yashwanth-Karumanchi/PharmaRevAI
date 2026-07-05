import type { SourceEvidence, SqlEvidence } from "../../types/evidence";

export type RagAnswerGeneratorStatus =
  | "success"
  | "skipped"
  | "fallback"
  | "failed";

export type RagAnswerGenerationTrace = {
  enabled: boolean;
  usedLlm: boolean;
  provider: "gemini" | "none";
  model: string;
  status: RagAnswerGeneratorStatus;
  promptVersion: string;
  contextSourceCount: number;
  sqlRowCount: number;
  allowedCitationLabels: string[];
  citedLabels: string[];
  unsupportedCitationLabels: string[];
  missingRequiredCitationLabels: string[];
  reason: string;
  rawOutput?: string;
  error?: string;
};

export type GenerateRagAnswerInput = {
  question: string;
  fallbackAnswer: string;
  sources: SourceEvidence[];
  sqlEvidence?: SqlEvidence | null;
  requireKbCitation?: boolean;
  requireSqlCitation?: boolean;
  requireLimitCitation?: boolean;
};

export type GenerateRagAnswerResult = {
  answer: string;
  trace: RagAnswerGenerationTrace;
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

const promptVersion = "strict-rag-answer-generator-v1";

function normalizeModelId(model: string) {
  return model.replace(/^models\//, "").trim();
}

function getGeneratorModel() {
  return normalizeModelId(
    process.env.RAG_GENERATOR_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-2.0-flash"
  );
}

function isGeneratorEnabled() {
  return process.env.RAG_GENERATOR_ENABLED === "true";
}

function getTemperature() {
  return Number(process.env.RAG_GENERATOR_TEMPERATURE || 0);
}

function shouldRequireLimitCitation() {
  return process.env.RAG_GENERATOR_REQUIRE_LIMIT_CITATION !== "false";
}

function cleanText(text: string, maxLength: number) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function getSourceCitationLabels(sources: SourceEvidence[]) {
  return sources
    .map((source) => source.citationLabel)
    .filter((label): label is string => Boolean(label));
}

function getSqlCitationLabels(sqlEvidence?: SqlEvidence | null) {
  if (!sqlEvidence || sqlEvidence.resultRows.length === 0) {
    return [];
  }

  return ["SQL-1"];
}

function getAllowedCitationLabels({
  sources,
  sqlEvidence,
}: {
  sources: SourceEvidence[];
  sqlEvidence?: SqlEvidence | null;
}) {
  return Array.from(
    new Set([...getSourceCitationLabels(sources), ...getSqlCitationLabels(sqlEvidence)])
  );
}

function getCitationLabelsFromAnswer(answer: string) {
  const matches = answer.match(/\[(?:KB|SQL|LIMIT)-\d+\]/g) ?? [];
  return Array.from(new Set(matches));
}

function hasCitationPrefix(labels: string[], prefix: "KB" | "SQL" | "LIMIT") {
  return labels.some((label) => label.startsWith(`[${prefix}-`));
}

function buildSqlContext(sqlEvidence?: SqlEvidence | null) {
  if (!sqlEvidence || sqlEvidence.resultRows.length === 0) {
    return "No SQL evidence was provided.";
  }

  const rowsText = JSON.stringify(sqlEvidence.resultRows.slice(0, 20), null, 2);

  return `
SQL SOURCE [SQL-1]
Query:
${sqlEvidence.query}

Rows:
${rowsText}

Notes:
${sqlEvidence.notes.join("\n")}
`.trim();
}

function buildSourceContext(sources: SourceEvidence[]) {
  if (sources.length === 0) {
    return "No retrieved source evidence was provided.";
  }

  return sources
    .map((source) => {
      const label = source.citationLabel || source.id;
      const metadata = source.metadata.length > 0 ? source.metadata.join("; ") : "none";

      return `
SOURCE ${label}
Title: ${source.title}
Dataset: ${source.dataset}
Citation type: ${source.citationType || "unknown"}
Status: ${source.status}
Score: ${source.score}
Metadata: ${metadata}
Excerpt:
${cleanText(source.excerpt, 1800)}
`.trim();
    })
    .join("\n\n---\n\n");
}

function buildPrompt({
  question,
  fallbackAnswer,
  sources,
  sqlEvidence,
}: {
  question: string;
  fallbackAnswer: string;
  sources: SourceEvidence[];
  sqlEvidence?: SqlEvidence | null;
}) {
  const allowedLabels = getAllowedCitationLabels({ sources, sqlEvidence });

  return `
You are the strict PharmaRev AI RAG answer generator.

Your job is to write a clean, concise chatbot answer using ONLY the provided evidence.

Hard rules:
1. Use only the SQL evidence and retrieved source evidence below.
2. Do not use outside knowledge.
3. Do not copy long raw excerpts.
4. Do not dump metadata such as "Source:", "Title:", "Drug:", "Manufacturer:", or "Section:" into the final answer.
5. Synthesize the answer in your own words.
6. Every factual claim must be supported by a citation label.
7. Use citation labels exactly as provided.
8. Allowed citation labels: ${allowedLabels.join(", ") || "none"}.
9. If the evidence is insufficient, say the retrieved evidence is insufficient.
10. Do not infer private revenue, profit, rebates, discounts, contracts, CRM data, sales-rep performance, customer accounts, or deal loss.
11. Do not give medical advice. Describe label context only.
12. Keep the answer short unless the user asks for detail.

Answer style:
- Start with the direct answer in 1–3 sentences.
- Add only the most relevant evidence.
- Add one short data limitation sentence.
- Do not include headings unless needed.
- Do not include bullet points unless the answer has multiple distinct items.
- Do not paste raw retrieved chunks.

Good style example:
"Anoro Ellipta is used as a maintenance treatment for patients with chronic obstructive pulmonary disease, or COPD. The loaded FDA label also says it is not for relief of acute bronchospasm and is not established for asthma treatment. [KB-1]

Data limitation: This answer uses only the loaded openFDA label chunks and is not medical advice. [LIMIT-1]"

Bad style example:
"Evidence:
- Source: openFDA Drug Label Dataset Title: openFDA label Drug: ..."
Do not write like that.

User question:
${question}

SQL evidence:
${buildSqlContext(sqlEvidence)}

Retrieved source evidence:
${buildSourceContext(sources)}

Fallback draft answer from deterministic agent:
${fallbackAnswer}

Return only the final polished answer text. Do not include JSON.
`.trim();
}

function extractTextFromGeminiResponse(data: GeminiGenerateResponse) {
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || ""
  );
}

function validateGeneratedAnswer({
  answer,
  allowedCitationLabels,
  requireKbCitation,
  requireSqlCitation,
  requireLimitCitation,
}: {
  answer: string;
  allowedCitationLabels: string[];
  requireKbCitation: boolean;
  requireSqlCitation: boolean;
  requireLimitCitation: boolean;
}) {
  const citedLabels = getCitationLabelsFromAnswer(answer);
  const allowedSet = new Set(allowedCitationLabels);

  const unsupportedCitationLabels = citedLabels.filter(
    (label) => !allowedSet.has(label)
  );

  const missingRequiredCitationLabels: string[] = [];

  if (requireKbCitation && !hasCitationPrefix(citedLabels, "KB")) {
    missingRequiredCitationLabels.push("KB citation");
  }

  if (requireSqlCitation && !hasCitationPrefix(citedLabels, "SQL")) {
    missingRequiredCitationLabels.push("SQL citation");
  }

  if (requireLimitCitation && !hasCitationPrefix(citedLabels, "LIMIT")) {
    missingRequiredCitationLabels.push("LIMIT citation");
  }

  return {
    citedLabels,
    unsupportedCitationLabels,
    missingRequiredCitationLabels,
    isValid:
      unsupportedCitationLabels.length === 0 &&
      missingRequiredCitationLabels.length === 0,
  };
}

async function callGeminiGenerator(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = getGeneratorModel();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for strict RAG generation.");
  }

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
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: getTemperature(),
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini RAG generator failed with HTTP ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as GeminiGenerateResponse;

  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  const text = extractTextFromGeminiResponse(data);

  if (!text) {
    throw new Error("Gemini RAG generator returned an empty answer.");
  }

  return text;
}

export async function generateStrictRagAnswer({
  question,
  fallbackAnswer,
  sources,
  sqlEvidence = null,
  requireKbCitation = sources.some((source) => source.citationType === "kb"),
  requireSqlCitation = Boolean(sqlEvidence?.resultRows.length),
  requireLimitCitation = shouldRequireLimitCitation(),
}: GenerateRagAnswerInput): Promise<GenerateRagAnswerResult> {
  const model = getGeneratorModel();
  const allowedCitationLabels = getAllowedCitationLabels({ sources, sqlEvidence });

  const baseTrace = {
    enabled: isGeneratorEnabled(),
    usedLlm: false,
    provider: "none" as const,
    model,
    promptVersion,
    contextSourceCount: sources.length,
    sqlRowCount: sqlEvidence?.resultRows.length ?? 0,
    allowedCitationLabels,
    citedLabels: getCitationLabelsFromAnswer(fallbackAnswer),
    unsupportedCitationLabels: [],
    missingRequiredCitationLabels: [],
  };

  if (!isGeneratorEnabled()) {
    return {
      answer: fallbackAnswer,
      trace: {
        ...baseTrace,
        status: "skipped",
        reason: "RAG generator disabled. Used deterministic fallback answer.",
      },
    };
  }

  if (allowedCitationLabels.length === 0) {
    return {
      answer: fallbackAnswer,
      trace: {
        ...baseTrace,
        status: "fallback",
        reason: "No citation labels were available. Used deterministic fallback answer.",
      },
    };
  }

  try {
    const prompt = buildPrompt({
      question,
      fallbackAnswer,
      sources,
      sqlEvidence,
    });

    const generatedAnswer = await callGeminiGenerator(prompt);

    const validation = validateGeneratedAnswer({
      answer: generatedAnswer,
      allowedCitationLabels,
      requireKbCitation,
      requireSqlCitation,
      requireLimitCitation,
    });

    if (!validation.isValid) {
      return {
        answer: fallbackAnswer,
        trace: {
          ...baseTrace,
          usedLlm: true,
          provider: "gemini",
          status: "fallback",
          reason:
            "Generated answer failed citation validation. Used deterministic fallback answer.",
          rawOutput: generatedAnswer,
          citedLabels: validation.citedLabels,
          unsupportedCitationLabels: validation.unsupportedCitationLabels,
          missingRequiredCitationLabels:
            validation.missingRequiredCitationLabels,
        },
      };
    }

    return {
      answer: generatedAnswer,
      trace: {
        ...baseTrace,
        usedLlm: true,
        provider: "gemini",
        status: "success",
        reason:
          "Generated answer passed strict citation validation and used provided evidence.",
        rawOutput: generatedAnswer,
        citedLabels: validation.citedLabels,
        unsupportedCitationLabels: validation.unsupportedCitationLabels,
        missingRequiredCitationLabels:
          validation.missingRequiredCitationLabels,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown RAG generator error.";

    return {
      answer: fallbackAnswer,
      trace: {
        ...baseTrace,
        status: "failed",
        reason: "RAG generator failed. Used deterministic fallback answer.",
        error: message,
      },
    };
  }
}
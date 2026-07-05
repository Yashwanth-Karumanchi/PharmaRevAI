import type { SourceEvidence } from "@/types/evidence";

export type LlmComposerTrace = {
  enabled: boolean;
  usedLlm: boolean;
  provider: "gemini" | "none";
  model: string;
  status: "used" | "skipped" | "failed" | "rejected";
  reason: string;
};

type ComposeAnswerInput = {
  question: string;
  draftAnswer: string;
  sqlQuery: string;
  rows: unknown[];
  sources: SourceEvidence[];
};

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
  error?: {
    message?: string;
  };
};

type AnswerMode = "SQL_ONLY" | "RAG_ONLY" | "HYBRID_SQL_RAG" | "LIMITATION";

type ComposerConfig = {
  enabled: boolean;
  model: string;
  apiKey: string;
};

export function getLlmComposerConfig(): ComposerConfig {
  const enabled =
    process.env.LLM_COMPOSER_ENABLED === "true" ||
    process.env.PHARMAREV_LLM_COMPOSER_ENABLED === "true" ||
    process.env.ENABLE_LLM_COMPOSER === "true";

  const model =
    process.env.LLM_COMPOSER_MODEL ||
    process.env.RAG_GENERATOR_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-3.1-flash-lite";

  const apiKey = process.env.GEMINI_API_KEY || "";

  return {
    enabled,
    model,
    apiKey,
  };
}

export function buildSkippedComposerTrace(
  reason: string,
  options?: {
    enabled?: boolean;
    model?: string;
    provider?: "gemini" | "none";
  }
): LlmComposerTrace {
  return {
    enabled: Boolean(options?.enabled),
    usedLlm: false,
    provider: options?.provider || "none",
    model: options?.model || "none",
    status: "skipped",
    reason,
  };
}

export async function composePharmaAnswer({
  question,
  draftAnswer,
  sqlQuery,
  rows,
  sources,
}: ComposeAnswerInput) {
  const config = getLlmComposerConfig();

  const answerMode = detectAnswerMode({
    question,
    draftAnswer,
    sources,
  });

  const cleanedDraftAnswer = prepareDraftForMode({
    draftAnswer,
    answerMode,
  });

  const cleanedSources = filterSourcesForMode({
    answerMode,
    sources,
  });

  if (!config.enabled) {
    return {
      answer: cleanedDraftAnswer,
      trace: buildSkippedComposerTrace(
        "LLM composer is disabled. Deterministic answer was used.",
        {
          enabled: false,
          model: config.model,
          provider: "none",
        }
      ),
    };
  }

  if (answerMode === "SQL_ONLY" || answerMode === "LIMITATION") {
    return {
      answer: cleanedDraftAnswer,
      trace: buildSkippedComposerTrace(
        `LLM composer is enabled but skipped for ${answerMode}. SQL and limitation answers stay deterministic to preserve exact numbers and policy wording.`,
        {
          enabled: true,
          model: config.model,
          provider: "gemini",
        }
      ),
    };
  }

  if (!config.apiKey || config.apiKey.includes("your_") || config.apiKey === "present") {
    return {
      answer: cleanedDraftAnswer,
      trace: buildSkippedComposerTrace(
        "GEMINI_API_KEY is not configured with a usable key. Deterministic answer was used.",
        {
          enabled: true,
          model: config.model,
          provider: "gemini",
        }
      ),
    };
  }

  try {
    const prompt = buildComposerPrompt({
      question,
      draftAnswer: cleanedDraftAnswer,
      sqlQuery,
      rows,
      sources: cleanedSources,
      answerMode,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
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
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            topP: 0.8,
            maxOutputTokens: 700,
          },
        }),
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        answer: cleanedDraftAnswer,
        trace: {
          enabled: true,
          usedLlm: false,
          provider: "gemini" as const,
          model: config.model,
          status: "failed" as const,
          reason: `Gemini composer failed with status ${response.status}. Deterministic answer was used.`,
        },
      };
    }

    const data = (await response.json()) as GeminiResponse;

    const composedText =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    if (!composedText) {
      return {
        answer: cleanedDraftAnswer,
        trace: {
          enabled: true,
          usedLlm: false,
          provider: "gemini" as const,
          model: config.model,
          status: "failed" as const,
          reason:
            data.error?.message ||
            "Gemini returned no usable text. Deterministic answer was used.",
        },
      };
    }

    const finalComposedText = prepareDraftForMode({
      draftAnswer: composedText,
      answerMode,
    });

    const validation = validateComposedAnswer({
      draftAnswer: cleanedDraftAnswer,
      composedText: finalComposedText,
    });

    if (!validation.ok) {
      return {
        answer: cleanedDraftAnswer,
        trace: {
          enabled: true,
          usedLlm: false,
          provider: "gemini" as const,
          model: config.model,
          status: "rejected" as const,
          reason: validation.reason,
        },
      };
    }

    return {
      answer: finalComposedText,
      trace: {
        enabled: true,
        usedLlm: true,
        provider: "gemini" as const,
        model: config.model,
        status: "used" as const,
        reason:
          "Gemini rewrote the deterministic draft for readability while preserving citations and limitations.",
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown LLM composer error.";

    return {
      answer: cleanedDraftAnswer,
      trace: {
        enabled: true,
        usedLlm: false,
        provider: "gemini" as const,
        model: config.model,
        status: "failed" as const,
        reason: `${message}. Deterministic answer was used.`,
      },
    };
  }
}

export const composeFinalAnswer = composePharmaAnswer;
export const composeAnswerWithLlm = composePharmaAnswer;
export const maybeComposeAnswer = composePharmaAnswer;
export const runLlmComposer = composePharmaAnswer;

function buildComposerPrompt({
  question,
  draftAnswer,
  sqlQuery,
  rows,
  sources,
  answerMode,
}: ComposeAnswerInput & { answerMode: AnswerMode }) {
  const sourceSummaries = sources.map((source) => ({
    citationLabel: source.citationLabel,
    citationType: source.citationType,
    title: source.title,
    status: source.status,
    excerpt: source.excerpt,
  }));

  return `You are PharmaRev AI, a pharmaceutical intelligence assistant.

Task:
Rewrite the deterministic draft into a polished answer.

Answer mode:
${answerMode}

Hard rules:
- Do not add new facts.
- Do not add new numbers.
- Do not change dollar values, years, claims, beneficiaries, drug names, manufacturers, or percentages.
- Preserve citation labels exactly, including [SQL-1], [KB-1], [KB-2], and [LIMIT-1] when present.
- Preserve the data limitation.
- Never claim private revenue, profit, rebate-adjusted net revenue, CRM deals, sales-rep performance, or contract loss.
- Do not include raw source dumps or metadata strings.
- Do not repeat the same FDA label section twice.
- Use GitHub-flavored markdown.
- If a table is already present, keep it valid markdown.
- Do not use code fences for tables.
- Keep the answer concise.

Formatting rules:
- RAG_ONLY: one direct sentence + up to 2 concise evidence bullets + limitation.
- HYBRID_SQL_RAG: public-data section + FDA-label context section + limitation.
- Output only the final answer text.

User question:
${question}

SQL summary:
${sqlQuery}

SQL rows snapshot:
${JSON.stringify(rows.slice(0, 8), null, 2)}

Source summaries:
${JSON.stringify(sourceSummaries.slice(0, 5), null, 2)}

Draft answer:
${draftAnswer}`;
}

function detectAnswerMode({
  question,
  draftAnswer,
  sources,
}: {
  question: string;
  draftAnswer: string;
  sources: SourceEvidence[];
}): AnswerMode {
  const q = normalize(question);
  const draft = normalize(draftAnswer);

  const hasSqlEvidence = sources.some(
    (source) =>
      source.citationType === "sql" ||
      String(source.citationLabel || "").toUpperCase().startsWith("SQL")
  );

  const hasKbEvidence = sources.some(
    (source) =>
      source.citationType === "kb" ||
      String(source.citationLabel || "").toUpperCase().startsWith("KB")
  );

  const hasLimitOnly =
    !hasSqlEvidence &&
    !hasKbEvidence &&
    (draft.includes("could not match") ||
      draft.includes("cannot answer") ||
      draft.includes("data limitation") ||
      draft.includes("[limit-1]"));

  if (hasLimitOnly) return "LIMITATION";
  if (hasSqlEvidence && hasKbEvidence) return "HYBRID_SQL_RAG";
  if (hasKbEvidence && !hasSqlEvidence) return "RAG_ONLY";
  if (hasSqlEvidence) return "SQL_ONLY";

  const asksLabel =
    q.includes("fda") ||
    q.includes("label") ||
    q.includes("used for") ||
    q.includes("warnings") ||
    q.includes("adverse") ||
    q.includes("dosage") ||
    q.includes("contraindication");

  if (asksLabel) return "RAG_ONLY";

  return "LIMITATION";
}

function prepareDraftForMode({
  draftAnswer,
  answerMode,
}: {
  draftAnswer: string;
  answerMode: AnswerMode;
}) {
  let answer = draftAnswer.trim();

  if (answerMode === "SQL_ONLY") {
    answer = removeKnowledgeBaseDump(answer);
    answer = removeKbCitations(answer);
  }

  if (answerMode === "RAG_ONLY") {
    answer = removeSqlDump(answer);
    answer = collapseDuplicateBullets(answer);
  }

  if (answerMode === "LIMITATION") {
    answer = removeKnowledgeBaseDump(answer);
    answer = removeSqlDump(answer);
  }

  answer = simplifyCitationGroups(answer);
  answer = cleanRepeatedPunctuation(answer);
  answer = normalizeWhitespace(answer);

  return answer;
}

function filterSourcesForMode({
  answerMode,
  sources,
}: {
  answerMode: AnswerMode;
  sources: SourceEvidence[];
}) {
  if (answerMode === "HYBRID_SQL_RAG") return sources;

  if (answerMode === "RAG_ONLY") {
    return sources.filter(
      (source) =>
        source.citationType === "kb" ||
        source.citationType === "limit" ||
        String(source.citationLabel || "").toUpperCase().startsWith("KB") ||
        String(source.citationLabel || "").toUpperCase().startsWith("LIMIT")
    );
  }

  if (answerMode === "SQL_ONLY") {
    return sources.filter(
      (source) =>
        source.citationType === "sql" ||
        source.citationType === "limit" ||
        String(source.citationLabel || "").toUpperCase().startsWith("SQL") ||
        String(source.citationLabel || "").toUpperCase().startsWith("LIMIT")
    );
  }

  return sources.filter(
    (source) =>
      source.citationType === "limit" ||
      String(source.citationLabel || "").toUpperCase().startsWith("LIMIT")
  );
}

function removeKnowledgeBaseDump(answer: string) {
  const markers = [
    "Grounding note from the knowledge base:",
    "Knowledge base context:",
    "FDA label context:",
    "Label context:",
  ];

  let cleaned = answer;

  for (const marker of markers) {
    const markerIndex = cleaned.indexOf(marker);
    if (markerIndex < 0) continue;

    const beforeMarker = cleaned.slice(0, markerIndex).trim();
    const afterMarker = cleaned.slice(markerIndex);
    const dataLimitationIndex = afterMarker.indexOf("Data limitation:");
    const limitIndex = afterMarker.indexOf("[LIMIT-1]");

    if (dataLimitationIndex >= 0) {
      cleaned = `${beforeMarker}\n\n${afterMarker.slice(dataLimitationIndex).trim()}`;
    } else if (limitIndex >= 0) {
      const start = Math.max(0, afterMarker.lastIndexOf("\n", limitIndex));
      cleaned = `${beforeMarker}\n\n${afterMarker.slice(start).trim()}`;
    } else {
      cleaned = beforeMarker;
    }
  }

  return cleaned;
}

function removeSqlDump(answer: string) {
  const markers = ["SQL summary:", "SQL rows:", "SQL rows snapshot:"];
  let cleaned = answer;

  for (const marker of markers) {
    const markerIndex = cleaned.indexOf(marker);
    if (markerIndex < 0) continue;

    const beforeMarker = cleaned.slice(0, markerIndex).trim();
    const afterMarker = cleaned.slice(markerIndex);
    const dataLimitationIndex = afterMarker.indexOf("Data limitation:");

    if (dataLimitationIndex >= 0) {
      cleaned = `${beforeMarker}\n\n${afterMarker.slice(dataLimitationIndex).trim()}`;
    } else {
      cleaned = beforeMarker;
    }
  }

  return cleaned;
}

function removeKbCitations(answer: string) {
  return answer
    .replace(/\s*\[KB-\d+\]/gi, "")
    .replace(/\[SQL-1,\s*KB-\d+\]/gi, "[SQL-1]")
    .replace(/\[KB-\d+,\s*SQL-1\]/gi, "[SQL-1]");
}

function collapseDuplicateBullets(answer: string) {
  const seen = new Set<string>();
  const lines = answer.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const normalized = normalize(
      line
        .replace(/\[KB-\d+\]/gi, "")
        .replace(/^[-*]\s*/, "")
        .replace(/\*\*/g, "")
    );

    if ((line.trim().startsWith("-") || line.trim().startsWith("*")) && seen.has(normalized.slice(0, 110))) {
      continue;
    }

    if (line.trim().startsWith("-") || line.trim().startsWith("*")) {
      seen.add(normalized.slice(0, 110));
    }

    output.push(line);
  }

  return output.join("\n");
}

function simplifyCitationGroups(answer: string) {
  return answer
    .replace(/\[SQL-1,\s*SQL-2,\s*SQL-3\]/gi, "[SQL-1]")
    .replace(/\[SQL-1,\s*SQL-2\]/gi, "[SQL-1]")
    .replace(/\[LIMIT-1,\s*LIMIT-2\]/gi, "[LIMIT-1]");
}

function cleanRepeatedPunctuation(answer: string) {
  return answer
    .replace(/\.\./g, ".")
    .replace(/,\s*\./g, ".")
    .replace(/\s+\./g, ".")
    .replace(/\s+,/g, ",");
}

function normalizeWhitespace(answer: string) {
  return answer.replace(/\n{3,}/g, "\n\n").trim();
}

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function validateComposedAnswer({
  draftAnswer,
  composedText,
}: {
  draftAnswer: string;
  composedText: string;
}) {
  const requiredLabels = extractCitationLabels(draftAnswer);
  const composedLabels = extractCitationLabels(composedText);

  const missingLabels = requiredLabels.filter(
    (label) => !composedLabels.includes(label)
  );

  if (missingLabels.length > 0) {
    return {
      ok: false,
      reason: `LLM composer removed required citation labels: ${missingLabels.join(
        ", "
      )}. Deterministic answer was used.`,
    };
  }

  if (
    draftAnswer.toLowerCase().includes("[limit-1]") &&
    !composedText.toLowerCase().includes("[limit-1]")
  ) {
    return {
      ok: false,
      reason: "LLM composer removed [LIMIT-1]. Deterministic answer was used.",
    };
  }

  return {
    ok: true,
    reason: "Composed answer passed citation and limitation checks.",
  };
}

function extractCitationLabels(text: string) {
  const matches = Array.from(text.matchAll(/\[([^\]]+)\]/g));

  return Array.from(
    new Set(
      matches.flatMap((match) =>
        match[1]
          .split(",")
          .map((label) => label.trim())
          .filter((label) => /^(SQL|KB|LIMIT)-\d+$/i.test(label))
      )
    )
  );
}

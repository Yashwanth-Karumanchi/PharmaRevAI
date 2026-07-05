import { resolveDrugEntity, normalizePharmaText, containsAnyNormalized } from "./pharmaEntityResolver";

type ChatMessageLike = {
  role?: string;
  content?: string;
  metadata?: Record<string, unknown> | null;
};

export type ConversationResolution = {
  originalQuestion: string;
  resolvedQuestion: string;
  wasFollowUp: boolean;
  method: "none" | "deterministic_context_rewrite";
  reason: string;
  contextSource?: {
    previousUserQuestion?: string;
    previousAssistantRoute?: string;
    previousAssistantToolName?: string;
  };
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getMetadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function isWelcomeMessage(message: ChatMessageLike) {
  return (
    message.role === "assistant" &&
    clean(message.content).toLowerCase().startsWith("new chat started")
  );
}

function usableMessages(messages: ChatMessageLike[]) {
  return messages
    .filter((message) => !isWelcomeMessage(message))
    .filter((message) => clean(message.content));
}

function getPreviousUserQuestion({
  messages,
  currentQuestion,
}: {
  messages: ChatMessageLike[];
  currentQuestion: string;
}) {
  const normalizedCurrent = normalizePharmaText(currentQuestion);
  const userMessages = usableMessages(messages).filter((message) => message.role === "user");

  for (let index = userMessages.length - 1; index >= 0; index -= 1) {
    const content = clean(userMessages[index].content);

    if (!content) continue;

    if (normalizePharmaText(content) === normalizedCurrent) {
      continue;
    }

    return content;
  }

  return "";
}

function getPreviousAssistant(messages: ChatMessageLike[]) {
  const assistantMessages = usableMessages(messages).filter(
    (message) => message.role === "assistant"
  );

  return assistantMessages[assistantMessages.length - 1] || null;
}

function hasExplicitStandaloneIntent(question: string) {
  const text = normalizePharmaText(question);

  const explicitTerms = [
    "cms",
    "medicare",
    "part d",
    "spending",
    "spend",
    "spent",
    "trend",
    "trends",
    "cost",
    "costs",
    "prescriber",
    "provider",
    "specialty",
    "state",
    "open payments",
    "payment",
    "sales quantity",
    "fda",
    "label",
    "warning",
    "warnings",
    "used for",
    "adverse",
    "dosage",
    "contraindication",
  ];

  return explicitTerms.some((term) => text.includes(normalizePharmaText(term)));
}

function isOverallFollowUp(question: string) {
  const text = normalizePharmaText(question);
  return ["overall", "overall view", "overall trend", "overall trends", "overall summary"].includes(text);
}

function isWhatAboutFollowUp(question: string) {
  const text = normalizePharmaText(question);

  return (
    text.startsWith("what about ") ||
    text.startsWith("how about ") ||
    text.startsWith("same for ") ||
    text.startsWith("and ") ||
    text.startsWith("also ")
  );
}

function isShortFollowUp(question: string) {
  const text = normalizePharmaText(question);
  const words = text.split(" ").filter(Boolean);

  if (isOverallFollowUp(question) || isWhatAboutFollowUp(question)) return true;

  if (words.length <= 4 && Boolean(resolveDrugEntity(question))) return true;

  return false;
}

function previousTopic(previousUserQuestion: string, previousAssistant: ChatMessageLike | null) {
  const previousText = normalizePharmaText(previousUserQuestion);
  const route = getMetadataString(previousAssistant?.metadata, "route");
  const toolName =
    getMetadataString(previousAssistant?.metadata, "toolName") ||
    getMetadataString(previousAssistant?.metadata, "agent");

  if (
    containsAnyNormalized(previousText, ["prescriber", "provider", "where", "state", "city", "location", "specialty"]) ||
    toolName === "part_d_prescriber_agent"
  ) {
    return "prescriber";
  }

  if (
    containsAnyNormalized(previousText, ["open payments", "payment", "physician payment"]) ||
    toolName === "open_payments_agent"
  ) {
    return "open_payments";
  }

  if (
    containsAnyNormalized(previousText, ["sales quantity", "quantity sold", "atc", "units sold"]) ||
    toolName === "pharma_sales_agent"
  ) {
    return "pharma_sales";
  }

  if (
    containsAnyNormalized(previousText, ["fda", "label", "warning", "used for", "adverse", "dosage", "contraindication"]) ||
    route === "RAG_ONLY" ||
    toolName === "openfda_label_agent"
  ) {
    return "label";
  }

  if (
    containsAnyNormalized(previousText, ["spending", "spend", "spent", "cost", "trend", "trends", "top", "highest", "expensive", "medicare", "part d", "cms"]) ||
    toolName === "part_d_drug_trend_agent" ||
    toolName === "part_d_top_spending_agent" ||
    toolName === "part_d_spending_increase_agent"
  ) {
    return "spending";
  }

  return "unknown";
}

function stripFollowUpPrefix(question: string) {
  return clean(question)
    .replace(/^what about\s+/i, "")
    .replace(/^how about\s+/i, "")
    .replace(/^same for\s+/i, "")
    .replace(/^and\s+/i, "")
    .replace(/^also\s+/i, "")
    .replace(/[?]+$/g, "")
    .trim();
}

function rewriteWithTopic({
  question,
  topic,
}: {
  question: string;
  topic: string;
}) {
  const drug = resolveDrugEntity(question);
  const followUpSubject = stripFollowUpPrefix(question);
  const subject = drug?.canonical || followUpSubject;

  if (isOverallFollowUp(question)) {
    if (topic === "prescriber") {
      return "Show overall CMS Part D prescriber cost locations in 2024.";
    }

    if (topic === "open_payments") {
      return "Show overall CMS Open Payments totals from the loaded public data.";
    }

    if (topic === "pharma_sales") {
      return "Show overall public pharma sales quantity trends from the loaded data.";
    }

    if (topic === "label") {
      return "Ask me which drug you want FDA label context for, such as use, warnings, adverse reactions, dosage, or contraindications.";
    }

    return "Show overall CMS Medicare Part D spending trends in 2024.";
  }

  if (!subject) {
    return question;
  }

  if (topic === "prescriber") {
    return `For ${subject}, where were CMS Part D prescriber costs highest in 2024?`;
  }

  if (topic === "open_payments") {
    return `Show public CMS Open Payments information involving ${subject}.`;
  }

  if (topic === "pharma_sales") {
    return `Show public pharma sales quantity trends for ${subject}.`;
  }

  if (topic === "label") {
    return `What does the loaded FDA label evidence say about ${subject}?`;
  }

  if (topic === "spending") {
    return `Show CMS Medicare Part D spending trend for ${subject}.`;
  }

  return question;
}

export async function resolveConversationQuestion({
  question,
  messages,
}: {
  question: string;
  messages: ChatMessageLike[];
}): Promise<ConversationResolution> {
  const originalQuestion = clean(question);

  if (!originalQuestion) {
    return {
      originalQuestion,
      resolvedQuestion: originalQuestion,
      wasFollowUp: false,
      method: "none",
      reason: "Empty question.",
    };
  }

  if (hasExplicitStandaloneIntent(originalQuestion) && !isOverallFollowUp(originalQuestion)) {
    return {
      originalQuestion,
      resolvedQuestion: originalQuestion,
      wasFollowUp: false,
      method: "none",
      reason: "Question already contains an explicit standalone dataset or metric intent.",
    };
  }

  if (!isShortFollowUp(originalQuestion)) {
    return {
      originalQuestion,
      resolvedQuestion: originalQuestion,
      wasFollowUp: false,
      method: "none",
      reason: "Question is not a short follow-up.",
    };
  }

  const previousUserQuestion = getPreviousUserQuestion({
    messages,
    currentQuestion: originalQuestion,
  });
  const previousAssistant = getPreviousAssistant(messages);
  const topic = previousTopic(previousUserQuestion, previousAssistant);
  const resolvedQuestion = rewriteWithTopic({
    question: originalQuestion,
    topic,
  });

  if (normalizePharmaText(resolvedQuestion) === normalizePharmaText(originalQuestion)) {
    return {
      originalQuestion,
      resolvedQuestion: originalQuestion,
      wasFollowUp: false,
      method: "none",
      reason: "No useful previous topic was found for rewriting.",
      contextSource: {
        previousUserQuestion,
        previousAssistantRoute: getMetadataString(previousAssistant?.metadata, "route"),
        previousAssistantToolName:
          getMetadataString(previousAssistant?.metadata, "toolName") ||
          getMetadataString(previousAssistant?.metadata, "agent"),
      },
    };
  }

  return {
    originalQuestion,
    resolvedQuestion,
    wasFollowUp: true,
    method: "deterministic_context_rewrite",
    reason: `Short follow-up resolved using previous ${topic} topic.`,
    contextSource: {
      previousUserQuestion,
      previousAssistantRoute: getMetadataString(previousAssistant?.metadata, "route"),
      previousAssistantToolName:
        getMetadataString(previousAssistant?.metadata, "toolName") ||
        getMetadataString(previousAssistant?.metadata, "agent"),
    },
  };
}

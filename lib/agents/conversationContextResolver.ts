type ChatMessageLike = {
  id?: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

type ConversationContextResult = {
  resolvedQuestion: string;
  wasFollowUp: boolean;
  method: string;
  reason: string;
  contextSource?: {
    messageId?: string;
    role?: string;
    content?: string;
  };
};

type LlmFollowUpDecision = {
  isFollowUp: boolean;
  resolvedQuestion: string;
  reason: string;
  contextMessageIndex?: number | null;
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

function getModelName() {
  return (
    process.env.CONVERSATION_RESOLVER_MODEL ||
    process.env.LLM_PLANNER_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-3.1-flash-lite"
  );
}

function getGeminiKey() {
  const key = process.env.GEMINI_API_KEY;

  if (!key || !key.trim() || key.includes("your_")) {
    return null;
  }

  return key.trim();
}

function recentConversationForPrompt(messages: ChatMessageLike[]) {
  return messages
    .slice(-8)
    .map((message, index) => {
      const metadata = message.metadata || {};
      const resolvedQuestion =
        typeof metadata.resolvedQuestion === "string"
          ? metadata.resolvedQuestion
          : null;

      return {
        index,
        id: message.id ?? null,
        role: message.role,
        content: clean(message.content),
        resolvedQuestion,
      };
    })
    .filter((message) => message.content.length > 0);
}

function extractJson(text: string) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in resolver response.");
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

function parseLlmDecision(text: string): LlmFollowUpDecision | null {
  try {
    const json = JSON.parse(extractJson(text)) as Partial<LlmFollowUpDecision>;

    if (typeof json.isFollowUp !== "boolean") {
      return null;
    }

    const resolvedQuestion = clean(json.resolvedQuestion);
    const reason = clean(json.reason);

    if (!resolvedQuestion) {
      return null;
    }

    return {
      isFollowUp: json.isFollowUp,
      resolvedQuestion,
      reason: reason || "LLM semantic follow-up resolver decision.",
      contextMessageIndex:
        typeof json.contextMessageIndex === "number"
          ? json.contextMessageIndex
          : null,
    };
  } catch {
    return null;
  }
}

function buildPrompt({
  question,
  conversation,
}: {
  question: string;
  conversation: ReturnType<typeof recentConversationForPrompt>;
}) {
  return [
    "You are a conversation context resolver for PharmaRev AI.",
    "",
    "Your only job is to decide whether the current user question is a follow-up to the previous conversation.",
    "If it is a follow-up, rewrite it into a complete standalone question that preserves the user's intent.",
    "If it is not a follow-up, return the original question unchanged.",
    "",
    "Important rules:",
    "- Do not answer the question.",
    "- Do not add facts that are not in the conversation.",
    "- Do not invent drug names, years, datasets, or metrics.",
    "- If the user asks for a temporal continuation like trends, history, or over-time comparison, resolve it against the prior topic.",
    "- If the current question is standalone, mark isFollowUp as false.",
    "- Keep the resolved question concise and suitable for routing to SQL/RAG agents.",
    "",
    "Return only valid JSON with this exact shape:",
    JSON.stringify({
      isFollowUp: true,
      resolvedQuestion: "standalone resolved question here",
      reason: "short reason",
      contextMessageIndex: 0,
    }),
    "",
    "Recent conversation messages:",
    JSON.stringify(conversation, null, 2),
    "",
    "Current user question:",
    question,
  ].join("\n");
}

async function askGeminiFollowUpResolver({
  question,
  messages,
}: {
  question: string;
  messages: ChatMessageLike[];
}): Promise<LlmFollowUpDecision | null> {
  const apiKey = getGeminiKey();

  if (!apiKey) {
    return null;
  }

  const conversation = recentConversationForPrompt(messages);

  if (conversation.length === 0) {
    return null;
  }

  const model = getModelName();
  const prompt = buildPrompt({ question, conversation });

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
          maxOutputTokens: 300,
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

  return parseLlmDecision(text);
}

function fallbackNoLlmResolution(question: string): ConversationContextResult {
  return {
    resolvedQuestion: question,
    wasFollowUp: false,
    method: "no_llm_context_resolution",
    reason:
      "LLM context resolver was unavailable, so the question was treated as standalone.",
  };
}

function getContextSourceFromDecision({
  decision,
  messages,
}: {
  decision: LlmFollowUpDecision;
  messages: ChatMessageLike[];
}): ConversationContextResult["contextSource"] {
  if (
    typeof decision.contextMessageIndex !== "number" ||
    decision.contextMessageIndex < 0
  ) {
    return undefined;
  }

  const conversation = recentConversationForPrompt(messages);
  const selected = conversation[decision.contextMessageIndex];

  if (!selected) {
    return undefined;
  }

  return {
    messageId: selected.id ?? undefined,
    role: selected.role,
    content: selected.resolvedQuestion || selected.content,
  };
}

export async function resolveConversationQuestion({
  question,
  messages,
}: {
  question: string;
  messages: ChatMessageLike[];
}): Promise<ConversationContextResult> {
  const cleanedQuestion = clean(question);

  if (!cleanedQuestion) {
    return {
      resolvedQuestion: "",
      wasFollowUp: false,
      method: "empty_question",
      reason: "Question was empty.",
    };
  }

  if (!messages || messages.length === 0) {
    return {
      resolvedQuestion: cleanedQuestion,
      wasFollowUp: false,
      method: "no_context",
      reason: "No previous conversation was available.",
    };
  }

  try {
    const decision = await askGeminiFollowUpResolver({
      question: cleanedQuestion,
      messages,
    });

    if (!decision) {
      return fallbackNoLlmResolution(cleanedQuestion);
    }

    return {
      resolvedQuestion: decision.resolvedQuestion,
      wasFollowUp: decision.isFollowUp,
      method: decision.isFollowUp
        ? "llm_semantic_followup_resolution"
        : "llm_semantic_standalone_resolution",
      reason: decision.reason,
      contextSource: decision.isFollowUp
        ? getContextSourceFromDecision({ decision, messages })
        : undefined,
    };
  } catch {
    return fallbackNoLlmResolution(cleanedQuestion);
  }
}

export default resolveConversationQuestion;
type ConversationalResponse = {
  answer: string;
  metadata: Record<string, unknown>;
};

type ConversationIntent =
  | "greeting"
  | "thanks"
  | "capability"
  | "reset"
  | "smalltalk"
  | "none";

const greetingTerms = new Set([
  "hi",
  "hello",
  "hey",
  "yo",
  "sup",
  "hola",
  "namaste",
  "gm",
  "gn",
  "morning",
  "evening",
]);

const casualAddressTerms = new Set([
  "bro",
  "boss",
  "man",
  "dude",
  "buddy",
  "mate",
  "sir",
  "dear",
]);

const thanksTerms = new Set([
  "thanks",
  "thank",
  "ty",
  "thx",
  "appreciate",
]);

const capabilityTerms = new Set([
  "help",
  "can",
  "do",
  "capabilities",
  "examples",
  "questions",
  "ask",
  "support",
  "datasets",
]);

const resetTerms = new Set([
  "reset",
  "clear",
  "restart",
  "new",
  "fresh",
]);

const pharmaDomainTerms = new Set([
  "drug",
  "drugs",
  "spending",
  "medicare",
  "part",
  "prescriber",
  "prescribers",
  "payments",
  "payment",
  "open",
  "fda",
  "label",
  "labels",
  "warning",
  "warnings",
  "indication",
  "indications",
  "sales",
  "trend",
  "trends",
  "cost",
  "costs",
  "manufacturer",
  "manufacturers",
  "brand",
  "generic",
  "eliquis",
  "humira",
  "keytruda",
  "ozempic",
  "trulicity",
  "januvia",
  "farxiga",
  "jardiance",
  "dupixent",
  "stelara",
  "ibrance",
]);

const analyticalTerms = new Set([
  "which",
  "what",
  "where",
  "when",
  "why",
  "how",
  "show",
  "list",
  "rank",
  "compare",
  "summarize",
  "highest",
  "lowest",
  "top",
  "increase",
  "decrease",
  "average",
  "total",
  "count",
  "find",
  "tell",
]);

function tokenize(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasAny(tokens: string[], terms: Set<string>) {
  return tokens.some((token) => terms.has(token));
}

function hasDomainOrAnalysisIntent(tokens: string[], original: string) {
  const hasQuestionMark = original.includes("?");
  const hasDomainTerm = hasAny(tokens, pharmaDomainTerms);
  const hasAnalyticalTerm = hasAny(tokens, analyticalTerms);

  return hasDomainTerm || (hasQuestionMark && hasAnalyticalTerm);
}

function classifyConversationalIntent(question: string): ConversationIntent {
  const trimmed = question.trim();

  if (!trimmed) {
    return "none";
  }

  const tokens = tokenize(trimmed);

  if (tokens.length === 0) {
    return "none";
  }

  const meaningfulTokens = tokens.filter(
    (token) => !casualAddressTerms.has(token)
  );

  const hasGreeting = hasAny(tokens, greetingTerms);
  const hasThanks = hasAny(tokens, thanksTerms);
  const hasCapability = hasAny(tokens, capabilityTerms);
  const hasReset = hasAny(tokens, resetTerms);
  const hasDomainIntent = hasDomainOrAnalysisIntent(tokens, trimmed);

  if (hasDomainIntent) {
    return "none";
  }

  if (hasGreeting && meaningfulTokens.length <= 3) {
    return "greeting";
  }

  if (hasThanks && meaningfulTokens.length <= 5) {
    return "thanks";
  }

  if (hasReset && meaningfulTokens.length <= 5) {
    return "reset";
  }

  const asksAboutAssistant =
    tokens.includes("you") ||
    tokens.includes("your") ||
    tokens.includes("this") ||
    tokens.includes("app") ||
    tokens.includes("pharmarev");

  if (hasCapability && asksAboutAssistant && tokens.length <= 12) {
    return "capability";
  }

  const casualOnly =
    tokens.length <= 4 &&
    tokens.every(
      (token) =>
        greetingTerms.has(token) ||
        casualAddressTerms.has(token) ||
        thanksTerms.has(token)
    );

  if (casualOnly) {
    return hasThanks ? "thanks" : "greeting";
  }

  return "none";
}

function buildMetadata(intent: ConversationIntent) {
  return {
    conversational: true,
    intent,
    answerMode: "conversational",
    route: "CONVERSATIONAL",
    toolName: "conversational_assistant",
    sources: [],
    rows: [],
    sqlQuery: null,
    composer: {
      enabled: false,
      used: false,
      reason: "Conversational responses do not need SQL/RAG composition.",
    },
    verification: {
      status: "not_required",
      reason: "No public-data claim was made.",
    },
  };
}

function greetingAnswer() {
  return [
    "Hey — I’m ready.",
    "",
    "Ask me about Medicare Part D spending, prescriber costs, Open Payments, public sales trends, or FDA label evidence.",
  ].join("\n");
}

function thanksAnswer() {
  return "You got it. Send the next pharma question whenever you’re ready.";
}

function resetAnswer() {
  return "Fresh start. Ask a new public pharma data question and I’ll route it to the right evidence path.";
}

function capabilityAnswer() {
  return [
    "I can help analyze public pharma evidence across:",
    "",
    "- Medicare Part D spending and drug rankings",
    "- Part D prescriber cost patterns",
    "- Open Payments records",
    "- public pharma sales trend data",
    "- FDA label indications, warnings, and label context",
    "",
    "I’ll also show citations, query details, process trace, and answer flow when evidence is available.",
  ].join("\n");
}

export async function maybeAnswerConversationally({
  question,
}: {
  question: string;
}): Promise<ConversationalResponse | null> {
  const intent = classifyConversationalIntent(question);

  if (intent === "none") {
    return null;
  }

  if (intent === "greeting") {
    return {
      answer: greetingAnswer(),
      metadata: buildMetadata(intent),
    };
  }

  if (intent === "thanks") {
    return {
      answer: thanksAnswer(),
      metadata: buildMetadata(intent),
    };
  }

  if (intent === "reset") {
    return {
      answer: resetAnswer(),
      metadata: buildMetadata(intent),
    };
  }

  if (intent === "capability") {
    return {
      answer: capabilityAnswer(),
      metadata: buildMetadata(intent),
    };
  }

  return null;
}

type ConversationalResult = {
  answer: string;
  metadata: Record<string, unknown>;
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

function isGreeting(text: string) {
  return /^(hi|hello|hey|yo|sup|gm|good morning|good afternoon|good evening)\??$/.test(
    text
  );
}

function isThanks(text: string) {
  return /^(thanks|thank you|thx|ty|cool thanks|got it|okay thanks)\.?$/.test(
    text
  );
}

function isHelpQuestion(text: string) {
  return (
    text.includes("what can you do") ||
    text.includes("how can you help") ||
    text.includes("help me") ||
    text === "help" ||
    text.includes("what should i ask")
  );
}

function isPureConversation(question: string) {
  const text = normalize(question);

  if (!text) return false;

  return isGreeting(text) || isThanks(text) || isHelpQuestion(text);
}

function fallbackConversationalAnswer(question: string) {
  const text = normalize(question);

  if (isGreeting(text)) {
    return "Hey — I can help with public pharma intelligence questions across Medicare Part D spending, prescriber costs, Open Payments, public sales trends, and FDA label evidence.";
  }

  if (isThanks(text)) {
    return "You got it. Ask me another PharmaRev question whenever you are ready.";
  }

  return [
    "I can help you explore available public pharma evidence.",
    "",
    "Try questions like:",
    "- Which drugs had the highest Medicare Part D spending in 2024?",
    "- Show the overall Medicare Part D spending overview for 2024.",
    "- For Humira, where were prescriber costs highest?",
    "- Which companies made the highest Open Payments in 2024?",
    "- Which pharma sales categories had the highest quantity sold?",
    "- What is Eliquis used for according to the FDA label?",
    "- For Keytruda, show spending trend and FDA warnings.",
  ].join("\n");
}

export async function maybeAnswerConversationally({
  question,
}: {
  question: string;
}): Promise<ConversationalResult | null> {
  if (!isPureConversation(question)) {
    return null;
  }

  return {
    answer: fallbackConversationalAnswer(question),
    metadata: {
      route: "CONVERSATIONAL",
      intent: "conversational_help_or_greeting",
      agent: "conversational_assistant",
      toolName: "conversational_assistant",
      originalQuestion: question,
      sources: [],
      rows: [],
      sqlQuery: "",
      conversational: true,
    },
  };
}

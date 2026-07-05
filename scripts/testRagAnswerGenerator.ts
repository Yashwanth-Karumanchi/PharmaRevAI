import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type TestCase = {
  question: string;
  shouldHaveKbCitation: boolean;
  shouldHaveLimitCitation: boolean;
};

const defaultTests: TestCase[] = [
  {
    question: "What is Anoro Ellipta used for?",
    shouldHaveKbCitation: true,
    shouldHaveLimitCitation: true,
  },
  {
    question: "What warnings does the FDA label mention for Anoro Ellipta?",
    shouldHaveKbCitation: true,
    shouldHaveLimitCitation: true,
  },
  {
    question: "What adverse reactions are listed for Anoro Ellipta?",
    shouldHaveKbCitation: true,
    shouldHaveLimitCitation: true,
  },
  {
    question: "What is unknown drug ZZZ123 used for?",
    shouldHaveKbCitation: false,
    shouldHaveLimitCitation: true,
  },
];

function hasKbCitation(answer: string) {
  return /\[KB-\d+\]/.test(answer);
}

function hasLimitCitation(answer: string) {
  return /\[LIMIT-\d+\]/.test(answer);
}

async function getAgent() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing after loading .env.local. Check .env.local in the project root."
    );
  }

  const module = await import("../lib/agents/fdaLabelAgent");
  return module.answerFdaLabelQuestion;
}

async function runSingleQuestion(question: string) {
  const answerFdaLabelQuestion = await getAgent();
  const result = await answerFdaLabelQuestion(question);

  console.log("");
  console.log("Question:");
  console.log(question);
  console.log("");
  console.log("Answer:");
  console.log(result.answer);
  console.log("");
  console.log("RAG generation:");
  console.log(result.composer);
  console.log("");
  console.log("Verification:");
  console.log(result.verification);
  console.log("");
  console.log("Sources:");
  console.log(
    result.sources.map((source) => ({
      label: source.citationLabel,
      type: source.citationType,
      title: source.title,
      score: source.score,
    }))
  );
}

async function runDefaultTests() {
  const answerFdaLabelQuestion = await getAgent();

  console.log("Starting strict RAG answer generator tests...");
  console.log({
    DATABASE_URL_LOADED: Boolean(process.env.DATABASE_URL),
    GEMINI_API_KEY_LOADED: Boolean(process.env.GEMINI_API_KEY),
    RAG_GENERATOR_ENABLED: process.env.RAG_GENERATOR_ENABLED,
    RAG_GENERATOR_MODEL: process.env.RAG_GENERATOR_MODEL,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
    LOCAL_EMBEDDING_MODEL: process.env.LOCAL_EMBEDDING_MODEL,
  });

  let passed = 0;

  for (const test of defaultTests) {
    const result = await answerFdaLabelQuestion(test.question);

    const kbOk = test.shouldHaveKbCitation
      ? hasKbCitation(result.answer)
      : true;

    const limitOk = test.shouldHaveLimitCitation
      ? hasLimitCitation(result.answer)
      : true;

    const didPass = kbOk && limitOk;

    if (didPass) {
      passed += 1;
    }

    console.log("");
    console.log(didPass ? "PASS" : "FAIL");
    console.log({
      question: test.question,
      hasKbCitation: hasKbCitation(result.answer),
      hasLimitCitation: hasLimitCitation(result.answer),
      expectedKbCitation: test.shouldHaveKbCitation,
      expectedLimitCitation: test.shouldHaveLimitCitation,
      generatorStatus: result.composer?.status,
      generatorUsedLlm: result.composer?.usedLlm,
      verificationStatus: result.verification?.status,
      sourceCount: result.sources.length,
      retrievalMode: result.entities.retrievalMode,
    });

    console.log("Answer preview:");
    console.log(result.answer.slice(0, 600));
  }

  const total = defaultTests.length;
  const accuracy = Number(((passed / total) * 100).toFixed(2));

  console.log("");
  console.log("Strict RAG generator test summary:");
  console.log({
    passed,
    total,
    accuracy: `${accuracy}%`,
  });

  if (accuracy < 100) {
    console.log("");
    console.log("Fix failed RAG generator cases before moving to the next milestone.");
  }
}

async function main() {
  const customQuestion = process.argv.slice(2).join(" ").trim();

  if (customQuestion) {
    await runSingleQuestion(customQuestion);
    return;
  }

  await runDefaultTests();
}

main().catch((error) => {
  console.error("Strict RAG generator test failed:", error);
  process.exit(1);
});
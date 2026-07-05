import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type SafeToolName =
  | "part_d_top_spending_agent"
  | "part_d_spending_increase_agent"
  | "part_d_drug_trend_agent"
  | "part_d_prescriber_agent"
  | "open_payments_agent"
  | "pharma_sales_agent"
  | "openfda_label_agent"
  | "data_limitation_agent"
  | "unsupported_agent";

type RegistryTestCase = {
  question: string;
  expectedExecutedToolName: SafeToolName;
};

const defaultTests: RegistryTestCase[] = [
  {
    question: "What is Anoro Ellipta used for?",
    expectedExecutedToolName: "openfda_label_agent",
  },
  {
    question: "Which drugs had the highest Medicare Part D spending in 2024?",
    expectedExecutedToolName: "part_d_top_spending_agent",
  },
  {
    question: "Which drugs had the biggest Medicare Part D spending increase?",
    expectedExecutedToolName: "part_d_spending_increase_agent",
  },
  {
    question: "Show Medicare Part D spending trend for Anoro Ellipta.",
    expectedExecutedToolName: "part_d_drug_trend_agent",
  },
  {
    question: "Which providers had the highest total drug cost for Anoro Ellipta?",
    expectedExecutedToolName: "part_d_prescriber_agent",
  },
  {
    question: "Which companies made the highest Open Payments?",
    expectedExecutedToolName: "open_payments_agent",
  },
  {
    question: "Which product categories had the highest sales quantity?",
    expectedExecutedToolName: "pharma_sales_agent",
  },
  {
    question: "Which sales rep lost the most revenue?",
    expectedExecutedToolName: "data_limitation_agent",
  },
  {
    question: "Use Open Payments to prove which doctor caused our sales increase.",
    expectedExecutedToolName: "data_limitation_agent",
  },
  {
    question: "Estimate private profit margin from Medicare Part D spending.",
    expectedExecutedToolName: "data_limitation_agent",
  },
];

async function getRuntime() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing after loading .env.local. Check .env.local in the project root."
    );
  }

  const routerModule = await import("../lib/agents/queryRouter");
  const registryModule = await import("../lib/agents/safeToolRegistry");

  return {
    routeQuestion: routerModule.routeQuestion,
    executeRegisteredTool: registryModule.executeRegisteredTool,
  };
}

async function runSingleQuestion(question: string) {
  const { routeQuestion, executeRegisteredTool } = await getRuntime();

  const router = await routeQuestion(question);
  const result = await executeRegisteredTool({
    toolName: router.toolName,
    question,
    extractedEntities: router.extractedEntities,
    router,
  });

  console.log("");
  console.log("Question:");
  console.log(question);

  console.log("");
  console.log("Planner:");
  console.log({
    selectedToolName: router.toolName,
    route: router.route,
    intent: router.intent,
    confidence: router.confidence,
    plannerStatus: router.planner.status,
    plannerUsedLlm: router.planner.usedLlm,
    safetyOverrideApplied: router.planner.safetyOverrideApplied,
  });

  console.log("");
  console.log("Registry:");
  console.log(result.registry);

  console.log("");
  console.log("Verification:");
  console.log(result.verification);

  console.log("");
  console.log("Answer preview:");
  console.log(result.answer.slice(0, 1000));
}

async function runDefaultTests() {
  const { routeQuestion, executeRegisteredTool } = await getRuntime();

  console.log("Starting Safe Tool Registry v2 tests...");
  console.log({
    DATABASE_URL_LOADED: Boolean(process.env.DATABASE_URL),
    GEMINI_API_KEY_LOADED: Boolean(process.env.GEMINI_API_KEY),
    LLM_PLANNER_ENABLED: process.env.LLM_PLANNER_ENABLED,
    RAG_GENERATOR_ENABLED: process.env.RAG_GENERATOR_ENABLED,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
  });

  let passed = 0;

  for (const test of defaultTests) {
    const router = await routeQuestion(test.question);
    const result = await executeRegisteredTool({
      toolName: router.toolName,
      question: test.question,
      extractedEntities: router.extractedEntities,
      router,
    });

    const actualExecutedToolName = result.registry.executedToolName;
    const didPass = actualExecutedToolName === test.expectedExecutedToolName;

    if (didPass) {
      passed += 1;
    }

    console.log("");
    console.log(didPass ? "PASS" : "FAIL");
    console.log({
      question: test.question,
      expectedExecutedToolName: test.expectedExecutedToolName,
      plannerSelectedToolName: router.toolName,
      actualExecutedToolName,
      registryStatus: result.registry.status,
      registryReason: result.registry.reason,
      verificationStatus: result.verification?.status,
      sourceCount: result.sources.length,
      rowCount: result.rows.length,
    });

    const failedChecks = result.registry.validationChecks.filter(
      (check) => check.status === "fail"
    );

    if (failedChecks.length > 0) {
      console.log("Failed registry checks:");
      console.log(failedChecks);
    }
  }

  const total = defaultTests.length;
  const accuracy = Number(((passed / total) * 100).toFixed(2));

  console.log("");
  console.log("Safe Tool Registry v2 test summary:");
  console.log({
    passed,
    total,
    accuracy: `${accuracy}%`,
  });

  if (accuracy < 100) {
    console.log("");
    console.log(
      "Fix failed registry cases before moving to the evaluation milestone."
    );
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
  console.error("Registry test failed:", error);
  process.exit(1);
});
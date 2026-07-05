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

type PlannerTestCase = {
  question: string;
  expectedToolName: SafeToolName;
};

const defaultTests: PlannerTestCase[] = [
  {
    question: "What is Anoro Ellipta used for?",
    expectedToolName: "openfda_label_agent",
  },
  {
    question: "What warnings does the FDA label mention for Anoro Ellipta?",
    expectedToolName: "openfda_label_agent",
  },
  {
    question: "Which drugs had the highest Medicare Part D spending in 2024?",
    expectedToolName: "part_d_top_spending_agent",
  },
  {
    question: "Which drugs had the biggest Medicare Part D spending increase?",
    expectedToolName: "part_d_spending_increase_agent",
  },
  {
    question: "Show Medicare Part D spending trend for Anoro Ellipta.",
    expectedToolName: "part_d_drug_trend_agent",
  },
  {
    question: "Which providers had the highest total drug cost for Anoro Ellipta?",
    expectedToolName: "part_d_prescriber_agent",
  },
  {
    question: "Which states had the highest drug cost for Anoro Ellipta?",
    expectedToolName: "part_d_prescriber_agent",
  },
  {
    question: "Which companies made the highest Open Payments?",
    expectedToolName: "open_payments_agent",
  },
  {
    question: "Which physician specialties received the most Open Payments?",
    expectedToolName: "open_payments_agent",
  },
  {
    question: "Which product categories had the highest sales quantity?",
    expectedToolName: "pharma_sales_agent",
  },
  {
    question: "Forecast next month sales quantity for M01AB.",
    expectedToolName: "pharma_sales_agent",
  },
  {
    question: "Which sales rep lost the most revenue?",
    expectedToolName: "data_limitation_agent",
  },
  {
    question: "Estimate our private profit margin from Medicare spending.",
    expectedToolName: "data_limitation_agent",
  },
];

async function getRouter() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is still missing after loading .env.local. Check that .env.local exists in the project root and contains DATABASE_URL."
    );
  }

  const module = await import("../lib/agents/queryRouter");
  return module.routeQuestion;
}

async function runSingleQuestion(question: string) {
  const routeQuestion = await getRouter();
  const result = await routeQuestion(question);

  console.log("");
  console.log("Question:");
  console.log(question);
  console.log("");
  console.log("Planner result:");
  console.log({
    toolName: result.toolName,
    route: result.route,
    intent: result.intent,
    confidence: result.confidence,
    reason: result.reason,
    plannerStatus: result.planner.status,
    plannerUsedLlm: result.planner.usedLlm,
    plannerModel: result.planner.model,
    safetyOverrideApplied: result.planner.safetyOverrideApplied,
    deterministicFallbackTool: result.planner.deterministicFallback.toolName,
  });
}

async function runDefaultTests() {
  const routeQuestion = await getRouter();

  console.log("Starting LLM planner tests...");
  console.log({
    DATABASE_URL_LOADED: Boolean(process.env.DATABASE_URL),
    GEMINI_API_KEY_LOADED: Boolean(process.env.GEMINI_API_KEY),
    LLM_PLANNER_ENABLED: process.env.LLM_PLANNER_ENABLED,
    LLM_PLANNER_MODEL: process.env.LLM_PLANNER_MODEL,
  });

  let passed = 0;

  for (const test of defaultTests) {
    const result = await routeQuestion(test.question);
    const didPass = result.toolName === test.expectedToolName;

    if (didPass) {
      passed += 1;
    }

    console.log("");
    console.log(didPass ? "PASS" : "FAIL");
    console.log({
      question: test.question,
      expectedToolName: test.expectedToolName,
      actualToolName: result.toolName,
      route: result.route,
      intent: result.intent,
      confidence: result.confidence,
      plannerStatus: result.planner.status,
      plannerUsedLlm: result.planner.usedLlm,
      plannerModel: result.planner.model,
      safetyOverrideApplied: result.planner.safetyOverrideApplied,
      reason: result.reason,
    });
  }

  const total = defaultTests.length;
  const accuracy = Number(((passed / total) * 100).toFixed(2));

  console.log("");
  console.log("Planner test summary:");
  console.log({
    passed,
    total,
    accuracy: `${accuracy}%`,
  });

  if (accuracy < 90) {
    console.log("");
    console.log(
      "Planner accuracy is below 90%. Check failed cases before moving to the next milestone."
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
  console.error("Planner test failed:", error);
  process.exit(1);
});
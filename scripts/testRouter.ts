import dotenv from "dotenv";
import { routeQuestion } from "../lib/agents/queryRouter";

dotenv.config({ path: ".env.local" });

const defaultQuestions = [
  "What is Anoro Ellipta used for?",
  "Which drugs had the highest Medicare Part D spending in 2024?",
  "Which drugs had the biggest Medicare Part D spending increase?",
  "Show Medicare Part D spending trend for Anoro Ellipta.",
  "Which providers had the highest total drug cost for Anoro Ellipta?",
  "Which states had the highest drug cost for Anoro Ellipta?",
  "Which companies made the highest Open Payments?",
  "Which physician specialties received the most Open Payments?",
  "Which product categories had the highest sales quantity?",
  "Forecast next month sales quantity for M01AB.",
  "Which sales rep lost the most revenue?",
];

async function main() {
  const questionFromCli = process.argv.slice(2).join(" ").trim();
  const questions = questionFromCli ? [questionFromCli] : defaultQuestions;

  for (const question of questions) {
    const route = await routeQuestion(question);

    console.log("");
    console.log("=".repeat(90));
    console.log(question);
    console.log("-".repeat(90));
    console.log({
      route: route.route,
      intent: route.intent,
      confidence: route.confidence,
      agent: route.agent,
      toolName: route.toolName,
      needsSql: route.needsSql,
      needsRag: route.needsRag,
      reason: route.reason,
      matchedTerms: route.matchedTerms,
      years: route.extractedEntities.years,
      sourceHints: route.extractedEntities.sourceHints,
      analysisHints: route.extractedEntities.analysisHints,
      drugMentions: route.extractedEntities.drugMentions,
      categoryMentions: route.extractedEntities.categoryMentions,
      geographyMentions: route.extractedEntities.geographyMentions,
      privateDataSignals: route.extractedEntities.privateDataSignals,
    });
  }
}

main().catch((error) => {
  console.error("Router test failed:", error);
  process.exit(1);
});
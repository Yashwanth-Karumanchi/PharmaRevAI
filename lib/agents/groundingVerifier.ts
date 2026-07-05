import type { SourceEvidence } from "@/types/evidence";

export type GroundingVerificationStatus = "pass" | "warning" | "fail";

export type GroundingVerification = {
  status: GroundingVerificationStatus;
  confidence: "High" | "Medium" | "Low";
  score: number;
  reasons: string[];
  checks: {
    hasSources: boolean;
    hasCitations: boolean;
    hasLimitation: boolean;
    hasSqlRows: boolean;
    needsSql: boolean;
    needsRag: boolean;
    hasRagSources: boolean;
    hasPrivateDataRisk: boolean;
  };
};

function hasCitationLabel(text: string, label: string) {
  return text.includes(`[${label}]`);
}

function hasPrivateDataRisk(answer: string) {
  const normalized = answer.toLowerCase();

  const riskyTerms = [
    "private revenue",
    "profit",
    "deal loss",
    "sales rep",
    "crm",
    "rebate-adjusted",
    "contract discount",
    "margin leakage",
  ];

  const hasRiskyTerm = riskyTerms.some((term) => normalized.includes(term));
  const hasLimitingLanguage =
    normalized.includes("does not prove") ||
    normalized.includes("cannot determine") ||
    normalized.includes("not private") ||
    normalized.includes("not prove");

  return hasRiskyTerm && !hasLimitingLanguage;
}

export function verifyGroundedAnswer({
  answer,
  sources,
  rows,
  needsSql,
  needsRag,
}: {
  answer: string;
  sources: SourceEvidence[];
  rows: unknown[];
  needsSql: boolean;
  needsRag: boolean;
}): GroundingVerification {
  const usedSources = sources.filter((source) => source.status === "used");
  const citationLabels = usedSources
    .map((source) => source.citationLabel)
    .filter((label): label is string => Boolean(label));

  const hasSources = usedSources.length > 0;
  const hasCitations =
    citationLabels.length > 0 &&
    citationLabels.some((label) => hasCitationLabel(answer, label));

  const hasLimitation =
    answer.toLowerCase().includes("data limitation") ||
    answer.toLowerCase().includes("limitation") ||
    sources.some((source) => source.citationType === "limit");

  const hasSqlRows = rows.length > 0;
  const hasRagSources = usedSources.some(
    (source) => source.citationType === "kb"
  );

  const privateDataRisk = hasPrivateDataRisk(answer);

  let score = 100;
  const reasons: string[] = [];

  if (!hasSources) {
    score -= 25;
    reasons.push("No used sources were attached.");
  } else {
    reasons.push(`${usedSources.length} used source(s) attached.`);
  }

  if (!hasCitations) {
    score -= 20;
    reasons.push("Answer does not visibly cite attached source labels.");
  } else {
    reasons.push("Answer includes visible citation labels.");
  }

  if (needsSql && !hasSqlRows) {
    score -= 25;
    reasons.push("Question needed SQL, but no SQL rows were attached.");
  }

  if (needsRag && !hasRagSources) {
    score -= 20;
    reasons.push("Question needed RAG, but no KB/RAG source was attached.");
  }

  if (!hasLimitation) {
    score -= 15;
    reasons.push("No limitation was included.");
  } else {
    reasons.push("Limitation is present.");
  }

  if (privateDataRisk) {
    score -= 40;
    reasons.push("Answer may imply unsupported private/internal data.");
  }

  const boundedScore = Math.max(0, Math.min(100, score));

  const status: GroundingVerificationStatus =
    boundedScore >= 80 ? "pass" : boundedScore >= 55 ? "warning" : "fail";

  const confidence =
    boundedScore >= 80 ? "High" : boundedScore >= 55 ? "Medium" : "Low";

  return {
    status,
    confidence,
    score: boundedScore,
    reasons,
    checks: {
      hasSources,
      hasCitations,
      hasLimitation,
      hasSqlRows,
      needsSql,
      needsRag,
      hasRagSources,
      hasPrivateDataRisk: privateDataRisk,
    },
  };
}
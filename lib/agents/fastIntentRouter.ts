export type FastIntentRoute = {
  toolName:
    | "part_d_top_spending_agent"
    | "part_d_spending_increase_agent"
    | "part_d_drug_trend_agent"
    | "part_d_prescriber_agent"
    | "open_payments_agent"
    | "pharma_sales_agent"
    | "openfda_label_agent"
    | "data_limitation_agent"
    | "unsupported_agent";
  route:
    | "SQL_ONLY"
    | "RAG_ONLY"
    | "HYBRID_SQL_RAG"
    | "DATA_LIMITATION"
    | "UNSUPPORTED";
  intent: string;
  confidence: "High" | "Medium" | "Low";
  extractedEntities: Record<string, unknown>;
  planner: {
    status: "fast_route" | "llm_semantic_route" | "fallback_route";
    usedLlm: boolean;
    reason: string;
  };
};

type DrugAlias = {
  canonical: string;
  aliases: string[];
};

const defaultTargetDrugs =
  "Anoro Ellipta,Adempas,Arexvy,Trelegy Ellipta,Breo Ellipta,Advair Diskus,Spiriva,Symbicort,Eliquis,Januvia,Ozempic,Trulicity,Humira,Stelara,Dupixent,Keytruda,Ibrance,Farxiga,Jardiance";

const manualAliases: DrugAlias[] = [
  { canonical: "Anoro Ellipta", aliases: ["anoro", "anoro ellipta"] },
  { canonical: "Trelegy Ellipta", aliases: ["trelegy", "trelegy ellipta"] },
  { canonical: "Breo Ellipta", aliases: ["breo", "breo ellipta"] },
  { canonical: "Advair Diskus", aliases: ["advair", "advair diskus"] },
  { canonical: "Spiriva", aliases: ["spiriva"] },
  { canonical: "Symbicort", aliases: ["symbicort"] },
  { canonical: "Adempas", aliases: ["adempas", "riociguat"] },
  { canonical: "Arexvy", aliases: ["arexvy"] },
  { canonical: "Eliquis", aliases: ["eliquis", "apixaban"] },
  { canonical: "Januvia", aliases: ["januvia", "sitagliptin"] },
  { canonical: "Ozempic", aliases: ["ozempic", "semaglutide"] },
  { canonical: "Trulicity", aliases: ["trulicity", "dulaglutide"] },
  { canonical: "Humira", aliases: ["humira", "adalimumab", "humira cf", "humira cf pen"] },
  { canonical: "Stelara", aliases: ["stelara", "ustekinumab"] },
  { canonical: "Dupixent", aliases: ["dupixent", "dupilumab"] },
  { canonical: "Keytruda", aliases: ["keytruda", "pembrolizumab", "keytruda qlex"] },
  { canonical: "Ibrance", aliases: ["ibrance", "palbociclib"] },
  { canonical: "Farxiga", aliases: ["farxiga", "dapagliflozin"] },
  { canonical: "Jardiance", aliases: ["jardiance", "empagliflozin"] },
];

const envTargetDrugs = (process.env.OPENFDA_TARGET_DRUGS || defaultTargetDrugs)
  .split(",")
  .map((drug) => drug.trim())
  .filter(Boolean);

const drugAliases = buildDrugAliases();

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

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(normalize(term)));
}

function buildDrugAliases() {
  const byCanonical = new Map<string, Set<string>>();

  for (const drug of envTargetDrugs) {
    const canonical = clean(drug);
    const aliases = byCanonical.get(canonical) || new Set<string>();
    aliases.add(canonical);

    const first = normalize(canonical).split(" ")[0];

    if (first.length >= 4) {
      aliases.add(first);
    }

    byCanonical.set(canonical, aliases);
  }

  for (const item of manualAliases) {
    const aliases = byCanonical.get(item.canonical) || new Set<string>();

    for (const alias of item.aliases) {
      aliases.add(alias);
    }

    byCanonical.set(item.canonical, aliases);
  }

  return Array.from(byCanonical.entries()).map(([canonical, aliases]) => ({
    canonical,
    aliases: Array.from(aliases).map(normalize).filter(Boolean),
  }));
}

function findTargetDrug(question: string) {
  const text = normalize(question);

  for (const drug of drugAliases) {
    if (drug.aliases.some((alias) => text.includes(alias))) {
      return drug.canonical;
    }
  }

  return "";
}

function looksLikePrivate(question: string) {
  const text = normalize(question);

  return includesAny(text, [
    "sales rep",
    "sales representative",
    "rep performance",
    "quota",
    "crm",
    "salesforce",
    "hubspot",
    "customer account",
    "account level",
    "customer level",
    "private revenue",
    "private net revenue",
    "net revenue",
    "internal revenue",
    "profit",
    "profitability",
    "margin",
    "rebate",
    "discount",
    "contract",
    "invoice",
    "deal loss",
    "lost revenue",
    "lost us",
    "territory",
    "pipeline",
    "opportunity",
    "hidden internal",
    "pretend you have salesforce",
  ]);
}

function looksUnrelated(question: string) {
  const text = normalize(question);
  const drug = findTargetDrug(question);

  const pharmaScope =
    Boolean(drug) ||
    includesAny(text, [
      "drug",
      "drugs",
      "medicine",
      "medicines",
      "fda",
      "label",
      "cms",
      "medicare",
      "part d",
      "open payments",
      "prescriber",
      "pharma",
      "payment",
      "spending",
      "spend",
      "spent",
      "cost",
      "expensive",
      "trend",
      "sales quantity",
      "public data",
    ]);

  if (pharmaScope) return false;

  return includesAny(text, [
    "react",
    "javascript",
    "python",
    "todo app",
    "binary search",
    "css",
    "resume",
    "cover letter",
    "resignation",
    "weather",
    "nba",
    "trip",
    "travel",
    "miami",
    "cook",
    "dinner",
    "recipe",
    "workout",
    "gym",
    "poem",
    "visa photo",
    "apartment",
    "grocery bill",
    "pickleball",
  ]);
}

function hasDrugLanguage(question: string) {
  const text = normalize(question);

  return (
    Boolean(findTargetDrug(question)) ||
    includesAny(text, ["drug", "drugs", "medicine", "medicines", "meds"])
  );
}

function hasSpendLanguage(question: string) {
  const text = normalize(question);

  return includesAny(text, [
    "spending",
    "spend",
    "spent",
    "cost",
    "costs",
    "costliest",
    "expensive",
    "high spend",
    "highest spend",
    "a lot",
    "lot",
    "most",
    "top",
    "rank",
    "biggest",
    "large",
    "largest",
    "trend",
    "trending",
    "changed",
    "change",
    "growth",
    "grew",
  ]);
}

function hasSqlIntent(question: string) {
  const text = normalize(question);

  const explicitSqlIntent = includesAny(text, [
    "cms",
    "medicare",
    "part d",
    "spending",
    "spend",
    "spent",
    "cost",
    "prescriber",
    "provider",
    "specialty",
    "state",
    "open payments",
    "payment",
    "payments",
    "public data",
    "public signals",
    "sales quantity",
    "sales trend",
    "quantity sold",
    "trend",
    "trending",
  ]);

  const naturalSpendIntent = hasDrugLanguage(question) && hasSpendLanguage(question);

  return explicitSqlIntent || naturalSpendIntent;
}

function hasLabelIntent(question: string) {
  const text = normalize(question);

  return includesAny(text, [
    "fda",
    "label",
    "used for",
    "use",
    "treat",
    "treats",
    "treatment",
    "indication",
    "indications",
    "warning",
    "warnings",
    "precaution",
    "adverse",
    "reaction",
    "reactions",
    "side effect",
    "side effects",
    "dosage",
    "dose",
    "contraindication",
    "contraindications",
    "label context",
    "label evidence",
    "safety",
  ]);
}

function looksLikeHybrid(question: string) {
  return hasSqlIntent(question) && hasLabelIntent(question);
}

function isPlainDrugOnlyQuestion(question: string) {
  const text = normalize(question);
  const drug = findTargetDrug(question);

  if (!drug) return false;

  const aliases =
    drugAliases.find((item) => item.canonical === drug)?.aliases || [];

  let remaining = text;

  for (const alias of aliases.sort((a, b) => b.length - a.length)) {
    remaining = remaining.replaceAll(alias, " ");
  }

  const remainingWords = remaining.split(/\s+/).filter(Boolean);

  return remainingWords.length === 0;
}

function looksAmbiguous(question: string) {
  const text = normalize(question);
  const hasEntity = Boolean(findTargetDrug(question));

  if (!hasEntity) return false;

  if (isPlainDrugOnlyQuestion(question)) {
    return true;
  }

  if (hasLabelIntent(question) || hasSqlIntent(question)) {
    return false;
  }

  return includesAny(text, [
    "performance",
    "doing well",
    "what changed",
    "highest value",
    "top results",
    "compare",
    "investigate",
    "summarize",
    "analyze",
    "what should i know",
    "good or bad",
    "numbers",
  ]);
}

function looksLikeRag(question: string) {
  const drug = findTargetDrug(question);

  if (!drug) return false;

  return hasLabelIntent(question);
}

function chooseSqlTool(question: string): FastIntentRoute["toolName"] {
  const text = normalize(question);

  if (includesAny(text, ["open payments", "payments", "physician payment"])) {
    return "open_payments_agent";
  }

  if (includesAny(text, ["sales quantity", "sales trend", "quantity sold", "atc"])) {
    return "pharma_sales_agent";
  }

  if (includesAny(text, ["prescriber", "provider", "specialty", "state", "where"])) {
    return "part_d_prescriber_agent";
  }

  if (includesAny(text, ["increase", "growth", "grew", "biggest increase"])) {
    return "part_d_spending_increase_agent";
  }

  if (
    includesAny(text, [
      "top",
      "highest",
      "rank",
      "most",
      "a lot",
      "biggest",
      "largest",
      "costliest",
      "expensive",
      "spent a lot",
      "cost the most",
      "high spend",
    ])
  ) {
    return "part_d_top_spending_agent";
  }

  return "part_d_drug_trend_agent";
}

function makeRoute(
  values: Omit<FastIntentRoute, "planner"> & {
    reason: string;
  }
): FastIntentRoute {
  return {
    toolName: values.toolName,
    route: values.route,
    intent: values.intent,
    confidence: values.confidence,
    extractedEntities: values.extractedEntities,
    planner: {
      status: "fast_route",
      usedLlm: false,
      reason: values.reason,
    },
  };
}

export function tryFastIntentRoute(questionInput: unknown): FastIntentRoute | null {
  const question = clean(questionInput);

  if (!question) return null;

  const drug = findTargetDrug(question);

  if (looksLikePrivate(question)) {
    return makeRoute({
      toolName: "data_limitation_agent",
      route: "DATA_LIMITATION",
      intent: "private_or_internal_data_request",
      confidence: "High",
      extractedEntities: {
        drug,
        blockedReason: "private_internal_or_commercial_data",
      },
      reason: "Private/internal business-data request blocked deterministically.",
    });
  }

  if (looksUnrelated(question)) {
    return makeRoute({
      toolName: "unsupported_agent",
      route: "UNSUPPORTED",
      intent: "outside_public_pharma_scope",
      confidence: "High",
      extractedEntities: {
        blockedReason: "outside_public_pharma_scope",
      },
      reason: "Question is unrelated to public pharma intelligence.",
    });
  }

  if (looksLikeHybrid(question)) {
    return makeRoute({
      toolName: chooseSqlTool(question),
      route: "HYBRID_SQL_RAG",
      intent: "hybrid_public_data_plus_fda_label",
      confidence: "High",
      extractedEntities: {
        drug,
        needsSqlEvidence: true,
        needsLabelEvidence: true,
      },
      reason: "Question asks for public structured data plus FDA label evidence.",
    });
  }

  if (looksAmbiguous(question)) {
    return makeRoute({
      toolName: "unsupported_agent",
      route: "UNSUPPORTED",
      intent: "ambiguous_entity_metric_or_source",
      confidence: "High",
      extractedEntities: {
        drug,
        ambiguity: "entity_present_but_metric_or_dataset_missing",
      },
      reason: "Question is ambiguous and should ask for metric/source clarification.",
    });
  }

  if (looksLikeRag(question)) {
    return makeRoute({
      toolName: "openfda_label_agent",
      route: "RAG_ONLY",
      intent: "openfda_label_question",
      confidence: "High",
      extractedEntities: {
        drug,
      },
      reason: "Question asks for FDA-label style evidence about a loaded target drug.",
    });
  }

  if (hasSqlIntent(question)) {
    return makeRoute({
      toolName: chooseSqlTool(question),
      route: "SQL_ONLY",
      intent: "public_pharma_structured_data_question",
      confidence: "High",
      extractedEntities: {
        drug,
      },
      reason: "Question asks for public pharma structured data using conversational wording.",
    });
  }

  return null;
}
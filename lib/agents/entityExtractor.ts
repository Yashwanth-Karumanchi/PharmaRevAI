import { sql } from "@/lib/db/client";

export type SourceHint =
  | "cms_part_d"
  | "openfda"
  | "open_payments"
  | "pharma_sales"
  | "private_internal";

export type AnalysisHint =
  | "top"
  | "increase"
  | "trend"
  | "forecast"
  | "seasonality"
  | "drop"
  | "provider"
  | "state"
  | "specialty"
  | "company"
  | "payment"
  | "sales_quantity"
  | "indication"
  | "warning"
  | "adverse_reaction"
  | "dosage"
  | "private_data"
  | "unsupported";

export type ExtractedEntityMatch = {
  value: string;
  entityType:
    | "drug"
    | "generic"
    | "manufacturer"
    | "category"
    | "state"
    | "company"
    | "specialty"
    | "unknown";
  source: string;
  score: number;
};

export type ExtractedPharmaEntities = {
  rawQuestion: string;
  normalizedQuestion: string;
  years: number[];
  yearRange: {
    startYear: number;
    endYear: number;
  } | null;
  sourceHints: SourceHint[];
  analysisHints: AnalysisHint[];
  drugMentions: ExtractedEntityMatch[];
  categoryMentions: ExtractedEntityMatch[];
  geographyMentions: ExtractedEntityMatch[];
  privateDataSignals: string[];
  matchedTerms: string[];
};

type CandidateEntity = {
  value: string;
  entityType: ExtractedEntityMatch["entityType"];
  source: string;
};

type CandidateCache = {
  expiresAt: number;
  drugs: CandidateEntity[];
  categories: CandidateEntity[];
};

type DrugCandidateRow = {
  value: string | null;
  entity_type: string | null;
  source: string | null;
};

type CategoryCandidateRow = {
  value: string | null;
  source: string | null;
};

let candidateCache: CandidateCache | null = null;

const candidateCacheTtlMs = 5 * 60 * 1000;

const privateDataTerms = [
  "private deal",
  "deal loss",
  "lost deal",
  "sales rep",
  "sales-rep",
  "rep lost",
  "internal margin",
  "margin leakage",
  "rebate",
  "discount",
  "contract loss",
  "crm",
  "private revenue",
  "net revenue",
  "profit",
  "salesforce opportunity",
  "hubspot deal",
];

const sourceTermMap: Record<SourceHint, string[]> = {
  cms_part_d: [
    "part d",
    "medicare",
    "cms",
    "beneficiary",
    "beneficiaries",
    "drug cost",
    "total drug cost",
    "claim",
    "claims",
    "spending",
  ],
  openfda: [
    "fda",
    "openfda",
    "label",
    "used for",
    "indication",
    "indications",
    "warning",
    "warnings",
    "adverse reaction",
    "adverse reactions",
    "dosage",
    "contraindication",
    "contraindications",
  ],
  open_payments: [
    "open payments",
    "payment",
    "payments",
    "transfer of value",
    "transfers of value",
    "consulting fee",
    "food and beverage",
    "honoraria",
    "speaker",
    "physician payment",
    "company payment",
  ],
  pharma_sales: [
    "pharma sales",
    "sales quantity",
    "quantity sold",
    "sales volume",
    "volume",
    "demand",
    "seasonality",
    "seasonal",
    "forecast",
    "predict",
    "next month",
    "monthly sales",
    "category drop",
    "quantity drop",
  ],
  private_internal: privateDataTerms,
};

const analysisTermMap: Record<AnalysisHint, string[]> = {
  top: ["top", "highest", "largest", "biggest", "most"],
  increase: ["increase", "increased", "growth", "grew", "rose", "change"],
  trend: ["trend", "history", "over time", "year by year", "between 20", "from 20"],
  forecast: ["forecast", "predict", "next month", "future"],
  seasonality: ["seasonality", "seasonal", "monthly", "month had", "peak"],
  drop: ["drop", "decline", "decrease", "fell", "down", "reduced"],
  provider: [
    "provider",
    "providers",
    "prescriber",
    "prescribers",
    "prescribed",
    "prescribing",
    "physician",
    "physicians",
    "doctor",
    "doctors",
    "npi",
  ],
  state: ["state", "states", "geography", "geographic", "region"],
  specialty: ["specialty", "specialties", "provider type", "physician type"],
  company: ["company", "companies", "manufacturer", "manufacturers"],
  payment: ["payment", "payments", "open payments", "transfer of value"],
  sales_quantity: ["sales quantity", "quantity sold", "volume", "demand", "units"],
  indication: ["used for", "use", "uses", "indication", "indications", "purpose"],
  warning: ["warning", "warnings", "boxed warning"],
  adverse_reaction: ["adverse reaction", "adverse reactions", "side effects"],
  dosage: ["dosage", "dose", "administration"],
  private_data: privateDataTerms,
  unsupported: [],
};

const usStates: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  newhampshire: "NH",
  newjersey: "NJ",
  newmexico: "NM",
  newyork: "NY",
  northcarolina: "NC",
  northdakota: "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  rhodeisland: "RI",
  southcarolina: "SC",
  southdakota: "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  westvirginia: "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const stateAbbreviations = new Set(Object.values(usStates));

const commonAtcCategories = [
  "M01AB",
  "M01AE",
  "N02BA",
  "N02BE",
  "N05B",
  "N05C",
  "R03",
  "R06",
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(value: string) {
  return normalizeText(value).replace(/\s+/g, "");
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function getMatchedTerms(question: string, terms: string[]) {
  const normalized = normalizeText(question);

  return terms.filter((term) => normalized.includes(normalizeText(term)));
}

function extractYears(question: string) {
  const matches = question.match(/\b20\d{2}\b/g) ?? [];

  return unique(
    matches
      .map((year) => Number(year))
      .filter((year) => Number.isFinite(year))
  ).sort((a, b) => a - b);
}

function extractYearRange(years: number[]) {
  if (years.length < 2) {
    return null;
  }

  return {
    startYear: Math.min(...years),
    endYear: Math.max(...years),
  };
}

function getTokenMatchScore(question: string, candidate: string) {
  const normalizedQuestion = normalizeText(question);
  const normalizedCandidate = normalizeText(candidate);

  if (!normalizedCandidate || normalizedCandidate.length < 2) {
    return 0;
  }

  if (normalizedQuestion.includes(normalizedCandidate)) {
    return normalizedCandidate.length + 100;
  }

  const candidateTokens = normalizedCandidate
    .split(" ")
    .filter((token) => token.length >= 3);

  if (candidateTokens.length === 0) {
    return 0;
  }

  const matchedTokens = candidateTokens.filter((token) =>
    normalizedQuestion.includes(token)
  );

  if (matchedTokens.length === candidateTokens.length) {
    return normalizedCandidate.length + 50;
  }

  if (matchedTokens.length > 0 && candidateTokens.length <= 2) {
    return matchedTokens.join("").length;
  }

  return 0;
}

function findEntityMatches({
  question,
  candidates,
  limit,
}: {
  question: string;
  candidates: CandidateEntity[];
  limit: number;
}) {
  const matches: ExtractedEntityMatch[] = [];

  for (const candidate of candidates) {
    const score = getTokenMatchScore(question, candidate.value);

    if (score > 0) {
      matches.push({
        value: candidate.value,
        entityType: candidate.entityType,
        source: candidate.source,
        score,
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

function extractHeuristicDrugMention(question: string): ExtractedEntityMatch[] {
  const patterns = [
    /what\s+is\s+(.+?)\s+used\s+for/i,
    /warnings?\s+(?:does|for|of|about)?\s*(.+?)(?:\?|$)/i,
    /adverse\s+reactions?\s+(?:for|of|about)?\s*(.+?)(?:\?|$)/i,
    /trend\s+for\s+(.+?)(?:\.|\?|$)/i,
    /cost\s+for\s+(.+?)(?:\.|\?|$)/i,
    /spending\s+trend\s+for\s+(.+?)(?:\.|\?|$)/i,
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    const rawValue = match?.[1]?.trim();

    if (!rawValue) {
      continue;
    }

    const cleaned = rawValue
      .replace(/\b(the|a|an|drug|medicine|label|fda|cms|medicare)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length >= 3 && cleaned.length <= 80) {
      return [
        {
          value: cleaned,
          entityType: "drug",
          source: "heuristic_question_pattern",
          score: 25,
        },
      ];
    }
  }

  return [];
}

function extractCategoryMentionsFromQuestion(question: string) {
  const normalized = question.toUpperCase();

  return commonAtcCategories
    .filter((category) => normalized.includes(category))
    .map((category) => ({
      value: category,
      entityType: "category" as const,
      source: "known_atc_category",
      score: 100,
    }));
}

function extractGeographyMentions(question: string) {
  const normalized = normalizeText(question);
  const compact = normalizeCompact(question);
  const matches: ExtractedEntityMatch[] = [];

  for (const [stateName, abbreviation] of Object.entries(usStates)) {
    if (compact.includes(stateName)) {
      matches.push({
        value: abbreviation,
        entityType: "state",
        source: "us_state_name",
        score: 90,
      });
    }
  }

  const words = normalized.split(" ");

  for (const word of words) {
    const upper = word.toUpperCase();

    if (stateAbbreviations.has(upper)) {
      matches.push({
        value: upper,
        entityType: "state",
        source: "us_state_abbreviation",
        score: 85,
      });
    }
  }

  const uniqueByValue = new Map<string, ExtractedEntityMatch>();

  for (const match of matches) {
    const existing = uniqueByValue.get(match.value);

    if (!existing || match.score > existing.score) {
      uniqueByValue.set(match.value, match);
    }
  }

  return Array.from(uniqueByValue.values()).sort((a, b) => b.score - a.score);
}

function getSourceHints(question: string) {
  const hints: SourceHint[] = [];

  for (const [sourceHint, terms] of Object.entries(sourceTermMap)) {
    if (getMatchedTerms(question, terms).length > 0) {
      hints.push(sourceHint as SourceHint);
    }
  }

  return unique(hints);
}

function getAnalysisHints(question: string) {
  const hints: AnalysisHint[] = [];

  for (const [analysisHint, terms] of Object.entries(analysisTermMap)) {
    if (terms.length > 0 && getMatchedTerms(question, terms).length > 0) {
      hints.push(analysisHint as AnalysisHint);
    }
  }

  return unique(hints);
}

async function safeDrugCandidatesFromPartD() {
  try {
    const rows = await sql<DrugCandidateRow[]>`
      select distinct brand_name as value, 'drug'::text as entity_type, 'cms_part_d_spending.brand_name'::text as source
      from cms_part_d_spending
      where brand_name is not null
        and brand_name <> ''
      limit 1500

      union

      select distinct generic_name as value, 'generic'::text as entity_type, 'cms_part_d_spending.generic_name'::text as source
      from cms_part_d_spending
      where generic_name is not null
        and generic_name <> ''
      limit 1500
    `;

    return rows
      .filter((row) => row.value)
      .map((row) => ({
        value: row.value as string,
        entityType: (row.entity_type ?? "drug") as ExtractedEntityMatch["entityType"],
        source: row.source ?? "cms_part_d_spending",
      }));
  } catch {
    return [];
  }
}

async function safeDrugCandidatesFromDocuments() {
  try {
    const rows = await sql<DrugCandidateRow[]>`
      select distinct drug_name as value, 'drug'::text as entity_type, 'document_chunks.drug_name'::text as source
      from document_chunks
      where drug_name is not null
        and drug_name <> ''
      limit 1500

      union

      select distinct metadata->>'generic_name' as value, 'generic'::text as entity_type, 'documents.metadata.generic_name'::text as source
      from documents
      where metadata->>'generic_name' is not null
        and metadata->>'generic_name' <> ''
      limit 1500
    `;

    return rows
      .filter((row) => row.value)
      .map((row) => ({
        value: row.value as string,
        entityType: (row.entity_type ?? "drug") as ExtractedEntityMatch["entityType"],
        source: row.source ?? "document_chunks",
      }));
  } catch {
    return [];
  }
}

async function safeDrugCandidatesFromSales() {
  try {
    const rows = await sql<DrugCandidateRow[]>`
      select distinct drug_name as value, 'drug'::text as entity_type, 'pharma_sales.drug_name'::text as source
      from pharma_sales
      where drug_name is not null
        and drug_name <> ''
      limit 1500
    `;

    return rows
      .filter((row) => row.value)
      .map((row) => ({
        value: row.value as string,
        entityType: (row.entity_type ?? "drug") as ExtractedEntityMatch["entityType"],
        source: row.source ?? "pharma_sales",
      }));
  } catch {
    return [];
  }
}

async function safeCategoryCandidatesFromSales() {
  try {
    const rows = await sql<CategoryCandidateRow[]>`
      select distinct atc_category as value, 'pharma_sales.atc_category'::text as source
      from pharma_sales
      where atc_category is not null
        and atc_category <> ''
      limit 500
    `;

    return rows
      .filter((row) => row.value)
      .map((row) => ({
        value: row.value as string,
        entityType: "category" as const,
        source: row.source ?? "pharma_sales",
      }));
  } catch {
    return [];
  }
}

function dedupeCandidates(candidates: CandidateEntity[]) {
  const byKey = new Map<string, CandidateEntity>();

  for (const candidate of candidates) {
    const key = `${candidate.entityType}:${normalizeText(candidate.value)}`;

    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  }

  return Array.from(byKey.values());
}

async function getCandidateEntities() {
  const now = Date.now();

  if (candidateCache && candidateCache.expiresAt > now) {
    return candidateCache;
  }

  const [partDDrugs, documentDrugs, salesDrugs, salesCategories] =
    await Promise.all([
      safeDrugCandidatesFromPartD(),
      safeDrugCandidatesFromDocuments(),
      safeDrugCandidatesFromSales(),
      safeCategoryCandidatesFromSales(),
    ]);

  const drugs = dedupeCandidates([
    ...partDDrugs,
    ...documentDrugs,
    ...salesDrugs,
  ]);

  const categories = dedupeCandidates([
    ...commonAtcCategories.map((category) => ({
      value: category,
      entityType: "category" as const,
      source: "known_atc_category",
    })),
    ...salesCategories,
  ]);

  candidateCache = {
    expiresAt: now + candidateCacheTtlMs,
    drugs,
    categories,
  };

  return candidateCache;
}

export async function extractPharmaEntities(
  question: string
): Promise<ExtractedPharmaEntities> {
  const normalizedQuestion = normalizeText(question);
  const years = extractYears(question);
  const yearRange = extractYearRange(years);
  const sourceHints = getSourceHints(question);
  const analysisHints = getAnalysisHints(question);
  const privateDataSignals = getMatchedTerms(question, privateDataTerms);
  const matchedTerms = unique([
    ...Object.values(sourceTermMap).flatMap((terms) =>
      getMatchedTerms(question, terms)
    ),
    ...Object.values(analysisTermMap).flatMap((terms) =>
      getMatchedTerms(question, terms)
    ),
  ]);

  const candidates = await getCandidateEntities();

  const knownDrugMatches = findEntityMatches({
    question,
    candidates: candidates.drugs,
    limit: 5,
  });

  const heuristicDrugMatches =
    knownDrugMatches.length > 0 ? [] : extractHeuristicDrugMention(question);

  const categoryMatches = [
    ...extractCategoryMentionsFromQuestion(question),
    ...findEntityMatches({
      question,
      candidates: candidates.categories,
      limit: 5,
    }),
  ];

  return {
    rawQuestion: question,
    normalizedQuestion,
    years,
    yearRange,
    sourceHints,
    analysisHints,
    drugMentions: [...knownDrugMatches, ...heuristicDrugMatches].slice(0, 5),
    categoryMentions: categoryMatches
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
    geographyMentions: extractGeographyMentions(question),
    privateDataSignals,
    matchedTerms,
  };
}
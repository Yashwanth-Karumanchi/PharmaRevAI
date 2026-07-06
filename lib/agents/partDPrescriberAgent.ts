import { sql } from "@/lib/db/client";
import {
  buildSkippedComposerTrace,
  composePharmaAnswer,
} from "@/lib/agents/llmComposer";
import type { SourceEvidence } from "@/types/evidence";
import {
  clean,
  commonLimitSource,
  formatCurrency,
  formatNumber,
  getDrugPatterns,
  includesAny,
  looksDrugSpecific,
  markdownTable,
  normalizeText,
  resolveKnownDrug,
} from "@/lib/agents/pharmaEntityResolver";
import { extractRequestedLimitFromQuestions } from "./partDQuestionParser";

const limit = extractRequestedLimitFromQuestions({
  originalQuestion: extractedEntities?.originalQuestion,
  resolvedQuestion: question,
  defaultLimit: 10,
  maxLimit: 25,
});

type LatestYearRow = { year: number | null };

type LocationResultRow = {
  provider_state: string | null;
  provider_city: string | null;
  brand_name: string | null;
  generic_name: string | null;
  total_drug_cost: string;
  total_claim_count: string;
  provider_count: string;
  beneficiary_count: string | null;
};

type ProviderResultRow = {
  npi: string;
  provider_name: string | null;
  provider_city: string | null;
  provider_state: string | null;
  provider_specialty: string | null;
  brand_name: string | null;
  generic_name: string | null;
  total_drug_cost: string;
  total_claim_count: string;
  beneficiary_count: string | null;
};

type StateResultRow = {
  provider_state: string | null;
  brand_name: string | null;
  generic_name: string | null;
  total_drug_cost: string;
  total_claim_count: string;
  provider_count: string;
  beneficiary_count: string | null;
};

type SpecialtyResultRow = {
  provider_specialty: string | null;
  brand_name: string | null;
  generic_name: string | null;
  total_drug_cost: string;
  total_claim_count: string;
  provider_count: string;
  beneficiary_count: string | null;
};

type AnalysisType = "location" | "state" | "provider" | "specialty";

function prescriberLimitText() {
  return "Data limitation: This is public CMS Medicare Part D provider-drug cost data. It does not prove private sales performance, sales-rep impact, contract loss, discounts, rebates, margin, or private pharma revenue. Beneficiary counts are aggregated in public CMS rows and should not be treated as deduplicated patient counts across providers. [LIMIT-1]";
}

function buildPrescriberSources(): SourceEvidence[] {
  const limitText = prescriberLimitText();

  return [
    {
      id: "cms-part-d-prescribers-source",
      title: "CMS Medicare Part D Prescribers by Provider and Drug",
      dataset: "CMS Medicare Part D Prescribers",
      score: 0.95,
      status: "used",
      citationLabel: "SQL-1",
      citationType: "sql",
      excerpt:
        "The answer uses CMS Medicare Part D Prescribers by Provider and Drug rows loaded into Neon. The dataset organizes prescription fills and total drug cost by prescribing NPI, drug brand/generic, city, state, and specialty.",
      metadata: [
        "Table: cms_part_d_prescribers",
        "Source: CMS public data",
        "Metric: total_drug_cost and total_claim_count",
        "Purpose: public provider, location, and specialty cost analysis",
      ],
    },
    commonLimitSource({
      id: "cms-prescriber-limitation",
      title: "CMS Part D Prescriber data limitation",
      dataset: "CMS Medicare Part D Prescribers",
      excerpt: limitText,
    }),
  ];
}

async function getLatestYear() {
  const rows = await sql<LatestYearRow[]>`
    select max(year)::int as year
    from cms_part_d_prescribers
  `;

  return rows[0]?.year ?? null;
}

async function getSampleSuggestions() {
  const rows = await sql<{ brand_name: string | null; generic_name: string | null }[]>`
    select distinct brand_name, generic_name
    from cms_part_d_prescribers
    where brand_name is not null
    order by brand_name asc
    limit 8
  `;

  return rows
    .map((row) => row.brand_name || row.generic_name)
    .filter((name): name is string => Boolean(name));
}

function getDrugResolution(question: string) {
  const drug = resolveKnownDrug(question);
  const patterns = getDrugPatterns(drug);

  return {
    drug,
    patterns,
    isDrugSpecific: Boolean(drug) || looksDrugSpecific(question),
    displayName: drug?.canonical || "the requested drug",
  };
}

function inferAnalysisType(question: string): AnalysisType {
  const normalized = normalizeText(question);

  if (
    includesAny(normalized, [
      "specialty",
      "specialties",
      "provider type",
      "physician type",
      "doctor type",
    ])
  ) {
    return "specialty";
  }

  if (includesAny(normalized, ["state", "states", "region", "regions"])) {
    return "state";
  }

  if (
    includesAny(normalized, [
      "where",
      "city",
      "cities",
      "location",
      "locations",
      "geography",
      "geographic",
      "area",
      "areas",
    ])
  ) {
    return "location";
  }

  if (
    includesAny(normalized, [
      "provider",
      "providers",
      "prescriber",
      "prescribers",
      "physician",
      "physicians",
      "doctor",
      "doctors",
      "npi",
    ])
  ) {
    return "provider";
  }

  return "provider";
}

function safePatterns(patterns: string[]) {
  return patterns.length > 0 ? patterns : ["%__no_match__%"];
}

async function getTopLocations({
  year,
  patterns,
}: {
  year: number;
  patterns: string[];
}) {
  const drugPatterns = safePatterns(patterns);

  return sql<LocationResultRow[]>`
    select
      provider_state,
      provider_city,
      max(brand_name) as brand_name,
      max(generic_name) as generic_name,
      sum(total_drug_cost)::numeric::text as total_drug_cost,
      sum(total_claim_count)::numeric::text as total_claim_count,
      count(distinct npi)::int::text as provider_count,
      sum(beneficiary_count)::numeric::text as beneficiary_count
    from cms_part_d_prescribers
    where year = ${year}
      and provider_state is not null
      and provider_city is not null
      and (
        brand_name ilike any(${drugPatterns})
        or generic_name ilike any(${drugPatterns})
      )
    group by provider_state, provider_city
    order by sum(total_drug_cost) desc nulls last
    limit ${limit}
  `;
}

async function getTopStates({
  year,
  patterns,
}: {
  year: number;
  patterns: string[];
}) {
  const drugPatterns = safePatterns(patterns);

  return sql<StateResultRow[]>`
    select
      provider_state,
      max(brand_name) as brand_name,
      max(generic_name) as generic_name,
      sum(total_drug_cost)::numeric::text as total_drug_cost,
      sum(total_claim_count)::numeric::text as total_claim_count,
      count(distinct npi)::int::text as provider_count,
      sum(beneficiary_count)::numeric::text as beneficiary_count
    from cms_part_d_prescribers
    where year = ${year}
      and provider_state is not null
      and (
        brand_name ilike any(${drugPatterns})
        or generic_name ilike any(${drugPatterns})
      )
    group by provider_state
    order by sum(total_drug_cost) desc nulls last
    limit ${limit}
  `;
}

async function getTopSpecialties({
  year,
  patterns,
}: {
  year: number;
  patterns: string[];
}) {
  const drugPatterns = safePatterns(patterns);

  return sql<SpecialtyResultRow[]>`
    select
      provider_specialty,
      max(brand_name) as brand_name,
      max(generic_name) as generic_name,
      sum(total_drug_cost)::numeric::text as total_drug_cost,
      sum(total_claim_count)::numeric::text as total_claim_count,
      count(distinct npi)::int::text as provider_count,
      sum(beneficiary_count)::numeric::text as beneficiary_count
    from cms_part_d_prescribers
    where year = ${year}
      and provider_specialty is not null
      and (
        brand_name ilike any(${drugPatterns})
        or generic_name ilike any(${drugPatterns})
      )
    group by provider_specialty
    order by sum(total_drug_cost) desc nulls last
    limit ${limit}
  `;
}

async function getTopProviders({
  year,
  patterns,
}: {
  year: number;
  patterns: string[];
}) {
  const drugPatterns = safePatterns(patterns);

  return sql<ProviderResultRow[]>`
    select
      npi,
      provider_name,
      provider_city,
      provider_state,
      provider_specialty,
      max(brand_name) as brand_name,
      max(generic_name) as generic_name,
      sum(total_drug_cost)::numeric::text as total_drug_cost,
      sum(total_claim_count)::numeric::text as total_claim_count,
      sum(beneficiary_count)::numeric::text as beneficiary_count
    from cms_part_d_prescribers
    where year = ${year}
      and (
        brand_name ilike any(${drugPatterns})
        or generic_name ilike any(${drugPatterns})
      )
    group by npi, provider_name, provider_city, provider_state, provider_specialty
    order by sum(total_drug_cost) desc nulls last
    limit ${limit}
  `;
}

async function getGlobalTopProviders(year: number) {
  return sql<ProviderResultRow[]>`
    select
      npi,
      provider_name,
      provider_city,
      provider_state,
      provider_specialty,
      max(brand_name) as brand_name,
      max(generic_name) as generic_name,
      sum(total_drug_cost)::numeric::text as total_drug_cost,
      sum(total_claim_count)::numeric::text as total_claim_count,
      sum(beneficiary_count)::numeric::text as beneficiary_count
    from cms_part_d_prescribers
    where year = ${year}
    group by npi, provider_name, provider_city, provider_state, provider_specialty
    order by sum(total_drug_cost) desc nulls last
    limit ${limit}
  `;
}

function buildNoRowsAnswer({
  year,
  displayName,
  analysisType,
}: {
  year: number;
  displayName: string;
  analysisType: AnalysisType;
}) {
  return [
    `I could not find loaded CMS Part D Prescribers rows for ${displayName} in ${year} for the requested ${analysisType} analysis. [LIMIT-1]`,
    "",
    "This does not mean the drug does not exist generally. It only means the current Neon table did not return matching provider-drug rows after applying the requested drug filter.",
    "",
    prescriberLimitText(),
  ].join("\n");
}

function buildLocationAnswer({
  year,
  rows,
  displayName,
}: {
  year: number;
  rows: LocationResultRow[];
  displayName: string;
}) {
  const table = markdownTable(
    ["Rank", "Location", "Drug", "Total Drug Cost", "Claims", "Providers"],
    rows.map((row, index) => [
      index + 1,
      `${row.provider_city || "Unknown city"}, ${row.provider_state || "Unknown state"}`,
      row.brand_name || row.generic_name || displayName,
      formatCurrency(Number(row.total_drug_cost)),
      formatNumber(Number(row.total_claim_count)),
      formatNumber(Number(row.provider_count)),
    ])
  );

  return [
    `Based on loaded CMS Part D Prescribers data, these locations had the highest total drug cost for ${displayName} in ${year}. [SQL-1]`,
    "",
    table,
    "",
    "This is a geography view grouped by provider city and state, not a private sales-territory or sales-rep view.",
    "",
    prescriberLimitText(),
  ].join("\n");
}

function buildStateAnswer({
  year,
  rows,
  displayName,
}: {
  year: number;
  rows: StateResultRow[];
  displayName: string;
}) {
  const table = markdownTable(
    ["Rank", "State", "Drug", "Total Drug Cost", "Claims", "Providers"],
    rows.map((row, index) => [
      index + 1,
      row.provider_state || "Unknown",
      row.brand_name || row.generic_name || displayName,
      formatCurrency(Number(row.total_drug_cost)),
      formatNumber(Number(row.total_claim_count)),
      formatNumber(Number(row.provider_count)),
    ])
  );

  return [
    `Based on loaded CMS Part D Prescribers data, these states had the highest total drug cost for ${displayName} in ${year}. [SQL-1]`,
    "",
    table,
    "",
    prescriberLimitText(),
  ].join("\n");
}

function buildSpecialtyAnswer({
  year,
  rows,
  displayName,
}: {
  year: number;
  rows: SpecialtyResultRow[];
  displayName: string;
}) {
  const table = markdownTable(
    ["Rank", "Specialty", "Drug", "Total Drug Cost", "Claims", "Providers"],
    rows.map((row, index) => [
      index + 1,
      row.provider_specialty || "Unknown",
      row.brand_name || row.generic_name || displayName,
      formatCurrency(Number(row.total_drug_cost)),
      formatNumber(Number(row.total_claim_count)),
      formatNumber(Number(row.provider_count)),
    ])
  );

  return [
    `Based on loaded CMS Part D Prescribers data, these provider specialties had the highest total drug cost for ${displayName} in ${year}. [SQL-1]`,
    "",
    table,
    "",
    prescriberLimitText(),
  ].join("\n");
}

function buildProviderAnswer({
  year,
  rows,
  displayName,
}: {
  year: number;
  rows: ProviderResultRow[];
  displayName: string;
}) {
  const table = markdownTable(
    ["Rank", "Provider", "Location", "Specialty", "Drug", "Total Drug Cost", "Claims"],
    rows.map((row, index) => [
      index + 1,
      `${row.provider_name || "Unknown provider"} (${row.npi})`,
      [row.provider_city, row.provider_state].filter(Boolean).join(", ") || "Unknown",
      row.provider_specialty || "Unknown",
      row.brand_name || row.generic_name || displayName,
      formatCurrency(Number(row.total_drug_cost)),
      formatNumber(Number(row.total_claim_count)),
    ])
  );

  return [
    `Based on loaded CMS Part D Prescribers data, these providers had the highest total drug cost for ${displayName} in ${year}. [SQL-1]`,
    "",
    table,
    "",
    prescriberLimitText(),
  ].join("\n");
}

export async function answerPartDPrescriberQuestion(question: string) {
  const latestYear = await getLatestYear();
  const sources = buildPrescriberSources();

  if (!latestYear) {
    const suggestions = await getSampleSuggestions();

    return {
      answer: `CMS Part D Prescribers data is not loaded yet.\n\nLoaded suggestions right now:\n${
        suggestions.length > 0 ? suggestions.map((item) => `- ${item}`).join("\n") : "- None"
      }\n\nRun the CMS Prescribers ingestion before asking provider/state/specialty questions. [LIMIT-1]`,
      rows: [],
      sqlQuery:
        "CMS Part D Prescribers agent could not run because cms_part_d_prescribers has no loaded year.",
      sources,
      entities: {
        detectedDrug: null,
        latestYear: null,
      },
      route: "SQL_ONLY" as const,
      composer: buildSkippedComposerTrace("CMS Part D Prescribers data is not loaded yet."),
    };
  }

  const { drug, patterns, isDrugSpecific, displayName } = getDrugResolution(question);
  const analysisType = inferAnalysisType(question);

  let rows: Array<LocationResultRow | StateResultRow | SpecialtyResultRow | ProviderResultRow> = [];
  let draftAnswer = "";
  let sqlQuery = "";

  if (isDrugSpecific && patterns.length === 0) {
    draftAnswer = buildNoRowsAnswer({ year: latestYear, displayName, analysisType });
  } else if (analysisType === "location") {
    rows = isDrugSpecific
      ? await getTopLocations({ year: latestYear, patterns })
      : await getTopLocations({ year: latestYear, patterns: ["%"] });

    draftAnswer =
      rows.length > 0
        ? buildLocationAnswer({
            year: latestYear,
            rows: rows as LocationResultRow[],
            displayName: isDrugSpecific ? displayName : "all loaded provider-drug rows",
          })
        : buildNoRowsAnswer({ year: latestYear, displayName, analysisType });

    sqlQuery = isDrugSpecific
      ? `Grouped cms_part_d_prescribers by provider_city/provider_state for ${displayName} in ${latestYear}; WHERE brand_name/generic_name ILIKE resolved aliases; ORDER BY sum(total_drug_cost) DESC; LIMIT ${limit}.`
      : `Grouped cms_part_d_prescribers by provider_city/provider_state in ${latestYear}; ORDER BY sum(total_drug_cost) DESC; LIMIT ${limit}.`;
  } else if (analysisType === "state") {
    rows = isDrugSpecific
      ? await getTopStates({ year: latestYear, patterns })
      : await getTopStates({ year: latestYear, patterns: ["%"] });

    draftAnswer =
      rows.length > 0
        ? buildStateAnswer({
            year: latestYear,
            rows: rows as StateResultRow[],
            displayName: isDrugSpecific ? displayName : "all loaded provider-drug rows",
          })
        : buildNoRowsAnswer({ year: latestYear, displayName, analysisType });

    sqlQuery = isDrugSpecific
      ? `Grouped cms_part_d_prescribers by provider_state for ${displayName} in ${latestYear}; WHERE brand_name/generic_name ILIKE resolved aliases; ORDER BY sum(total_drug_cost) DESC; LIMIT ${limit}.`
      : `Grouped cms_part_d_prescribers by provider_state in ${latestYear}; ORDER BY sum(total_drug_cost) DESC; LIMIT ${limit}.`;
  } else if (analysisType === "specialty") {
    rows = isDrugSpecific
      ? await getTopSpecialties({ year: latestYear, patterns })
      : await getTopSpecialties({ year: latestYear, patterns: ["%"] });

    draftAnswer =
      rows.length > 0
        ? buildSpecialtyAnswer({
            year: latestYear,
            rows: rows as SpecialtyResultRow[],
            displayName: isDrugSpecific ? displayName : "all loaded provider-drug rows",
          })
        : buildNoRowsAnswer({ year: latestYear, displayName, analysisType });

    sqlQuery = isDrugSpecific
      ? `Grouped cms_part_d_prescribers by provider_specialty for ${displayName} in ${latestYear}; WHERE brand_name/generic_name ILIKE resolved aliases; ORDER BY sum(total_drug_cost) DESC; LIMIT ${limit}.`
      : `Grouped cms_part_d_prescribers by provider_specialty in ${latestYear}; ORDER BY sum(total_drug_cost) DESC; LIMIT ${limit}.`;
  } else {
    rows = isDrugSpecific
      ? await getTopProviders({ year: latestYear, patterns })
      : await getGlobalTopProviders(latestYear);

    draftAnswer =
      rows.length > 0
        ? buildProviderAnswer({
            year: latestYear,
            rows: rows as ProviderResultRow[],
            displayName: isDrugSpecific ? displayName : "all loaded provider-drug rows",
          })
        : buildNoRowsAnswer({ year: latestYear, displayName, analysisType });

    sqlQuery = isDrugSpecific
      ? `Grouped cms_part_d_prescribers by NPI/provider for ${displayName} in ${latestYear}; WHERE brand_name/generic_name ILIKE resolved aliases; ORDER BY sum(total_drug_cost) DESC; LIMIT ${limit}.`
      : `Grouped cms_part_d_prescribers by NPI/provider in ${latestYear}; ORDER BY sum(total_drug_cost) DESC; LIMIT ${limit}.`;
  }

  const composed = await composePharmaAnswer({
    question,
    draftAnswer,
    sqlQuery,
    rows,
    sources,
  });

  return {
    answer: composed.answer,
    rows,
    sqlQuery,
    sources,
    entities: {
      detectedDrug: drug,
      analysisType,
      latestYear,
      drugFilterApplied: isDrugSpecific,
      resolvedDrugPatterns: patterns,
    },
    route: "SQL_ONLY" as const,
    composer: composed.trace,
  };
}

export const answerPartDPrescriberAnalysisQuestion = answerPartDPrescriberQuestion;
export const answerPrescriberQuestion = answerPartDPrescriberQuestion;

import { sql } from "../db/client";
import type { SourceEvidence } from "../../types/evidence";
import {
  resolveDrugEntity,
  extractRequestedYears,
  containsAnyNormalized,
  type ResolvedDrugEntity,
} from "./pharmaEntityResolver";

type SpendingAgentResult = {
  answer: string;
  rows: Record<string, string | number>[];
  sqlQuery: string;
  sources: SourceEvidence[];
  entities: Record<string, unknown>;
};

type YearRow = {
  year: number;
};

type TopSpendingRow = {
  brand_name: string | null;
  generic_name: string | null;
  manufacturer: string | null;
  total_spending: string;
  total_claims: string | null;
  total_beneficiaries: string | null;
};

type OverallYearRow = {
  year: number;
  total_spending: string;
  total_claims: string | null;
  total_beneficiaries: string | null;
  drug_count: number;
  manufacturer_count: number;
};

type DrugTrendRow = {
  year: number;
  brand_names: string | null;
  generic_names: string | null;
  manufacturers: string | null;
  total_spending: string;
  total_claims: string | null;
  total_beneficiaries: string | null;
};

type IncreaseRow = {
  brand_name: string | null;
  generic_name: string | null;
  start_year_spending: string;
  end_year_spending: string;
  spending_increase: string;
  percent_increase: string | null;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function formatCurrency(value: unknown) {
  const numericValue = toNumber(value);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(numericValue);
}

function formatNumber(value: unknown) {
  const numericValue = toNumber(value);

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(numericValue);
}

function safePercent(value: unknown) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) return "not available";

  return `${numericValue.toFixed(1)}%`;
}

function markdownTable(headers: string[], rows: (string | number)[][]) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell)).join(" | ")} |`),
  ].join("\n");
}

function buildSqlSource({
  title,
  excerpt,
}: {
  title: string;
  excerpt: string;
}): SourceEvidence {
  return {
    id: "cms-part-d-spending-sql",
    title,
    dataset: "CMS Medicare Part D Spending by Drug",
    score: 1,
    status: "used",
    excerpt,
    metadata: [
      "Citation: [SQL-1]",
      "Source: loaded cms_part_d_spending table in Neon",
      "Data type: public CMS Medicare Part D gross drug spending",
    ],
    citationLabel: "SQL-1",
    citationType: "sql",
  };
}

function buildLimitSource(): SourceEvidence {
  return {
    id: "cms-part-d-spending-limitation",
    title: "CMS Part D spending limitation",
    dataset: "System limitation",
    score: 1,
    status: "used",
    excerpt:
      "This is public Medicare Part D gross drug spending. It is not private pharma revenue, profit, rebate-adjusted net revenue, sales-rep performance, CRM performance, contract loss, discounts, rebates, or margin.",
    metadata: [
      "Citation: [LIMIT-1]",
      "Scope: loaded public CMS Part D spending data only",
    ],
    citationLabel: "LIMIT-1",
    citationType: "limit",
  };
}

function withStandardSources(title: string, excerpt: string) {
  return [
    buildSqlSource({ title, excerpt }),
    buildLimitSource(),
  ];
}

async function getAvailableYears() {
  const rows = await sql<YearRow[]>`
    select distinct year
    from cms_part_d_spending
    where year is not null
    order by year asc
  `;

  return rows.map((row) => Number(row.year)).filter(Number.isFinite);
}

function chooseDisplayYear(question: string, availableYears: number[]) {
  const requested = extractRequestedYears(question).requestedYear;

  if (requested && availableYears.includes(requested)) {
    return requested;
  }

  return availableYears[availableYears.length - 1] ?? null;
}

async function loadExampleDrugs() {
  const rows = await sql<{ brand_name: string | null }[]>`
    select distinct brand_name
    from cms_part_d_spending
    where brand_name is not null
      and lower(coalesce(manufacturer, '')) <> 'overall'
    order by brand_name asc
    limit 8
  `;

  return rows.map((row) => clean(row.brand_name)).filter(Boolean);
}

function noDrugRowsAnswer({
  drug,
  examples,
}: {
  drug: ResolvedDrugEntity | null;
  examples: string[];
}) {
  const displayDrug = drug?.canonical || "the requested drug";
  const exampleText = examples.length
    ? [``, `Loaded examples you can try:`, ``, ...examples.map((item) => `- ${item}`)].join("\n")
    : "";

  const answer = [
    `I could not find CMS Part D spending rows for ${displayDrug} in the currently loaded Neon table. [LIMIT-1]`,
    "",
    "This is a dataset coverage limitation, not a general statement about whether the drug exists.",
    exampleText,
    "",
    "Data limitation: This is public Medicare Part D gross drug spending. It is not private pharma revenue, profit, rebate-adjusted net revenue, sales-rep performance, CRM performance, contract loss, discounts, rebates, or margin. [LIMIT-1]",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    answer,
    rows: [],
    sqlQuery:
      "Filtered cms_part_d_spending by requested brand/generic aliases. No matching rows were returned.",
    sources: withStandardSources(
      "CMS Part D spending lookup returned zero rows",
      `No loaded CMS Part D spending rows matched ${displayDrug}.`
    ),
    entities: {
      drug,
      matchStatus: "no_rows_after_drug_filter",
    },
  } satisfies SpendingAgentResult;
}

async function loadOverallRows() {
  return sql<OverallYearRow[]>`
    select
      year::int as year,
      sum(coalesce(total_spending, 0))::numeric::text as total_spending,
      sum(coalesce(total_claims, 0))::numeric::text as total_claims,
      sum(coalesce(total_beneficiaries, 0))::numeric::text as total_beneficiaries,
      count(distinct brand_name)::int as drug_count,
      count(distinct manufacturer)::int as manufacturer_count
    from cms_part_d_spending
    where lower(coalesce(manufacturer, '')) <> 'overall'
    group by year
    order by year asc
  `;
}

async function loadTopDrugsForYear(year: number) {
  return sql<TopSpendingRow[]>`
    select
      brand_name,
      generic_name,
      manufacturer,
      sum(coalesce(total_spending, 0))::numeric::text as total_spending,
      sum(coalesce(total_claims, 0))::numeric::text as total_claims,
      sum(coalesce(total_beneficiaries, 0))::numeric::text as total_beneficiaries
    from cms_part_d_spending
    where year = ${year}
      and brand_name is not null
      and lower(coalesce(manufacturer, '')) <> 'overall'
    group by brand_name, generic_name, manufacturer
    order by sum(coalesce(total_spending, 0)) desc
    limit 10
  `;
}

export async function answerOverallPartDSpendingQuestion(
  question: string
): Promise<SpendingAgentResult> {
  const availableYears = await getAvailableYears();
  const displayYear = chooseDisplayYear(question, availableYears);

  if (!displayYear) {
    return {
      answer:
        "I could not find any loaded CMS Part D spending years in the Neon table. [LIMIT-1]\n\nData limitation: This answer is limited to loaded public CMS Part D spending data. [LIMIT-1]",
      rows: [],
      sqlQuery: "select distinct year from cms_part_d_spending",
      sources: withStandardSources(
        "CMS Part D spending year check",
        "No loaded CMS Part D spending years were found."
      ),
      entities: {
        availableYears,
        displayYear,
      },
    };
  }

  const overallRows = await loadOverallRows();
  const topRows = await loadTopDrugsForYear(displayYear);
  const selectedOverall = overallRows.find((row) => Number(row.year) === displayYear);

  const hasMultiYearTrend = overallRows.length >= 2;

  const trendTable = markdownTable(
    ["Year", "Total Spending", "Claims", "Beneficiaries", "Drugs"],
    overallRows.map((row) => [
      row.year,
      formatCurrency(row.total_spending),
      formatNumber(row.total_claims),
      formatNumber(row.total_beneficiaries),
      formatNumber(row.drug_count),
    ])
  );

  const topTable = markdownTable(
    ["Rank", "Drug", "Generic", "Manufacturer", "Total Spending", "Claims"],
    topRows.map((row, index) => [
      index + 1,
      row.brand_name || "Unknown",
      row.generic_name || "Unknown",
      row.manufacturer || "Unknown",
      formatCurrency(row.total_spending),
      formatNumber(row.total_claims),
    ])
  );

  const summaryLine = selectedOverall
    ? `For ${displayYear}, the loaded CMS Part D spending table contains ${formatCurrency(
        selectedOverall.total_spending
      )} in gross spending across ${formatNumber(
        selectedOverall.drug_count
      )} drugs and ${formatNumber(selectedOverall.manufacturer_count)} manufacturers. [SQL-1]`
    : `For ${displayYear}, the loaded CMS Part D spending table has available spending rows. [SQL-1]`;

  const trendCaveat = hasMultiYearTrend
    ? "Because multiple years are loaded, the table below shows the overall year-by-year spending trend. [SQL-1]"
    : `Only ${displayYear} is currently loaded, so a true year-over-year trend cannot be calculated. I am showing the overall ${displayYear} spending overview and top drugs instead. [SQL-1]`;

  const answer = [
    summaryLine,
    "",
    trendCaveat,
    "",
    "### Overall loaded spending by year",
    trendTable,
    "",
    `### Top spending drugs in ${displayYear}`,
    topTable,
    "",
    "Data limitation: This is public Medicare Part D gross drug spending. It is not private pharma revenue, profit, rebate-adjusted net revenue, sales-rep performance, CRM performance, contract loss, discounts, rebates, or margin. [LIMIT-1]",
  ].join("\n");

  return {
    answer,
    rows: [
      ...overallRows.map((row) => ({
        year: row.year,
        total_spending: toNumber(row.total_spending),
        total_claims: toNumber(row.total_claims),
        total_beneficiaries: toNumber(row.total_beneficiaries),
        drug_count: row.drug_count,
        manufacturer_count: row.manufacturer_count,
      })),
      ...topRows.map((row, index) => ({
        rank: index + 1,
        year: displayYear,
        brand_name: row.brand_name || "Unknown",
        generic_name: row.generic_name || "Unknown",
        manufacturer: row.manufacturer || "Unknown",
        total_spending: toNumber(row.total_spending),
        total_claims: toNumber(row.total_claims),
        total_beneficiaries: toNumber(row.total_beneficiaries),
      })),
    ],
    sqlQuery:
      "Grouped cms_part_d_spending overall by year and ranked top drugs for the selected loaded year.",
    sources: withStandardSources(
      "CMS Part D overall spending overview",
      hasMultiYearTrend
        ? "Overall CMS Part D spending grouped by year plus top drugs for the selected year."
        : `Only ${displayYear} is loaded, so the answer shows loaded-year overview plus top drugs instead of a year-over-year trend.`
    ),
    entities: {
      displayYear,
      availableYears,
      mode: hasMultiYearTrend ? "overall_year_over_year_trend" : "single_year_overview",
    },
  };
}

export async function answerPartDTopSpendingQuestion(
  question: string
): Promise<SpendingAgentResult> {
  const availableYears = await getAvailableYears();
  const displayYear = chooseDisplayYear(question, availableYears);

  if (!displayYear) {
    return answerOverallPartDSpendingQuestion(question);
  }

  const rows = await loadTopDrugsForYear(displayYear);

  const table = markdownTable(
    ["Rank", "Drug", "Generic", "Manufacturer", "Total Spending", "Claims", "Beneficiaries"],
    rows.map((row, index) => [
      index + 1,
      row.brand_name || "Unknown",
      row.generic_name || "Unknown",
      row.manufacturer || "Unknown",
      formatCurrency(row.total_spending),
      formatNumber(row.total_claims),
      formatNumber(row.total_beneficiaries),
    ])
  );

  const answer = [
    `Based on loaded CMS Part D spending data, these drugs had the highest total gross spending in ${displayYear}. [SQL-1]`,
    "",
    table,
    "",
    "Data limitation: This is public Medicare Part D gross drug spending. It is not private pharma revenue, profit, rebate-adjusted net revenue, sales-rep performance, CRM performance, contract loss, discounts, rebates, or margin. [LIMIT-1]",
  ].join("\n");

  return {
    answer,
    rows: rows.map((row, index) => ({
      rank: index + 1,
      year: displayYear,
      brand_name: row.brand_name || "Unknown",
      generic_name: row.generic_name || "Unknown",
      manufacturer: row.manufacturer || "Unknown",
      total_spending: toNumber(row.total_spending),
      total_claims: toNumber(row.total_claims),
      total_beneficiaries: toNumber(row.total_beneficiaries),
    })),
    sqlQuery:
      "Grouped cms_part_d_spending by brand/generic/manufacturer for selected year, ordered by sum(total_spending) desc, limit 10.",
    sources: withStandardSources(
      "CMS Part D highest spending drugs",
      `Top CMS Part D gross spending drugs in ${displayYear}.`
    ),
    entities: {
      displayYear,
      availableYears,
    },
  };
}

export async function answerPartDDrugTrendQuestion(
  question: string
): Promise<SpendingAgentResult> {
  const drug = resolveDrugEntity(question);

  if (!drug) {
    return answerOverallPartDSpendingQuestion(question);
  }

  const rows = await sql<DrugTrendRow[]>`
    select
      year::int as year,
      string_agg(distinct brand_name, ', ' order by brand_name) as brand_names,
      string_agg(distinct generic_name, ', ' order by generic_name) as generic_names,
      string_agg(distinct manufacturer, ', ' order by manufacturer) as manufacturers,
      sum(coalesce(total_spending, 0))::numeric::text as total_spending,
      sum(coalesce(total_claims, 0))::numeric::text as total_claims,
      sum(coalesce(total_beneficiaries, 0))::numeric::text as total_beneficiaries
    from cms_part_d_spending
    where lower(coalesce(manufacturer, '')) <> 'overall'
      and (
        brand_name ilike any(${drug.patterns})
        or generic_name ilike any(${drug.patterns})
      )
    group by year
    order by year asc
  `;

  if (rows.length === 0) {
    const examples = await loadExampleDrugs();
    return noDrugRowsAnswer({ drug, examples });
  }

  const hasMultiYearTrend = rows.length >= 2;
  const latest = rows[rows.length - 1];

  const table = markdownTable(
    ["Year", "Drug Match", "Total Spending", "Claims", "Beneficiaries"],
    rows.map((row) => [
      row.year,
      row.brand_names || drug.canonical,
      formatCurrency(row.total_spending),
      formatNumber(row.total_claims),
      formatNumber(row.total_beneficiaries),
    ])
  );

  const trendCaveat = hasMultiYearTrend
    ? `The loaded rows support a year-by-year spending trend for ${drug.canonical}. [SQL-1]`
    : `Only ${latest.year} is currently loaded for ${drug.canonical}, so a true year-over-year trend cannot be calculated. I am showing the loaded-year spending value instead. [SQL-1]`;

  const answer = [
    `Based on loaded CMS Part D spending data, ${drug.canonical} had ${formatCurrency(
      latest.total_spending
    )} in gross Part D spending in ${latest.year}. [SQL-1]`,
    "",
    trendCaveat,
    "",
    table,
    "",
    "Data limitation: This is public Medicare Part D gross drug spending. It is not private pharma revenue, profit, rebate-adjusted net revenue, sales-rep performance, CRM performance, contract loss, discounts, rebates, or margin. [LIMIT-1]",
  ].join("\n");

  return {
    answer,
    rows: rows.map((row) => ({
      year: row.year,
      brand_names: row.brand_names || drug.canonical,
      generic_names: row.generic_names || "",
      manufacturers: row.manufacturers || "",
      total_spending: toNumber(row.total_spending),
      total_claims: toNumber(row.total_claims),
      total_beneficiaries: toNumber(row.total_beneficiaries),
    })),
    sqlQuery:
      "Filtered cms_part_d_spending by requested drug brand/generic aliases, grouped by year, ordered ascending.",
    sources: withStandardSources(
      "CMS Part D drug spending trend",
      `CMS Part D spending trend lookup for ${drug.canonical}.`
    ),
    entities: {
      drug,
      mode: hasMultiYearTrend ? "drug_year_over_year_trend" : "single_year_drug_value",
    },
  };
}

export async function answerPartDSpendingIncreaseQuestion(
  question: string
): Promise<SpendingAgentResult> {
  const availableYears = await getAvailableYears();

  if (availableYears.length < 2) {
    const overview = await answerOverallPartDSpendingQuestion(question);

    return {
      ...overview,
      answer: [
        `I cannot calculate a spending-increase ranking because only ${availableYears[0] ?? "one year"} is currently loaded. [SQL-1]`,
        "",
        overview.answer,
      ].join("\n"),
      entities: {
        ...overview.entities,
        requestedMode: "spending_increase",
        limitationReason: "less_than_two_years_loaded",
      },
    };
  }

  const years = extractRequestedYears(question);
  const startYear = years.startYear && availableYears.includes(years.startYear)
    ? years.startYear
    : availableYears[availableYears.length - 2];
  const endYear = years.endYear && availableYears.includes(years.endYear)
    ? years.endYear
    : availableYears[availableYears.length - 1];

  const rows = await sql<IncreaseRow[]>`
    with by_drug_year as (
      select
        brand_name,
        generic_name,
        year,
        sum(coalesce(total_spending, 0)) as total_spending
      from cms_part_d_spending
      where year in (${startYear}, ${endYear})
        and brand_name is not null
        and lower(coalesce(manufacturer, '')) <> 'overall'
      group by brand_name, generic_name, year
    ), pivoted as (
      select
        brand_name,
        generic_name,
        sum(case when year = ${startYear} then total_spending else 0 end) as start_year_spending,
        sum(case when year = ${endYear} then total_spending else 0 end) as end_year_spending
      from by_drug_year
      group by brand_name, generic_name
    )
    select
      brand_name,
      generic_name,
      start_year_spending::numeric::text,
      end_year_spending::numeric::text,
      (end_year_spending - start_year_spending)::numeric::text as spending_increase,
      case
        when start_year_spending > 0
          then (((end_year_spending - start_year_spending) / start_year_spending) * 100)::numeric::text
        else null
      end as percent_increase
    from pivoted
    where end_year_spending > start_year_spending
    order by end_year_spending - start_year_spending desc
    limit 10
  `;

  const table = markdownTable(
    ["Rank", "Drug", "Generic", `${startYear} Spending`, `${endYear} Spending`, "Increase", "% Increase"],
    rows.map((row, index) => [
      index + 1,
      row.brand_name || "Unknown",
      row.generic_name || "Unknown",
      formatCurrency(row.start_year_spending),
      formatCurrency(row.end_year_spending),
      formatCurrency(row.spending_increase),
      safePercent(row.percent_increase),
    ])
  );

  const answer = [
    `Based on loaded CMS Part D spending data, these drugs had the largest gross spending increase from ${startYear} to ${endYear}. [SQL-1]`,
    "",
    table,
    "",
    "Data limitation: This is public Medicare Part D gross drug spending. It is not private pharma revenue, profit, rebate-adjusted net revenue, sales-rep performance, CRM performance, contract loss, discounts, rebates, or margin. [LIMIT-1]",
  ].join("\n");

  return {
    answer,
    rows: rows.map((row, index) => ({
      rank: index + 1,
      brand_name: row.brand_name || "Unknown",
      generic_name: row.generic_name || "Unknown",
      start_year: startYear,
      end_year: endYear,
      start_year_spending: toNumber(row.start_year_spending),
      end_year_spending: toNumber(row.end_year_spending),
      spending_increase: toNumber(row.spending_increase),
      percent_increase: toNumber(row.percent_increase),
    })),
    sqlQuery:
      "Compared cms_part_d_spending grouped by brand/generic between two loaded years and ordered by absolute spending increase.",
    sources: withStandardSources(
      "CMS Part D spending increase ranking",
      `CMS Part D gross spending increase from ${startYear} to ${endYear}.`
    ),
    entities: {
      startYear,
      endYear,
      availableYears,
    },
  };
}

export async function answerPartDSpendingTrendQuestion(question: string) {
  return answerPartDDrugTrendQuestion(question);
}

export async function answerPartDSpendingQuestion(question: string) {
  if (containsAnyNormalized(question, ["increase", "growth", "grew", "biggest increase"])) {
    return answerPartDSpendingIncreaseQuestion(question);
  }

  if (containsAnyNormalized(question, ["top", "highest", "most", "a lot", "costliest", "expensive"])) {
    return answerPartDTopSpendingQuestion(question);
  }

  return answerPartDDrugTrendQuestion(question);
}

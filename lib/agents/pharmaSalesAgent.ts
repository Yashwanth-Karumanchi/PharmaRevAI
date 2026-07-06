import { sql } from "@/lib/db/client";
import {
  buildSkippedComposerTrace,
  composePharmaAnswer,
} from "@/lib/agents/llmComposer";
import type { SourceEvidence } from "@/types/evidence";
import {
  clean,
  commonLimitSource,
  formatNumber,
  includesAny,
  isPollutedCategory,
  markdownTable,
  normalizeText,
} from "@/lib/agents/pharmaEntityResolver";

type YearRangeRow = {
  min_year: number | null;
  max_year: number | null;
};

type EntityCandidateRow = {
  value: string | null;
  entity_type: "drug" | "category";
};

type DetectedSalesEntity = {
  matchedName: string;
  entityType: "drug" | "category";
  score: number;
};

type SalesResultRow = Record<string, string | number | null>;

type AnalysisType =
  | "top_quantity"
  | "quantity_drop"
  | "moving_average_forecast"
  | "monthly_seasonality"
  | "monthly_trend";

function salesLimitText() {
  return "Data limitation: Sales quantity data can show volume movement, demand concentration, seasonality, and simple trends. It does not prove profit, private revenue, sales-rep performance, deal loss, contract discounts, rebates, margin leakage, or CRM performance. [LIMIT-1]";
}

function buildSalesSources(): SourceEvidence[] {
  const limitText = salesLimitText();

  return [
    {
      id: "pharma-sales-source",
      title: "Public Pharma Sales Dataset",
      dataset: "Pharma Sales",
      score: 0.92,
      status: "used",
      citationLabel: "SQL-1",
      citationType: "sql",
      excerpt:
        "The SQL answer uses loaded public pharma sales records in Neon. The table stores sale date/month/year, product or ATC category, and quantity sold.",
      metadata: [
        "Table: pharma_sales",
        "Metric: quantity_sold",
        "Purpose: sales-volume trends, seasonality, quantity drops, and demand analysis",
      ],
    },
    commonLimitSource({
      id: "pharma-sales-limitation",
      title: "Pharma sales data limitation",
      dataset: "Pharma Sales",
      excerpt: limitText,
    }),
  ];
}

function scoreCandidate(question: string, candidate: string) {
  const q = normalizeText(question);
  const c = normalizeText(candidate);

  if (!c || c.length < 2 || isPollutedCategory(c)) return 0;
  if (q.includes(c)) return c.length + 100;

  const tokens = c.split(" ").filter((token) => token.length >= 3);
  const matched = tokens.filter((token) => q.includes(token));

  if (tokens.length > 0 && matched.length === tokens.length) {
    return c.length + 50;
  }

  return matched.length > 0 ? matched.join("").length : 0;
}

function formatDecimal(value: number) {
  if (!Number.isFinite(value)) return "not available";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function monthName(month: number) {
  return new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    new Date(Date.UTC(2024, month - 1, 1))
  );
}

function isDropQuestion(question: string) {
  return includesAny(question, ["drop", "decline", "decrease", "fell", "reduced", "down"]);
}

function isSeasonalityQuestion(question: string) {
  return includesAny(question, ["seasonality", "seasonal", "month", "monthly", "peak"]);
}

function isForecastQuestion(question: string) {
  return includesAny(question, ["forecast", "predict", "next month", "future"]);
}

function isTrendQuestion(question: string) {
  return includesAny(question, ["trend", "over time", "history", "timeline"]);
}

async function getYearRange() {
  const rows = await sql<YearRangeRow[]>`
    select
      min(sale_year)::int as min_year,
      max(sale_year)::int as max_year
    from pharma_sales
    where sale_year is not null
  `;

  return {
    minYear: rows[0]?.min_year ?? null,
    maxYear: rows[0]?.max_year ?? null,
  };
}

async function getSampleSuggestions() {
  const rows = await sql<{ label: string | null }[]>`
    select distinct coalesce(drug_name, atc_category) as label
    from pharma_sales
    where coalesce(drug_name, atc_category) is not null
      and upper(coalesce(atc_category, '')) not in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
    order by label asc
    limit 10
  `;

  return rows
    .map((row) => row.label)
    .filter((label): label is string => Boolean(label))
    .filter((label) => !isPollutedCategory(label));
}

async function detectEntityFromQuestion(question: string): Promise<DetectedSalesEntity | null> {
  const rows = await sql<EntityCandidateRow[]>`
    select distinct drug_name as value, 'drug'::text as entity_type
    from pharma_sales
    where drug_name is not null

    union

    select distinct atc_category as value, 'category'::text as entity_type
    from pharma_sales
    where atc_category is not null
      and upper(atc_category) not in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
  `;

  const matches: DetectedSalesEntity[] = [];

  for (const row of rows) {
    if (!row.value || isPollutedCategory(row.value)) continue;

    const score = scoreCandidate(question, row.value);

    if (score > 0) {
      matches.push({
        matchedName: row.value,
        entityType: row.entity_type,
        score,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  return matches[0] ?? null;
}

async function getTopVolumeRows(year: number | null) {
  if (year) {
    return sql<SalesResultRow[]>`
      select
        coalesce(drug_name, atc_category, 'Unknown') as label,
        max(drug_name) as drug_name,
        max(atc_category) as atc_category,
        sale_year,
        sum(quantity_sold)::numeric::text as quantity_sold,
        count(*)::int::text as row_count
      from pharma_sales
      where sale_year = ${year}
        and quantity_sold is not null
        and upper(coalesce(atc_category, '')) not in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
      group by coalesce(drug_name, atc_category, 'Unknown'), sale_year
      order by sum(quantity_sold) desc nulls last
      limit 10
    `;
  }

  return sql<SalesResultRow[]>`
    select
      coalesce(drug_name, atc_category, 'Unknown') as label,
      max(drug_name) as drug_name,
      max(atc_category) as atc_category,
      null::int as sale_year,
      sum(quantity_sold)::numeric::text as quantity_sold,
      count(*)::int::text as row_count
    from pharma_sales
    where quantity_sold is not null
      and upper(coalesce(atc_category, '')) not in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
    group by coalesce(drug_name, atc_category, 'Unknown')
    order by sum(quantity_sold) desc nulls last
    limit 10
  `;
}

async function getDropRows(minYear: number, maxYear: number) {
  return sql<SalesResultRow[]>`
    with yearly as (
      select
        coalesce(drug_name, atc_category, 'Unknown') as label,
        sale_year,
        sum(quantity_sold) as quantity
      from pharma_sales
      where sale_year in (${minYear}, ${maxYear})
        and quantity_sold is not null
        and upper(coalesce(atc_category, '')) not in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
      group by coalesce(drug_name, atc_category, 'Unknown'), sale_year
    ),
    paired as (
      select
        first_year.label,
        first_year.quantity as first_year_quantity,
        latest_year.quantity as latest_year_quantity,
        latest_year.quantity - first_year.quantity as quantity_change,
        case
          when first_year.quantity = 0 then null
          else ((latest_year.quantity - first_year.quantity) / first_year.quantity) * 100
        end as percent_change
      from yearly first_year
      join yearly latest_year on latest_year.label = first_year.label
      where first_year.sale_year = ${minYear}
        and latest_year.sale_year = ${maxYear}
    )
    select
      label,
      ${minYear}::int as first_year,
      ${maxYear}::int as latest_year,
      first_year_quantity::numeric::text as first_year_quantity,
      latest_year_quantity::numeric::text as latest_year_quantity,
      quantity_change::numeric::text as quantity_change,
      percent_change::numeric::text as percent_change
    from paired
    order by quantity_change asc nulls last
    limit 10
  `;
}

function entityWhere(entity: DetectedSalesEntity | null) {
  if (!entity) return sql``;

  if (entity.entityType === "drug") {
    return sql`and lower(drug_name) = lower(${entity.matchedName})`;
  }

  return sql`and lower(atc_category) = lower(${entity.matchedName})`;
}

async function getSeasonalityRows(entity: DetectedSalesEntity | null) {
  return sql<SalesResultRow[]>`
    select
      sale_month,
      sum(quantity_sold)::numeric::text as quantity_sold,
      avg(quantity_sold)::numeric::text as average_quantity,
      count(*)::int::text as row_count
    from pharma_sales
    where sale_month is not null
      and quantity_sold is not null
      and upper(coalesce(atc_category, '')) not in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
      ${entityWhere(entity)}
    group by sale_month
    order by sum(quantity_sold) desc nulls last
    limit 12
  `;
}

async function getTrendRows(entity: DetectedSalesEntity | null) {
  return sql<SalesResultRow[]>`
    select
      sale_year,
      sale_month,
      sum(quantity_sold)::numeric::text as quantity_sold,
      count(*)::int::text as row_count
    from pharma_sales
    where sale_year is not null
      and sale_month is not null
      and quantity_sold is not null
      and upper(coalesce(atc_category, '')) not in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
      ${entityWhere(entity)}
    group by sale_year, sale_month
    order by sale_year asc, sale_month asc
    limit 60
  `;
}

function buildTopVolumeAnswer({
  year,
  rows,
}: {
  year: number | null;
  rows: SalesResultRow[];
}) {
  const table = markdownTable(
    ["Rank", "Product / Category", "Year", "Quantity Sold", "Rows"],
    rows.map((row, index) => [
      index + 1,
      row.label || "Unknown",
      row.sale_year || year || "All loaded",
      formatNumber(Number(row.quantity_sold)),
      formatNumber(Number(row.row_count)),
    ])
  );

  return [
    `Based on the loaded pharma sales dataset, these products or categories had the highest sales quantity${year ? ` in ${year}` : ""}. [SQL-1]`,
    "",
    table,
    "",
    salesLimitText(),
  ].join("\n");
}

function buildDropAnswer({
  minYear,
  maxYear,
  rows,
}: {
  minYear: number;
  maxYear: number;
  rows: SalesResultRow[];
}) {
  const table = markdownTable(
    ["Rank", "Product / Category", `${minYear} Quantity`, `${maxYear} Quantity`, "Change", "% Change"],
    rows.map((row, index) => [
      index + 1,
      row.label || "Unknown",
      formatNumber(Number(row.first_year_quantity)),
      formatNumber(Number(row.latest_year_quantity)),
      formatNumber(Number(row.quantity_change)),
      row.percent_change ? `${formatDecimal(Number(row.percent_change))}%` : "not available",
    ])
  );

  return [
    `Based on the loaded pharma sales dataset, these products or categories had the largest quantity drops from ${minYear} to ${maxYear}. [SQL-1]`,
    "",
    table,
    "",
    salesLimitText(),
  ].join("\n");
}

function buildSeasonalityAnswer({
  entity,
  rows,
}: {
  entity: DetectedSalesEntity | null;
  rows: SalesResultRow[];
}) {
  const subject = entity ? entity.matchedName : "the loaded pharma sales dataset";

  const table = markdownTable(
    ["Rank", "Month", "Quantity Sold", "Average Quantity", "Rows"],
    rows.map((row, index) => [
      index + 1,
      monthName(Number(row.sale_month)),
      formatNumber(Number(row.quantity_sold)),
      formatDecimal(Number(row.average_quantity)),
      formatNumber(Number(row.row_count)),
    ])
  );

  return [
    `Based on the loaded pharma sales dataset, these months had the highest sales quantity for ${subject}. [SQL-1]`,
    "",
    table,
    "",
    salesLimitText(),
  ].join("\n");
}

function buildTrendAnswer({
  entity,
  rows,
}: {
  entity: DetectedSalesEntity | null;
  rows: SalesResultRow[];
}) {
  const subject = entity ? entity.matchedName : "the loaded pharma sales dataset";
  const recentRows = rows.slice(-12);

  const table = markdownTable(
    ["Period", "Quantity Sold", "Rows"],
    recentRows.map((row) => [
      `${row.sale_year}-${String(row.sale_month).padStart(2, "0")}`,
      formatNumber(Number(row.quantity_sold)),
      formatNumber(Number(row.row_count)),
    ])
  );

  return [
    `Based on the loaded pharma sales dataset, this is the recent monthly sales-quantity trend for ${subject}. [SQL-1]`,
    "",
    table,
    "",
    salesLimitText(),
  ].join("\n");
}

function buildForecastAnswer({
  entity,
  rows,
}: {
  entity: DetectedSalesEntity | null;
  rows: SalesResultRow[];
}) {
  const subject = entity ? entity.matchedName : "the loaded pharma sales dataset";
  const sortedRows = [...rows].sort((a, b) => {
    const aKey = Number(a.sale_year) * 100 + Number(a.sale_month);
    const bKey = Number(b.sale_year) * 100 + Number(b.sale_month);
    return aKey - bKey;
  });

  const recentRows = sortedRows.slice(-3);
  const forecast =
    recentRows.reduce((sum, row) => sum + Number(row.quantity_sold), 0) /
    Math.max(recentRows.length, 1);

  const table = markdownTable(
    ["Period", "Quantity Sold"],
    sortedRows.slice(-6).map((row) => [
      `${row.sale_year}-${String(row.sale_month).padStart(2, "0")}`,
      formatNumber(Number(row.quantity_sold)),
    ])
  );

  return [
    `Using a simple 3-month moving-average baseline, the next-month quantity forecast for ${subject} is approximately ${formatNumber(forecast)}. [SQL-1]`,
    "",
    table,
    "",
    "This is a transparent baseline, not a production forecasting model.",
    "",
    salesLimitText(),
  ].join("\n");
}

function buildNoRowsAnswer(entity: DetectedSalesEntity | null) {
  const subject = entity ? entity.matchedName : "the requested sales query";

  return [
    `I could not find loaded pharma_sales rows for ${subject} after applying the requested filters. [LIMIT-1]`,
    "",
    salesLimitText(),
  ].join("\n");
}

export async function answerPharmaSalesQuestion(question: string) {
  const { minYear, maxYear } = await getYearRange();
  const sources = buildSalesSources();

  if (!minYear || !maxYear) {
    const suggestions = await getSampleSuggestions();

    return {
      answer: `Pharma sales data is not loaded yet.\n\nLoaded suggestions right now:\n${
        suggestions.length > 0 ? suggestions.map((item) => `- ${item}`).join("\n") : "- None"
      } [LIMIT-1]`,
      rows: [],
      sqlQuery:
        "Pharma sales agent could not run because pharma_sales has no loaded sale_year values.",
      sources,
      entities: {
        detectedEntity: null,
        minYear,
        maxYear,
      },
      route: "SQL_ONLY" as const,
      composer: buildSkippedComposerTrace("Pharma sales data is not loaded yet."),
    };
  }

  const detectedEntity = await detectEntityFromQuestion(question);

  let rows: SalesResultRow[];
  let draftAnswer: string;
  let sqlQuery: string;
  let analysisType: AnalysisType;

  if (isDropQuestion(question)) {
    rows = await getDropRows(minYear, maxYear);
    draftAnswer = rows.length > 0 ? buildDropAnswer({ minYear, maxYear, rows }) : buildNoRowsAnswer(detectedEntity);
    analysisType = "quantity_drop";
    sqlQuery = `Compared sum(quantity_sold) by product/category between ${minYear} and ${maxYear}, excluded polluted categories, ordered by quantity_change ASC, limit 10.`;
  } else if (isForecastQuestion(question)) {
    rows = await getTrendRows(detectedEntity);
    draftAnswer = rows.length > 0 ? buildForecastAnswer({ entity: detectedEntity, rows }) : buildNoRowsAnswer(detectedEntity);
    analysisType = "moving_average_forecast";
    sqlQuery = detectedEntity
      ? `Grouped pharma_sales by sale_year/sale_month for ${detectedEntity.entityType}=${detectedEntity.matchedName}; used 3-month moving average.`
      : "Grouped pharma_sales by sale_year/sale_month across all loaded rows; used 3-month moving average.";
  } else if (isSeasonalityQuestion(question)) {
    rows = await getSeasonalityRows(detectedEntity);
    draftAnswer = rows.length > 0 ? buildSeasonalityAnswer({ entity: detectedEntity, rows }) : buildNoRowsAnswer(detectedEntity);
    analysisType = "monthly_seasonality";
    sqlQuery = detectedEntity
      ? `Grouped pharma_sales by sale_month for ${detectedEntity.entityType}=${detectedEntity.matchedName}, excluded polluted categories, ordered by sum(quantity_sold) DESC.`
      : "Grouped pharma_sales by sale_month across loaded rows, excluded polluted categories, ordered by sum(quantity_sold) DESC.";
  } else if (isTrendQuestion(question) || detectedEntity) {
    rows = await getTrendRows(detectedEntity);
    draftAnswer = rows.length > 0 ? buildTrendAnswer({ entity: detectedEntity, rows }) : buildNoRowsAnswer(detectedEntity);
    analysisType = "monthly_trend";
    sqlQuery = detectedEntity
      ? `Grouped pharma_sales by sale_year/sale_month for ${detectedEntity.entityType}=${detectedEntity.matchedName}, excluded polluted categories, ordered chronologically.`
      : "Grouped pharma_sales by sale_year/sale_month across loaded rows, excluded polluted categories, ordered chronologically.";
  } else {
    rows = await getTopVolumeRows(maxYear);
    draftAnswer = rows.length > 0 ? buildTopVolumeAnswer({ year: maxYear, rows }) : buildNoRowsAnswer(null);
    analysisType = "top_quantity";
    sqlQuery = `Grouped pharma_sales by product/category for ${maxYear}, excluded polluted categories, ordered by sum(quantity_sold) DESC, limit 10.`;
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
      detectedEntity,
      analysisType,
      datasetTable: "pharma_sales",
      minYear,
      maxYear,
    },
    route: "SQL_ONLY" as const,
    composer: composed.trace,
  };
}

export const answerPharmaSalesAnalysisQuestion = answerPharmaSalesQuestion;
export const answerSalesQuestion = answerPharmaSalesQuestion;

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
  includesAny,
  markdownTable,
  normalizeText,
} from "@/lib/agents/pharmaEntityResolver";
import { extractRequestedLimitFromQuestions } from "./partDQuestionParser";

const limit = extractRequestedLimitFromQuestions({
  originalQuestion: extractedEntities?.originalQuestion,
  resolvedQuestion: question,
  defaultLimit: 10,
  maxLimit: 25,
});

type LatestYearRow = { program_year: number | null };

type PaymentRow = {
  label: string | null;
  payment_amount: string;
  payment_count: string;
  recipient_count: string;
};

type CandidateRow = {
  value: string | null;
  kind: "company" | "product";
};

type DetectedEntity = {
  value: string;
  kind: "company" | "product";
  score: number;
};

type AnalysisType = "company" | "specialty" | "state" | "product";

function openPaymentsLimitText() {
  return "Data limitation: Open Payments data reports public payments or transfers of value. It does not prove sales revenue, profit, prescribing causality, sales-rep performance, rebates, discounts, private contracts, CRM deals, or deal loss. The current ingestion may be a bounded loaded subset, so totals should be interpreted as loaded-data totals. [LIMIT-1]";
}

function buildOpenPaymentsSources(): SourceEvidence[] {
  const limitText = openPaymentsLimitText();

  return [
    {
      id: "open-payments-source",
      title: "CMS Open Payments General Payment Data",
      dataset: "CMS Open Payments",
      score: 0.95,
      status: "used",
      citationLabel: "SQL-1",
      citationType: "sql",
      excerpt:
        "The SQL answer uses CMS Open Payments General Payment records loaded into Neon. Open Payments reports payments and transfers of value made by reporting entities to covered recipients.",
      metadata: [
        "Table: open_payments",
        "Source: CMS Open Payments public data",
        "Metric: payment_amount",
        "Scope: loaded public records",
      ],
    },
    commonLimitSource({
      id: "open-payments-limitation",
      title: "Open Payments data limitation",
      dataset: "CMS Open Payments",
      excerpt: limitText,
    }),
  ];
}

function scoreCandidate(question: string, candidate: string) {
  const q = normalizeText(question);
  const c = normalizeText(candidate);

  if (!c || c.length < 3) return 0;
  if (q.includes(c)) return c.length + 100;

  const tokens = c.split(" ").filter((token) => token.length >= 4);
  const matched = tokens.filter((token) => q.includes(token));

  if (tokens.length > 0 && matched.length === tokens.length) {
    return c.length + 50;
  }

  return matched.length > 0 ? matched.join("").length : 0;
}

async function getLatestYear() {
  const rows = await sql<LatestYearRow[]>`
    select max(program_year)::int as program_year
    from open_payments
  `;

  return rows[0]?.program_year ?? null;
}

async function detectEntity(question: string): Promise<DetectedEntity | null> {
  const rows = await sql<CandidateRow[]>`
    select distinct company_name as value, 'company'::text as kind
    from open_payments
    where company_name is not null

    union

    select distinct drug_or_device_name as value, 'product'::text as kind
    from open_payments
    where drug_or_device_name is not null
      and drug_or_device_name <> ''
  `;

  const matches: DetectedEntity[] = [];

  for (const row of rows) {
    if (!row.value) continue;

    const score = scoreCandidate(question, row.value);

    if (score > 0) {
      matches.push({ value: row.value, kind: row.kind, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches[0] || null;
}

function inferAnalysisType(question: string, entity: DetectedEntity | null): AnalysisType {
  const normalized = normalizeText(question);

  if (includesAny(normalized, ["specialty", "specialties", "physician type", "provider type"])) {
    return "specialty";
  }

  if (includesAny(normalized, ["state", "states", "where", "geography", "location"])) {
    return "state";
  }

  if (includesAny(normalized, ["drug", "device", "product", "products"]) || entity?.kind === "product") {
    return "product";
  }

  return "company";
}

async function getPaymentRows({
  year,
  analysisType,
  entity,
}: {
  year: number;
  analysisType: AnalysisType;
  entity: DetectedEntity | null;
}) {
  const companyFilter = entity?.kind === "company" ? `%${entity.value}%` : null;
  const productFilter = entity?.kind === "product" ? `%${entity.value}%` : null;

  const baseWhere = sql`
    program_year = ${year}
    and payment_amount is not null
    ${companyFilter ? sql`and company_name ilike ${companyFilter}` : sql``}
    ${productFilter ? sql`and drug_or_device_name ilike ${productFilter}` : sql``}
  `;

  if (analysisType === "specialty") {
    return sql<PaymentRow[]>`
      select
        physician_specialty as label,
        sum(payment_amount)::numeric::text as payment_amount,
        count(*)::int::text as payment_count,
        count(distinct coalesce(recipient_npi, recipient_name))::int::text as recipient_count
      from open_payments
      where ${baseWhere}
        and physician_specialty is not null
      group by physician_specialty
      order by sum(payment_amount) desc nulls last
      limit ${limit}
    `;
  }

  if (analysisType === "state") {
    return sql<PaymentRow[]>`
      select
        recipient_state as label,
        sum(payment_amount)::numeric::text as payment_amount,
        count(*)::int::text as payment_count,
        count(distinct coalesce(recipient_npi, recipient_name))::int::text as recipient_count
      from open_payments
      where ${baseWhere}
        and recipient_state is not null
      group by recipient_state
      order by sum(payment_amount) desc nulls last
      limit ${limit}
    `;
  }

  if (analysisType === "product") {
    return sql<PaymentRow[]>`
      select
        drug_or_device_name as label,
        sum(payment_amount)::numeric::text as payment_amount,
        count(*)::int::text as payment_count,
        count(distinct coalesce(recipient_npi, recipient_name))::int::text as recipient_count
      from open_payments
      where ${baseWhere}
        and drug_or_device_name is not null
        and drug_or_device_name <> ''
      group by drug_or_device_name
      order by sum(payment_amount) desc nulls last
      limit ${limit}
    `;
  }

  return sql<PaymentRow[]>`
    select
      company_name as label,
      sum(payment_amount)::numeric::text as payment_amount,
      count(*)::int::text as payment_count,
      count(distinct coalesce(recipient_npi, recipient_name))::int::text as recipient_count
    from open_payments
    where ${baseWhere}
      and company_name is not null
    group by company_name
    order by sum(payment_amount) desc nulls last
    limit ${limit}
  `;
}

function analysisLabel(analysisType: AnalysisType) {
  if (analysisType === "specialty") return "physician specialties";
  if (analysisType === "state") return "recipient states";
  if (analysisType === "product") return "drug/device products";
  return "companies";
}

function buildAnswer({
  year,
  rows,
  analysisType,
  entity,
}: {
  year: number;
  rows: PaymentRow[];
  analysisType: AnalysisType;
  entity: DetectedEntity | null;
}) {
  const subject = entity
    ? `${analysisLabel(analysisType)} involving ${entity.value}`
    : analysisLabel(analysisType);

  const table = markdownTable(
    ["Rank", "Label", "Payment Amount", "Payments", "Recipients"],
    rows.map((row, index) => [
      index + 1,
      row.label || "Unknown",
      formatCurrency(Number(row.payment_amount)),
      formatNumber(Number(row.payment_count)),
      formatNumber(Number(row.recipient_count)),
    ])
  );

  return [
    `Based on loaded CMS Open Payments data, these are the top ${subject} by total payment amount for program year ${year}. [SQL-1]`,
    "",
    table,
    "",
    openPaymentsLimitText(),
  ].join("\n");
}

function buildNoRowsAnswer({
  year,
  entity,
  analysisType,
}: {
  year: number;
  entity: DetectedEntity | null;
  analysisType: AnalysisType;
}) {
  const subject = entity ? `${entity.value}` : analysisLabel(analysisType);

  return [
    `I could not find loaded CMS Open Payments rows for ${subject} in program year ${year} after applying the requested filters. [LIMIT-1]`,
    "",
    openPaymentsLimitText(),
  ].join("\n");
}

export async function answerOpenPaymentsQuestion(question: string) {
  const latestYear = await getLatestYear();
  const sources = buildOpenPaymentsSources();

  if (!latestYear) {
    return {
      answer:
        "CMS Open Payments data is not loaded yet. After loading it, I can answer company, specialty, state, and drug/device payment questions. [LIMIT-1]",
      rows: [],
      sqlQuery:
        "Open Payments agent could not run because open_payments has no loaded program_year.",
      sources,
      entities: { latestYear: null },
      route: "SQL_ONLY" as const,
      composer: buildSkippedComposerTrace("Open Payments data is not loaded yet."),
    };
  }

  const entity = await detectEntity(question);
  const analysisType = inferAnalysisType(question, entity);
  const rows = await getPaymentRows({ year: latestYear, analysisType, entity });

  const draftAnswer = rows.length > 0
    ? buildAnswer({ year: latestYear, rows, analysisType, entity })
    : buildNoRowsAnswer({ year: latestYear, entity, analysisType });

  const sqlQuery = entity
    ? `Grouped open_payments by ${analysisType} for program_year=${latestYear}; applied ${entity.kind} filter '${entity.value}'; ordered by sum(payment_amount) DESC; limit ${limit}.`
    : `Grouped open_payments by ${analysisType} for program_year=${latestYear}; ordered by sum(payment_amount) DESC; limit ${limit}.`;

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
      latestYear,
      detectedEntity: entity,
      analysisType,
    },
    route: "SQL_ONLY" as const,
    composer: composed.trace,
  };
}

export const answerOpenPaymentsAnalysisQuestion = answerOpenPaymentsQuestion;
export const answerPaymentsQuestion = answerOpenPaymentsQuestion;

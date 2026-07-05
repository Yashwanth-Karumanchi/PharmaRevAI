import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

export const dynamic = "force-dynamic";

type CountRow = { count: number };
type YearRow = { year: number };

type TableStatus = {
  tableName: string;
  label: string;
  rowCount: number;
  status: "ok" | "empty" | "missing";
};

type TableKey =
  | "cms_part_d_spending"
  | "cms_part_d_prescribers"
  | "open_payments"
  | "pharma_sales"
  | "documents"
  | "document_chunks";

const knownTables: { tableName: TableKey; label: string }[] = [
  { tableName: "cms_part_d_spending", label: "Medicare Part D Spending" },
  { tableName: "cms_part_d_prescribers", label: "Medicare Part D Prescribers" },
  { tableName: "open_payments", label: "Open Payments" },
  { tableName: "pharma_sales", label: "Public Pharma Sales" },
  { tableName: "documents", label: "FDA Label Documents" },
  { tableName: "document_chunks", label: "FDA Label Evidence" },
];

function composerEnabled() {
  return (
    process.env.LLM_COMPOSER_ENABLED === "true" ||
    process.env.PHARMAREV_LLM_COMPOSER_ENABLED === "true" ||
    process.env.ENABLE_LLM_COMPOSER === "true"
  );
}

function configured(value: string | undefined) {
  return Boolean(value && value.trim() && !value.includes("your_"));
}

async function tableExists(tableName: string) {
  const rows = await sql<{ exists: boolean }[]>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
    ) as exists
  `;

  return Boolean(rows[0]?.exists);
}

async function countKnownTable(tableName: TableKey) {
  if (tableName === "cms_part_d_spending") {
    const rows = await sql<CountRow[]>`
      select count(*)::int as count
      from cms_part_d_spending
    `;
    return Number(rows[0]?.count ?? 0);
  }

  if (tableName === "cms_part_d_prescribers") {
    const rows = await sql<CountRow[]>`
      select count(*)::int as count
      from cms_part_d_prescribers
    `;
    return Number(rows[0]?.count ?? 0);
  }

  if (tableName === "open_payments") {
    const rows = await sql<CountRow[]>`
      select count(*)::int as count
      from open_payments
    `;
    return Number(rows[0]?.count ?? 0);
  }

  if (tableName === "pharma_sales") {
    const rows = await sql<CountRow[]>`
      select count(*)::int as count
      from pharma_sales
    `;
    return Number(rows[0]?.count ?? 0);
  }

  if (tableName === "documents") {
    const rows = await sql<CountRow[]>`
      select count(*)::int as count
      from documents
    `;
    return Number(rows[0]?.count ?? 0);
  }

  if (tableName === "document_chunks") {
    const rows = await sql<CountRow[]>`
      select count(*)::int as count
      from document_chunks
    `;
    return Number(rows[0]?.count ?? 0);
  }

  return 0;
}

async function getTableStatus(table: {
  tableName: TableKey;
  label: string;
}): Promise<TableStatus> {
  try {
    const exists = await tableExists(table.tableName);

    if (!exists) {
      return {
        tableName: table.tableName,
        label: table.label,
        rowCount: 0,
        status: "missing",
      };
    }

    const rowCount = await countKnownTable(table.tableName);

    return {
      tableName: table.tableName,
      label: table.label,
      rowCount,
      status: rowCount > 0 ? "ok" : "empty",
    };
  } catch {
    return {
      tableName: table.tableName,
      label: table.label,
      rowCount: 0,
      status: "missing",
    };
  }
}

async function getTableStatuses() {
  const statuses: TableStatus[] = [];

  for (const table of knownTables) {
    statuses.push(await getTableStatus(table));
  }

  return statuses;
}

async function getAvailableYears() {
  const exists = await tableExists("cms_part_d_spending");

  if (!exists) {
    return [];
  }

  try {
    const rows = await sql<YearRow[]>`
      select distinct year::int as year
      from cms_part_d_spending
      where year is not null
      order by year desc
    `;

    return rows.map((row) => Number(row.year)).filter(Number.isFinite);
  } catch {
    return [];
  }
}

async function checkDatabaseConnection() {
  const rows = await sql<{ ok: number }[]>`
    select 1::int as ok
  `;

  return Number(rows[0]?.ok ?? 0) === 1;
}

export async function GET() {
  try {
    const connected = await checkDatabaseConnection();

    const [tables, availableYears] = await Promise.all([
      getTableStatuses(),
      getAvailableYears(),
    ]);

    const geminiKeyConfigured = configured(process.env.GEMINI_API_KEY);

    const composerIsEnabled = composerEnabled();

    const composerModel =
      process.env.LLM_COMPOSER_MODEL ||
      process.env.RAG_GENERATOR_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-3.1-flash-lite";

    const plannerModel =
      process.env.LLM_PLANNER_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-3.1-flash-lite";

    const ragGeneratorModel =
      process.env.RAG_GENERATOR_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-3.1-flash-lite";

    const latestYear = availableYears[0] ?? null;

    return NextResponse.json({
      ok: true,
      database: {
        connected,
        tables,
      },
      analysisYears: {
        availableYears,
        latestYear,
        primaryYear: 2024,
        mode: "single_year_2024",
        supportsRanking: availableYears.includes(2024),
        supportsSingleYearOverview: availableYears.includes(2024),
        supportsYearOverYearTrend: availableYears.length >= 2,
        notes: [
          availableYears.includes(2024)
            ? "2024 public Medicare Part D spending is available for ranking, summaries, and drug-level views."
            : "2024 Medicare Part D spending is not currently available.",
          availableYears.length >= 2
            ? "Multiple years are available for year-over-year comparisons."
            : "This deployment is currently configured as a 2024-only public-data demo. Year-over-year comparisons are optional and not required.",
        ],
      },
      llm: {
        geminiKeyConfigured,
        planner: {
          enabled: process.env.LLM_PLANNER_ENABLED === "true",
          model: plannerModel,
          geminiKeyConfigured,
        },
        ragGenerator: {
          enabled: process.env.RAG_GENERATOR_ENABLED === "true",
          model: ragGeneratorModel,
          geminiKeyConfigured,
        },
        composer: {
          enabled: composerIsEnabled,
          model: composerModel,
          geminiKeyConfigured,
          notes: composerIsEnabled
            ? "Composer is enabled for FDA-label and hybrid answers. SQL-only numeric answers can remain deterministic."
            : "Composer is disabled. Deterministic SQL/RAG answers are used.",
        },
      },
      env: {
        llmComposerEnabled: process.env.LLM_COMPOSER_ENABLED ?? null,
        pharmaRevLlmComposerEnabled:
          process.env.PHARMAREV_LLM_COMPOSER_ENABLED ?? null,
        enableLlmComposer: process.env.ENABLE_LLM_COMPOSER ?? null,
        llmPlannerEnabled: process.env.LLM_PLANNER_ENABLED ?? null,
        ragGeneratorEnabled: process.env.RAG_GENERATOR_ENABLED ?? null,
        cmsPartDSpendingYear: process.env.CMS_PARTD_SPENDING_YEAR ?? null,
        resetCmsPartDSpending: process.env.RESET_CMS_PARTD_SPENDING ?? null,
        nodeEnv: process.env.NODE_ENV ?? null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown system-health error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
        database: {
          connected: false,
          tables: [],
        },
      },
      { status: 500 }
    );
  }
}
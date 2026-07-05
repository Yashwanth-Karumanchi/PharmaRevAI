import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PublicTableRow = {
  table_name: string;
  approx_rows: string | number | null;
  size_bytes: string | number | null;
};

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
};

type CountRow = {
  count: string | number;
};

type YearRow = {
  year: string | number | null;
};

type DatasetMetric = {
  label: string;
  value: string;
};

type DatasetSummary = {
  id: string;
  label: string;
  tableName: string;
  description: string;
  exactRows: number | null;
  approxRows: number;
  sizeBytes: number;
  columns: string[];
  yearColumn: string | null;
  years: number[];
  metrics: DatasetMetric[];
};

type RecordRow = {
  record: Record<string, unknown>;
};

const knownDatasets = [
  {
    id: "part-d-spending",
    label: "Medicare Part D Spending",
    tableName: "cms_part_d_spending",
    description:
      "Drug-level Medicare Part D spending, claims, beneficiaries, manufacturers, brands, and generics.",
    yearColumn: "year",
  },
  {
    id: "part-d-prescribers",
    label: "Medicare Part D Prescribers",
    tableName: "cms_part_d_prescribers",
    description:
      "Provider-drug Medicare Part D cost records with provider geography and prescribing attributes.",
    yearColumn: "year",
  },
  {
    id: "open-payments",
    label: "Open Payments",
    tableName: "open_payments",
    description:
      "Public payment records involving manufacturers, covered recipients, physicians, and organizations.",
    yearColumn: "program_year",
  },
  {
    id: "pharma-sales",
    label: "Public Sales Quantity",
    tableName: "pharma_sales",
    description:
      "Public sales quantity and category records used for sales/category trend questions.",
    yearColumn: "year",
  },
  {
    id: "fda-label-documents",
    label: "FDA Label Documents",
    tableName: "documents",
    description:
      "Document-level metadata for FDA label evidence and other public evidence sources.",
    yearColumn: null,
  },
  {
    id: "fda-label-evidence",
    label: "FDA Label Evidence",
    tableName: "document_chunks",
    description:
      "Searchable evidence passages used for FDA label answers and hybrid SQL + label responses.",
    yearColumn: null,
  },
];

const allowedRecordTables = new Set(knownDatasets.map((dataset) => dataset.tableName));

function numberValue(value: unknown) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed;
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "$0";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function parseLimit(request: Request) {
  const url = new URL(request.url);
  const value = Number(url.searchParams.get("limit") || 100);

  if (!Number.isFinite(value)) return 100;

  return Math.min(Math.max(Math.trunc(value), 25), 250);
}

function parseOffset(request: Request) {
  const url = new URL(request.url);
  const value = Number(url.searchParams.get("offset") || 0);

  if (!Number.isFinite(value)) return 0;

  return Math.max(Math.trunc(value), 0);
}

function parseSearch(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  return query.slice(0, 120);
}

function parseTable(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("table")?.trim() || "cms_part_d_spending";

  if (allowedRecordTables.has(requested)) {
    return requested;
  }

  return "cms_part_d_spending";
}

function parseYear(request: Request) {
  const url = new URL(request.url);
  const yearValue = url.searchParams.get("year");

  if (!yearValue || yearValue === "all") {
    return null;
  }

  const parsed = Number(yearValue);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.trunc(parsed);
}

async function safe<T>(fallback: T, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function getExactCount(tableName: string) {
  return safe<number | null>(null, async () => {
    if (tableName === "cms_part_d_spending") {
      const rows = await sql<CountRow[]>`select count(*) as count from cms_part_d_spending`;
      return numberValue(rows[0]?.count);
    }

    if (tableName === "cms_part_d_prescribers") {
      const rows = await sql<CountRow[]>`select count(*) as count from cms_part_d_prescribers`;
      return numberValue(rows[0]?.count);
    }

    if (tableName === "open_payments") {
      const rows = await sql<CountRow[]>`select count(*) as count from open_payments`;
      return numberValue(rows[0]?.count);
    }

    if (tableName === "pharma_sales") {
      const rows = await sql<CountRow[]>`select count(*) as count from pharma_sales`;
      return numberValue(rows[0]?.count);
    }

    if (tableName === "documents") {
      const rows = await sql<CountRow[]>`select count(*) as count from documents`;
      return numberValue(rows[0]?.count);
    }

    if (tableName === "document_chunks") {
      const rows = await sql<CountRow[]>`select count(*) as count from document_chunks`;
      return numberValue(rows[0]?.count);
    }

    return null;
  });
}

async function getYears(tableName: string, yearColumn: string | null) {
  if (!yearColumn) return [];

  return safe<number[]>([], async () => {
    if (tableName === "cms_part_d_spending") {
      const rows = await sql<YearRow[]>`
        select distinct year
        from cms_part_d_spending
        where year is not null
        order by year desc
      `;

      return rows.map((row) => numberValue(row.year)).filter(Boolean);
    }

    if (tableName === "cms_part_d_prescribers") {
      const rows = await sql<YearRow[]>`
        select distinct year
        from cms_part_d_prescribers
        where year is not null
        order by year desc
      `;

      return rows.map((row) => numberValue(row.year)).filter(Boolean);
    }

    if (tableName === "open_payments") {
      const rows = await sql<YearRow[]>`
        select distinct program_year as year
        from open_payments
        where program_year is not null
        order by program_year desc
      `;

      return rows.map((row) => numberValue(row.year)).filter(Boolean);
    }

    if (tableName === "pharma_sales") {
      const rows = await sql<YearRow[]>`
        select distinct year
        from pharma_sales
        where year is not null
        order by year desc
      `;

      return rows.map((row) => numberValue(row.year)).filter(Boolean);
    }

    return [];
  });
}

async function getMetrics(tableName: string) {
  return safe<DatasetMetric[]>([], async () => {
    if (tableName === "cms_part_d_spending") {
      const rows = await sql<
        {
          brands: string | number;
          generics: string | number;
          manufacturers: string | number;
          total_spending: string | number | null;
        }[]
      >`
        select
          count(distinct brand_name) as brands,
          count(distinct generic_name) as generics,
          count(distinct manufacturer) as manufacturers,
          sum(coalesce(total_spending, 0)) as total_spending
        from cms_part_d_spending
      `;

      const row = rows[0];

      return [
        { label: "Brands", value: numberValue(row?.brands).toLocaleString("en-US") },
        { label: "Generics", value: numberValue(row?.generics).toLocaleString("en-US") },
        {
          label: "Manufacturers",
          value: numberValue(row?.manufacturers).toLocaleString("en-US"),
        },
        {
          label: "Total spending",
          value: formatCurrency(numberValue(row?.total_spending)),
        },
      ];
    }

    if (tableName === "cms_part_d_prescribers") {
      const rows = await sql<
        {
          providers: string | number;
          brands: string | number;
          states: string | number;
          total_cost: string | number | null;
        }[]
      >`
        select
          count(distinct npi) as providers,
          count(distinct brand_name) as brands,
          count(distinct provider_state) as states,
          sum(coalesce(total_drug_cost, 0)) as total_cost
        from cms_part_d_prescribers
      `;

      const row = rows[0];

      return [
        { label: "Providers", value: numberValue(row?.providers).toLocaleString("en-US") },
        { label: "Brands", value: numberValue(row?.brands).toLocaleString("en-US") },
        { label: "States", value: numberValue(row?.states).toLocaleString("en-US") },
        { label: "Total cost", value: formatCurrency(numberValue(row?.total_cost)) },
      ];
    }

    if (tableName === "documents") {
      const rows = await sql<{ source_types: string | number; datasets: string | number }[]>`
        select
          count(distinct source_type) as source_types,
          count(distinct coalesce(dataset_name, source_dataset, 'Unknown')) as datasets
        from documents
      `;

      const row = rows[0];

      return [
        {
          label: "Source types",
          value: numberValue(row?.source_types).toLocaleString("en-US"),
        },
        { label: "Datasets", value: numberValue(row?.datasets).toLocaleString("en-US") },
      ];
    }

    if (tableName === "document_chunks") {
      const rows = await sql<{ source_types: string | number; drugs: string | number }[]>`
        select
          count(distinct source_type) as source_types,
          count(distinct coalesce(drug_name, brand_name, metadata->>'drugName')) as drugs
        from document_chunks
      `;

      const row = rows[0];

      return [
        {
          label: "Source types",
          value: numberValue(row?.source_types).toLocaleString("en-US"),
        },
        { label: "Drugs", value: numberValue(row?.drugs).toLocaleString("en-US") },
      ];
    }

    return [];
  });
}

function makeSearchPattern(search: string) {
  return `%${search}%`;
}

async function getRecords({
  tableName,
  search,
  year,
  limit,
  offset,
}: {
  tableName: string;
  search: string;
  year: number | null;
  limit: number;
  offset: number;
}) {
  const searchPattern = makeSearchPattern(search);
  const hasSearch = search.trim().length > 0;

  return safe<Record<string, unknown>[]>([], async () => {
    if (tableName === "cms_part_d_spending") {
      const rows = await sql<RecordRow[]>`
        select to_jsonb(t) as record
        from (
          select
            year,
            brand_name,
            generic_name,
            manufacturer,
            total_spending,
            total_claims,
            total_beneficiaries
          from cms_part_d_spending
          where (${year === null} or year = ${year})
            and (
              ${!hasSearch}
              or brand_name ilike ${searchPattern}
              or generic_name ilike ${searchPattern}
              or manufacturer ilike ${searchPattern}
            )
          order by year desc nulls last, total_spending desc nulls last
          limit ${limit}
          offset ${offset}
        ) t
      `;

      return rows.map((row) => row.record);
    }

    if (tableName === "cms_part_d_prescribers") {
      const rows = await sql<RecordRow[]>`
        select to_jsonb(t) as record
        from (
          select
            year,
            brand_name,
            generic_name,
            provider_name,
            provider_city,
            provider_state,
            provider_specialty,
            npi,
            total_drug_cost,
            total_claims,
            total_beneficiaries
          from cms_part_d_prescribers
          where (${year === null} or year = ${year})
            and (
              ${!hasSearch}
              or brand_name ilike ${searchPattern}
              or generic_name ilike ${searchPattern}
              or provider_name ilike ${searchPattern}
              or provider_city ilike ${searchPattern}
              or provider_state ilike ${searchPattern}
              or provider_specialty ilike ${searchPattern}
              or npi::text ilike ${searchPattern}
            )
          order by year desc nulls last, total_drug_cost desc nulls last
          limit ${limit}
          offset ${offset}
        ) t
      `;

      return rows.map((row) => row.record);
    }

    if (tableName === "open_payments") {
      const rows = await sql<RecordRow[]>`
        select to_jsonb(t) as record
        from (
          select *
          from open_payments
          where (${!hasSearch} or to_jsonb(open_payments)::text ilike ${searchPattern})
          limit ${limit}
          offset ${offset}
        ) t
      `;

      return rows.map((row) => row.record);
    }

    if (tableName === "pharma_sales") {
      const rows = await sql<RecordRow[]>`
        select to_jsonb(t) as record
        from (
          select *
          from pharma_sales
          where (${!hasSearch} or to_jsonb(pharma_sales)::text ilike ${searchPattern})
          limit ${limit}
          offset ${offset}
        ) t
      `;

      return rows.map((row) => row.record);
    }

    if (tableName === "documents") {
      const rows = await sql<RecordRow[]>`
        select to_jsonb(t) as record
        from (
          select *
          from documents
          where (${!hasSearch} or to_jsonb(documents)::text ilike ${searchPattern})
          order by created_at desc nulls last
          limit ${limit}
          offset ${offset}
        ) t
      `;

      return rows.map((row) => row.record);
    }

    if (tableName === "document_chunks") {
      const rows = await sql<RecordRow[]>`
        select to_jsonb(t) as record
        from (
          select
            id,
            document_id,
            source_type,
            source_dataset,
            drug_name,
            brand_name,
            generic_name,
            manufacturer_name,
            section,
            chunk_index,
            left(chunk_text, 700) as chunk_text,
            created_at
          from document_chunks
          where (${!hasSearch} or to_jsonb(document_chunks)::text ilike ${searchPattern})
          order by created_at desc nulls last
          limit ${limit}
          offset ${offset}
        ) t
      `;

      return rows.map((row) => row.record);
    }

    return [];
  });
}

function availableYearsFromDatasets(datasets: DatasetSummary[]) {
  const years = new Set<number>();

  for (const dataset of datasets) {
    for (const year of dataset.years) {
      years.add(year);
    }
  }

  return Array.from(years).sort((a, b) => b - a);
}

export async function GET(request: Request) {
  try {
    const selectedTable = parseTable(request);
    const search = parseSearch(request);
    const year = parseYear(request);
    const limit = parseLimit(request);
    const offset = parseOffset(request);

    const [tableRows, columnRows] = await Promise.all([
      sql<PublicTableRow[]>`
        select
          c.relname as table_name,
          greatest(c.reltuples, 0)::bigint as approx_rows,
          pg_total_relation_size(c.oid)::bigint as size_bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc, c.relname asc
      `,
      sql<ColumnRow[]>`
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = 'public'
        order by table_name asc, ordinal_position asc
      `,
    ]);

    const columnsByTable = columnRows.reduce<Record<string, ColumnRow[]>>(
      (acc, row) => {
        acc[row.table_name] = acc[row.table_name] || [];
        acc[row.table_name].push(row);
        return acc;
      },
      {}
    );

    const tableMeta = new Map(tableRows.map((row) => [row.table_name, row]));

    const datasets = await Promise.all(
      knownDatasets.map(async (dataset): Promise<DatasetSummary> => {
        const meta = tableMeta.get(dataset.tableName);
        const columns = columnsByTable[dataset.tableName] || [];
        const [exactRows, years, metrics] = await Promise.all([
          getExactCount(dataset.tableName),
          getYears(dataset.tableName, dataset.yearColumn),
          getMetrics(dataset.tableName),
        ]);

        return {
          id: dataset.id,
          label: dataset.label,
          tableName: dataset.tableName,
          description: dataset.description,
          exactRows,
          approxRows: numberValue(meta?.approx_rows),
          sizeBytes: numberValue(meta?.size_bytes),
          columns: columns.map((column) => column.column_name),
          yearColumn: dataset.yearColumn,
          years,
          metrics,
        };
      })
    );

    const tableCatalog = tableRows.map((table) => ({
      tableName: table.table_name,
      approxRows: numberValue(table.approx_rows),
      exactRows:
        datasets.find((dataset) => dataset.tableName === table.table_name)
          ?.exactRows ?? null,
      sizeBytes: numberValue(table.size_bytes),
      columns:
        columnsByTable[table.table_name]?.map((column) => ({
          name: column.column_name,
          type: column.data_type,
        })) ?? [],
      isKnownDataset: knownDatasets.some(
        (dataset) => dataset.tableName === table.table_name
      ),
    }));

    const records = await getRecords({
      tableName: selectedTable,
      search,
      year,
      limit,
      offset,
    });

    const totalKnownRows = datasets.reduce(
      (sum, dataset) => sum + (dataset.exactRows ?? 0),
      0
    );

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      filters: {
        table: selectedTable,
        q: search,
        year,
        limit,
        offset,
      },
      summary: {
        publicTables: tableCatalog.length,
        knownDatasets: datasets.length,
        totalKnownRows,
        totalKnownRowsLabel: formatCompact(totalKnownRows),
        availableYears: availableYearsFromDatasets(datasets),
      },
      datasets,
      tableCatalog,
      records,
      recordCount: records.length,
      nextOffset: records.length === limit ? offset + limit : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown data coverage error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

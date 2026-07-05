"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  Database,
  FileText,
  Layers,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";

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

type TableCatalogItem = {
  tableName: string;
  approxRows: number;
  exactRows: number | null;
  sizeBytes: number;
  columns: { name: string; type: string }[];
  isKnownDataset: boolean;
};

type DataCoverageResponse = {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  filters?: {
    table: string;
    q: string;
    year: number | null;
    limit: number;
    offset: number;
  };
  summary?: {
    publicTables: number;
    knownDatasets: number;
    totalKnownRows: number;
    totalKnownRowsLabel: string;
    availableYears: number[];
  };
  datasets?: DatasetSummary[];
  tableCatalog?: TableCatalogItem[];
  records?: Record<string, unknown>[];
  recordCount?: number;
  nextOffset?: number | null;
};

const defaultTable = "cms_part_d_spending";

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "—";

  if (typeof value === "number") {
    if (Math.abs(value) >= 1000) {
      return value.toLocaleString("en-US");
    }

    return String(value);
  }

  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function getPreferredColumns(records: Record<string, unknown>[]) {
  const preferred = [
    "year",
    "program_year",
    "brand_name",
    "generic_name",
    "manufacturer",
    "manufacturer_name",
    "provider_name",
    "provider_city",
    "provider_state",
    "provider_specialty",
    "applicable_manufacturer_or_applicable_gpo_making_payment_name",
    "covered_recipient_type",
    "total_spending",
    "total_drug_cost",
    "total_claims",
    "total_beneficiaries",
    "total_amount_of_payment_usdollars",
    "source_type",
    "source_dataset",
    "section",
    "chunk_text",
  ];

  const allKeys = Array.from(
    records.reduce<Set<string>>((set, record) => {
      Object.keys(record).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const selected = [
    ...preferred.filter((key) => allKeys.includes(key)),
    ...allKeys.filter((key) => !preferred.includes(key)).slice(0, 10),
  ];

  return selected.slice(0, 14);
}

export default function DataCoveragePage() {
  const [data, setData] = useState<DataCoverageResponse | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [selectedTable, setSelectedTable] = useState(defaultTable);
  const [selectedYear, setSelectedYear] = useState("all");
  const [limit, setLimit] = useState("100");
  const [isLoading, setIsLoading] = useState(true);

  async function loadCoverage({
    q = activeSearch,
    table = selectedTable,
    year = selectedYear,
    selectedLimit = limit,
  }: {
    q?: string;
    table?: string;
    year?: string;
    selectedLimit?: string;
  } = {}) {
    setIsLoading(true);

    try {
      const params = new URLSearchParams();

      params.set("table", table);
      params.set("limit", selectedLimit);

      if (q.trim()) params.set("q", q.trim());
      if (year !== "all") params.set("year", year);

      const response = await fetch(`/api/data-coverage?${params.toString()}`, {
        cache: "no-store",
      });

      const nextData = (await response.json()) as DataCoverageResponse;
      setData(nextData);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load database coverage";

      setData({
        ok: false,
        error: message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCoverage({
      q: activeSearch,
      table: selectedTable,
      year: selectedYear,
      selectedLimit: limit,
    });
  }, [activeSearch, selectedTable, selectedYear, limit]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveSearch(searchInput.trim());
  }

  function resetFilters() {
    setSearchInput("");
    setActiveSearch("");
    setSelectedTable(defaultTable);
    setSelectedYear("all");
    setLimit("100");
  }

  const summary = data?.summary;
  const datasets = data?.datasets ?? [];
  const tableCatalog = data?.tableCatalog ?? [];
  const records = data?.records ?? [];
  const availableYears = summary?.availableYears ?? [];
  const selectedDataset = datasets.find(
    (dataset) => dataset.tableName === selectedTable
  );

  const visibleColumns = useMemo(() => getPreferredColumns(records), [records]);

  return (
    <main className="min-h-screen bg-[#020617] text-slate-100">
      <header className="border-b border-white/10 bg-white/[0.03]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <Link
              href="/"
              className="mb-3 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
            >
              <ArrowLeft size={16} />
              Back to assistant
            </Link>

            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-400/15 p-3 text-emerald-300">
                <Database size={22} />
              </div>

              <div>
                <h1 className="text-2xl font-semibold text-white">
                  Data Coverage
                </h1>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Explore available public pharma records across spending,
                  prescribers, payments, sales, and FDA label evidence.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={() => loadCoverage()}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-6">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <form
            onSubmit={handleSearch}
            className="grid gap-3 xl:grid-cols-[1.2fr_260px_160px_150px_auto_auto]"
          >
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-slate-500">
                Search records
              </span>

              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#020617] px-3 py-2">
                <Search size={16} className="text-slate-500" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Drug, company, provider, city, label section..."
                  className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-medium text-slate-500">
                Dataset
              </span>

              <select
                value={selectedTable}
                onChange={(event) => setSelectedTable(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#020617] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-emerald-300"
              >
                {datasets.map((dataset) => (
                  <option key={dataset.tableName} value={dataset.tableName}>
                    {dataset.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-medium text-slate-500">
                Year
              </span>

              <select
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#020617] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-emerald-300"
              >
                <option value="all">All years</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-medium text-slate-500">
                Preview size
              </span>

              <select
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#020617] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-emerald-300"
              >
                <option value="50">50 records</option>
                <option value="100">100 records</option>
                <option value="250">250 records</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400"
              >
                Search
              </button>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={resetFilters}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
              >
                Reset
              </button>
            </div>
          </form>

          <p className="mt-3 text-xs leading-5 text-slate-500">
            This page reads from the live application database every time you refresh,
            so counts and previews update as new public records are added.
          </p>
        </div>

        {isLoading && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-400">
            Loading available data...
          </div>
        )}

        {!isLoading && data?.ok === false && (
          <div className="mt-6 rounded-3xl border border-red-400/20 bg-red-400/10 p-6 text-sm leading-6 text-red-100">
            {data.error || "Data coverage could not be loaded."}
          </div>
        )}

        {!isLoading && data?.ok && summary && (
          <div className="mt-6 space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={<Layers size={18} />}
                title="Public tables"
                value={formatNumber(summary.publicTables)}
                subtitle="Detected in the database"
              />

              <MetricCard
                icon={<Database size={18} />}
                title="Known datasets"
                value={formatNumber(summary.knownDatasets)}
                subtitle="Connected to the assistant"
              />

              <MetricCard
                icon={<Table2 size={18} />}
                title="Known records"
                value={summary.totalKnownRowsLabel}
                subtitle={`${formatNumber(summary.totalKnownRows)} exact rows`}
              />

              <MetricCard
                icon={<CalendarDays size={18} />}
                title="Available years"
                value={
                  summary.availableYears.length > 0
                    ? summary.availableYears.join(", ")
                    : "—"
                }
                subtitle="Detected across year-based datasets"
              />
            </div>

            <DatasetGrid
              datasets={datasets}
              selectedTable={selectedTable}
              onSelectTable={setSelectedTable}
            />

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-start">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    {selectedDataset?.label ?? selectedTable}
                  </h2>
                  <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                    {selectedDataset?.description ??
                      "Preview records from the selected table."}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge>{records.length} records shown</Badge>
                  {data.generatedAt && (
                    <Badge>Updated {new Date(data.generatedAt).toLocaleTimeString()}</Badge>
                  )}
                </div>
              </div>

              {selectedDataset && selectedDataset.metrics.length > 0 && (
                <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {selectedDataset.metrics.map((metric) => (
                    <InfoBlock
                      key={`${metric.label}-${metric.value}`}
                      label={metric.label}
                      value={metric.value}
                    />
                  ))}
                </div>
              )}

              {records.length === 0 ? (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                  No records match the current filters. Try another dataset,
                  broader search term, or all years.
                </div>
              ) : (
                <DynamicRecordTable records={records} columns={visibleColumns} />
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-white">
                  Database table inventory
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  This inventory is discovered dynamically from the public schema.
                  Known datasets show exact row counts; other tables show database
                  estimates.
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {tableCatalog.map((table) => (
                  <div
                    key={table.tableName}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          {table.tableName}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {table.columns.length} columns · {formatBytes(table.sizeBytes)}
                        </p>
                      </div>

                      <Badge>
                        {table.exactRows !== null
                          ? `${formatNumber(table.exactRows)} rows`
                          : `~${formatNumber(table.approxRows)} rows`}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {table.columns.slice(0, 12).map((column) => (
                        <span
                          key={`${table.tableName}-${column.name}`}
                          className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-slate-400"
                        >
                          {column.name}
                        </span>
                      ))}

                      {table.columns.length > 12 && (
                        <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-slate-500">
                          +{table.columns.length - 12} more
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function MetricCard({
  icon,
  title,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
        {icon}
      </div>

      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-2 break-words text-2xl font-semibold text-white">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{subtitle}</p>
    </div>
  );
}

function DatasetGrid({
  datasets,
  selectedTable,
  onSelectTable,
}: {
  datasets: DatasetSummary[];
  selectedTable: string;
  onSelectTable: (tableName: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {datasets.map((dataset) => {
        const isSelected = dataset.tableName === selectedTable;

        return (
          <button
            key={dataset.id}
            onClick={() => onSelectTable(dataset.tableName)}
            className={`rounded-3xl border p-5 text-left transition ${
              isSelected
                ? "border-emerald-300/50 bg-emerald-400/10"
                : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
            }`}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {dataset.label}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {dataset.tableName}
                </p>
              </div>

              <Badge>
                {dataset.exactRows !== null
                  ? formatNumber(dataset.exactRows)
                  : `~${formatNumber(dataset.approxRows)}`}
              </Badge>
            </div>

            <p className="line-clamp-3 text-xs leading-5 text-slate-400">
              {dataset.description}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {dataset.years.slice(0, 4).map((year) => (
                <span
                  key={`${dataset.id}-${year}`}
                  className="rounded-full bg-blue-400/15 px-2 py-1 text-[11px] text-blue-300"
                >
                  {year}
                </span>
              ))}

              {dataset.years.length === 0 && (
                <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-slate-500">
                  no year field
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-white">
        {value}
      </p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-slate-300">
      {children}
    </span>
  );
}

function DynamicRecordTable({
  records,
  columns,
}: {
  records: Record<string, unknown>[];
  columns: string[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#111827] text-left">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  className="border-b border-white/10 px-4 py-3 text-xs font-semibold text-slate-300"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {records.map((record, index) => (
              <tr
                key={index}
                className="border-b border-white/5 transition hover:bg-white/[0.03]"
              >
                {columns.map((column) => (
                  <td
                    key={`${index}-${column}`}
                    className="max-w-[360px] px-4 py-3 align-top text-xs leading-5 text-slate-300"
                  >
                    <span className="line-clamp-4">
                      {formatCell(record[column])}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";

type TableStatus = {
  tableName: string;
  label: string;
  rowCount: number;
  status: "ok" | "empty" | "missing";
};

type SystemHealthResponse = {
  ok: boolean;
  error?: string;
  database?: {
    connected: boolean;
    tables: TableStatus[];
  };
  analysisYears?: {
    availableYears: number[];
    latestYear: number | null;
    primaryYear?: number;
    mode?: string;
    supportsRanking?: boolean;
    supportsSingleYearOverview?: boolean;
    supportsYearOverYearTrend?: boolean;
    notes?: string[];
  };
  llm?: {
    geminiKeyConfigured?: boolean;
    planner?: {
      enabled: boolean;
      model: string;
      geminiKeyConfigured: boolean;
    };
    ragGenerator?: {
      enabled: boolean;
      model: string;
      geminiKeyConfigured: boolean;
    };
    composer?: {
      enabled: boolean;
      model: string;
      geminiKeyConfigured: boolean;
      notes?: string;
    };
  };
  env?: {
    llmComposerEnabled?: string | null;
    pharmaRevLlmComposerEnabled?: string | null;
    enableLlmComposer?: string | null;
    llmPlannerEnabled?: string | null;
    ragGeneratorEnabled?: string | null;
    cmsPartDSpendingYear?: string | null;
    resetCmsPartDSpending?: string | null;
    nodeEnv?: string | null;
  };
};

type OverallStatus = "ready" | "warning" | "failing" | "loading";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function getOverallStatus(data: SystemHealthResponse | null): OverallStatus {
  if (!data) return "loading";

  if (!data.ok || data.database?.connected === false) {
    return "failing";
  }

  const tables = data.database?.tables ?? [];
  const requiredTablesOk =
    tables.length > 0 &&
    tables.every((table) => table.status === "ok" && table.rowCount > 0);

  const geminiReady = Boolean(data.llm?.geminiKeyConfigured);
  const resetIsOn = data.env?.resetCmsPartDSpending === "true";

  if (!requiredTablesOk || !geminiReady) {
    return "failing";
  }

  if (resetIsOn) {
    return "warning";
  }

  return "ready";
}

function getStatusLabel(status: OverallStatus) {
  if (status === "ready") return "Ready";
  if (status === "warning") return "Needs attention";
  if (status === "failing") return "Failing";
  return "Checking";
}

function getStatusCardClass(status: OverallStatus) {
  if (status === "ready") {
    return "border-emerald-400/25 bg-emerald-400/10";
  }

  if (status === "warning") {
    return "border-amber-400/25 bg-amber-400/10";
  }

  if (status === "failing") {
    return "border-red-400/25 bg-red-400/10";
  }

  return "border-white/10 bg-white/[0.03]";
}

function getStatusIcon(status: OverallStatus) {
  if (status === "ready") return <CheckCircle2 size={18} />;
  if (status === "warning") return <AlertTriangle size={18} />;
  if (status === "failing") return <XCircle size={18} />;
  return <RefreshCw size={18} className="animate-spin" />;
}

export default function SystemHealthPage() {
  const [data, setData] = useState<SystemHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  async function loadHealth() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/system-health", {
        cache: "no-store",
      });

      const json = (await response.json()) as SystemHealthResponse;
      setData(json);
      setLastCheckedAt(new Date().toLocaleString());
    } catch (error) {
      setData({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load system health.",
      });
      setLastCheckedAt(new Date().toLocaleString());
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadHealth();
  }, []);

  const overallStatus = useMemo(() => getOverallStatus(data), [data]);
  const tables = data?.database?.tables ?? [];
  const availableYears = data?.analysisYears?.availableYears ?? [];
  const resetIsOn = data?.env?.resetCmsPartDSpending === "true";

  return (
    <main className="min-h-screen bg-[#070b16] text-slate-100">
      <section className="border-b border-white/10 px-8 py-6">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="mb-4 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
            >
              <ArrowLeft size={16} />
              Back to chat
            </Link>

            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                <ShieldCheck size={22} />
              </div>

              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  System Health
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Checks database readiness, available public evidence, and LLM
                  configuration.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={loadHealth}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
          >
            <RefreshCw
              size={16}
              className={isLoading ? "animate-spin" : ""}
            />
            Refresh
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-6 px-8 py-6">
        <div
          className={`rounded-3xl border p-6 ${getStatusCardClass(
            overallStatus
          )}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/20">
                {getStatusIcon(overallStatus)}
              </div>

              <div>
                <p className="text-sm text-slate-400">Overall status</p>
                <h2 className="mt-1 text-2xl font-bold">
                  {getStatusLabel(overallStatus)}
                </h2>
              </div>
            </div>

            <div className="text-right text-sm text-slate-400">
              <p>Last checked: {lastCheckedAt ?? "Not checked yet"}</p>
              <p>Mode: {data?.analysisYears?.mode ?? "unknown"}</p>
            </div>
          </div>

          {data?.error && (
            <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-100">
              {data.error}
            </div>
          )}

          {resetIsOn && (
            <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
              <strong>Action needed:</strong>{" "}
              <code>RESET_CMS_PARTD_SPENDING</code> is currently{" "}
              <code>true</code>. Set it to <code>false</code> in{" "}
              <code>.env.local</code> after ingestion to avoid accidental
              reloads.
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <HealthCard
            icon={<Database size={18} />}
            title="Database"
            status={data?.database?.connected ? "Ready" : "Failing"}
            description={
              data?.database?.connected
                ? "Connected to the public evidence database."
                : "Database connection is unavailable."
            }
          />

          <HealthCard
            icon={<Sparkles size={18} />}
            title="LLM planner"
            status={data?.llm?.planner?.enabled ? "Enabled" : "Disabled"}
            description={`Model: ${data?.llm?.planner?.model ?? "unknown"}`}
          />

          <HealthCard
            icon={<Sparkles size={18} />}
            title="Answer composer"
            status={data?.llm?.composer?.enabled ? "Enabled" : "Disabled"}
            description={`Model: ${data?.llm?.composer?.model ?? "unknown"}`}
          />
        </div>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Available analysis year</h2>
              <p className="mt-1 text-sm text-slate-400">
                This deployment is configured for a 2024 public-data demo.
              </p>
            </div>

            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">
              {availableYears.length > 0
                ? availableYears.join(", ")
                : "No years found"}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <InfoBox
              label="Ranking"
              value={
                data?.analysisYears?.supportsRanking
                  ? "Supported"
                  : "Unavailable"
              }
            />
            <InfoBox
              label="Single-year overview"
              value={
                data?.analysisYears?.supportsSingleYearOverview
                  ? "Supported"
                  : "Unavailable"
              }
            />
            <InfoBox
              label="Year-over-year trend"
              value={
                data?.analysisYears?.supportsYearOverYearTrend
                  ? "Supported"
                  : "Optional"
              }
            />
          </div>

          <div className="mt-4 space-y-2">
            {(data?.analysisYears?.notes ?? []).map((note) => (
              <div
                key={note}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-slate-300"
              >
                {note}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-lg font-semibold">Data tables</h2>
          <p className="mt-1 text-sm text-slate-400">
            Live row counts from the connected database.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tables.map((table) => (
              <div
                key={table.tableName}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{table.label}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {table.tableName}
                    </p>
                  </div>

                  <StatusBadge status={table.status} />
                </div>

                <p className="mt-4 text-2xl font-bold">
                  {formatNumber(table.rowCount)}
                </p>
                <p className="mt-1 text-xs text-slate-500">records</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-lg font-semibold">LLM configuration</h2>
          <p className="mt-1 text-sm text-slate-400">
            Runtime configuration currently loaded by Next.js.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <InfoBox
              label="Gemini key"
              value={data?.llm?.geminiKeyConfigured ? "Configured" : "Missing"}
            />
            <InfoBox
              label="Planner"
              value={
                data?.llm?.planner?.enabled
                  ? `Enabled · ${data.llm.planner.model}`
                  : "Disabled"
              }
            />
            <InfoBox
              label="RAG generator"
              value={
                data?.llm?.ragGenerator?.enabled
                  ? `Enabled · ${data.llm.ragGenerator.model}`
                  : "Disabled"
              }
            />
            <InfoBox
              label="Composer"
              value={
                data?.llm?.composer?.enabled
                  ? `Enabled · ${data.llm.composer.model}`
                  : "Disabled"
              }
            />
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-slate-300">
            {data?.llm?.composer?.notes ??
              "Composer status is not available yet."}
          </div>
        </section>
      </section>
    </main>
  );
}

function HealthCard({
  icon,
  title,
  status,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300">
          {icon}
        </div>

        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <h3 className="mt-1 text-lg font-semibold">{status}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-medium text-slate-100">
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: TableStatus["status"] }) {
  if (status === "ok") {
    return (
      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">
        Ready
      </span>
    );
  }

  if (status === "empty") {
    return (
      <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-xs text-amber-200">
        Empty
      </span>
    );
  }

  return (
    <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2 py-1 text-xs text-red-200">
      Missing
    </span>
  );
}
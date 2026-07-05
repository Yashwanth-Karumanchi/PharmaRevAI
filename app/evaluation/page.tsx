"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  CheckCircle2,
  Database,
  Download,
  Filter,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

type RatingFilter = "all" | "rated" | "unrated" | "helpful" | "not_helpful";

type EvaluationFilters = {
  rating: RatingFilter;
  intent: string;
  agent: string;
};

type FilterOptions = {
  ratings: RatingFilter[];
  intents: string[];
  agents: string[];
};

type EvaluationSummary = {
  totalAssistantMessages: number;
  ratedAnswers: number;
  helpfulCount: number;
  notHelpfulCount: number;
  unratedAnswers: number;
  feedbackRate: number;
  helpfulRate: number;
};

type EvaluationBreakdown = {
  label: string;
  totalAnswers: number;
  ratedAnswers: number;
  helpfulCount: number;
  notHelpfulCount: number;
  feedbackRate: number;
  helpfulRate: number;
};

type RecentFeedback = {
  id: string;
  rating: "helpful" | "not_helpful" | string | null;
  content: string;
  createdAt: string;
  feedbackUpdatedAt: string | null;
  intent: string;
  agent: string;
  route: string;
  originalQuestion: string;
};

type EvaluationResponse = {
  ok: boolean;
  error?: string;
  filters?: EvaluationFilters;
  filterOptions?: FilterOptions;
  summary?: EvaluationSummary;
  byIntent?: EvaluationBreakdown[];
  byAgent?: EvaluationBreakdown[];
  recentFeedback?: RecentFeedback[];
};

const defaultFilters: EvaluationFilters = {
  rating: "all",
  intent: "all",
  agent: "all",
};

export default function EvaluationPage() {
  const [data, setData] = useState<EvaluationResponse | null>(null);
  const [filters, setFilters] = useState<EvaluationFilters>(defaultFilters);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  async function loadEvaluation(nextFilters = filters) {
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/evaluation?${buildFilterParams(nextFilters)}`,
        {
          cache: "no-store",
        }
      );

      const nextData = (await response.json()) as EvaluationResponse;
      setData(nextData);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load evaluation";

      setData({
        ok: false,
        error: message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function exportEvaluationCsv() {
    setIsExporting(true);

    try {
      const response = await fetch(
        `/api/evaluation/export?${buildFilterParams(filters)}`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to export evaluation CSV");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const filename = getFilenameFromResponse(response);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert("Could not export CSV. Check the console for details.");
    } finally {
      setIsExporting(false);
    }
  }

  useEffect(() => {
    loadEvaluation(filters);
  }, [filters.rating, filters.intent, filters.agent]);

  function updateFilter<Key extends keyof EvaluationFilters>(
    key: Key,
    value: EvaluationFilters[Key]
  ) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function resetFilters() {
    setFilters(defaultFilters);
  }

  const summary = data?.summary;
  const filterOptions = data?.filterOptions;

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
              Back to chat
            </Link>

            <h1 className="text-2xl font-semibold text-white">
              Evaluation Dashboard
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Tracks answer feedback saved in Neon message metadata. Filter by
              rating, intent, and agent, then export the matching records for
              review.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportEvaluationCsv}
              disabled={isExporting}
              className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={16} />
              {isExporting ? "Exporting..." : "Export CSV"}
            </button>

            <button
              onClick={() => loadEvaluation(filters)}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                size={16}
                className={isLoading ? "animate-spin" : ""}
              />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-6">
        <FilterPanel
          filters={filters}
          filterOptions={filterOptions}
          onChange={updateFilter}
          onReset={resetFilters}
        />

        {isLoading && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-400">
            Loading evaluation metrics...
          </div>
        )}

        {!isLoading && data?.ok === false && (
          <div className="mt-6 rounded-3xl border border-red-400/20 bg-red-400/10 p-6 text-sm leading-6 text-red-100">
            {data.error || "Evaluation data could not be loaded."}
          </div>
        )}

        {!isLoading && data?.ok && summary && (
          <div className="mt-6 space-y-6">
            <ActiveFilterSummary filters={filters} />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={<Bot size={18} />}
                title="Assistant answers"
                value={summary.totalAssistantMessages.toLocaleString("en-US")}
                subtitle={`${summary.unratedAnswers.toLocaleString(
                  "en-US"
                )} unrated in current filter`}
              />

              <MetricCard
                icon={<MessageSquare size={18} />}
                title="Rated answers"
                value={summary.ratedAnswers.toLocaleString("en-US")}
                subtitle={`${summary.feedbackRate}% feedback coverage`}
              />

              <MetricCard
                icon={<ThumbsUp size={18} />}
                title="Helpful"
                value={summary.helpfulCount.toLocaleString("en-US")}
                subtitle={`${summary.helpfulRate}% helpful rate`}
              />

              <MetricCard
                icon={<ThumbsDown size={18} />}
                title="Not helpful"
                value={summary.notHelpfulCount.toLocaleString("en-US")}
                subtitle="Needs review or better grounding"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <BreakdownPanel
                title="Feedback by intent"
                icon={<BarChart3 size={17} />}
                rows={data.byIntent ?? []}
              />

              <BreakdownPanel
                title="Feedback by agent"
                icon={<Database size={17} />}
                rows={data.byAgent ?? []}
              />
            </div>

            <RecentFeedbackPanel rows={data.recentFeedback ?? []} />
          </div>
        )}
      </section>
    </main>
  );
}

function FilterPanel({
  filters,
  filterOptions,
  onChange,
  onReset,
}: {
  filters: EvaluationFilters;
  filterOptions?: FilterOptions;
  onChange: <Key extends keyof EvaluationFilters>(
    key: Key,
    value: EvaluationFilters[Key]
  ) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-white">
          <Filter size={17} className="text-emerald-300" />
          <h2 className="text-sm font-semibold">Evaluation filters</h2>
        </div>

        <button
          onClick={onReset}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          <RotateCcw size={14} />
          Reset
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <FilterSelect
          label="Rating"
          value={filters.rating}
          options={filterOptions?.ratings ?? ["all"]}
          formatLabel={formatRatingLabel}
          onChange={(value) => onChange("rating", value as RatingFilter)}
        />

        <FilterSelect
          label="Intent"
          value={filters.intent}
          options={["all", ...(filterOptions?.intents ?? [])]}
          formatLabel={(value) => value}
          onChange={(value) => onChange("intent", value)}
        />

        <FilterSelect
          label="Agent"
          value={filters.agent}
          options={["all", ...(filterOptions?.agents ?? [])]}
          formatLabel={(value) => value}
          onChange={(value) => onChange("agent", value)}
        />
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  formatLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  formatLabel: (value: string) => string;
  onChange: (value: string) => void;
}) {
  const uniqueOptions = Array.from(new Set(options));

  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-slate-500">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-[#020617] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-emerald-300"
      >
        {uniqueOptions.map((option) => (
          <option key={option} value={option}>
            {formatLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActiveFilterSummary({ filters }: { filters: EvaluationFilters }) {
  const activeFilters = [
    filters.rating !== "all"
      ? `Rating: ${formatRatingLabel(filters.rating)}`
      : "",
    filters.intent !== "all" ? `Intent: ${filters.intent}` : "",
    filters.agent !== "all" ? `Agent: ${filters.agent}` : "",
  ].filter(Boolean);

  if (activeFilters.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
        Showing all assistant answers. Export CSV will include all matching
        assistant messages.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
      Active filters: {activeFilters.join(" · ")}
    </div>
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
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

function BreakdownPanel({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: EvaluationBreakdown[];
}) {
  const maxTotal = Math.max(...rows.map((row) => row.totalAnswers), 1);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center gap-2 text-white">
        <span className="text-emerald-300">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>

      {rows.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
          No answers match the current filters.
        </div>
      )}

      <div className="space-y-4">
        {rows.map((row) => {
          const width = Math.max((row.totalAnswers / maxTotal) * 100, 4);

          return (
            <div key={row.label} className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="break-all text-sm font-medium text-slate-100">
                    {row.label}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.ratedAnswers} rated · {row.helpfulCount} helpful ·{" "}
                    {row.notHelpfulCount} not helpful
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-white">
                    {row.totalAnswers}
                  </p>
                  <p className="text-xs text-slate-500">answers</p>
                </div>
              </div>

              <div className="h-3 rounded-full bg-black/30">
                <div
                  className="h-3 rounded-full bg-emerald-300"
                  style={{ width: `${width}%` }}
                />
              </div>

              <div className="flex justify-between text-xs text-slate-500">
                <span>{row.feedbackRate}% feedback coverage</span>
                <span>{row.helpfulRate}% helpful</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentFeedbackPanel({ rows }: { rows: RecentFeedback[] }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center gap-2 text-white">
        <CheckCircle2 size={17} className="text-emerald-300" />
        <h2 className="text-sm font-semibold">
          Recent answers matching filters
        </h2>
      </div>

      {rows.length === 0 && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          No answers match the current filters.
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="rounded-2xl border border-white/10 bg-black/20 p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <RatingBadge rating={row.rating} />
              <MetadataBadge label={row.intent} />
              <MetadataBadge label={row.agent} />
              <MetadataBadge label={row.route} />
            </div>

            <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-1 text-xs font-medium text-slate-500">
                User question
              </p>
              <p className="text-sm leading-6 text-slate-200">
                {row.originalQuestion}
              </p>
            </div>

            <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-400">
              {row.content}
            </p>

            <p className="mt-3 text-xs text-slate-600">
              Rated:{" "}
              {row.feedbackUpdatedAt
                ? formatDate(row.feedbackUpdatedAt)
                : row.rating
                ? "unknown time"
                : "not rated yet"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RatingBadge({ rating }: { rating: string | null }) {
  if (rating === "helpful") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
        <ThumbsUp size={12} />
        Helpful
      </span>
    );
  }

  if (rating === "not_helpful") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-400/15 px-2.5 py-1 text-xs font-medium text-red-300">
        <ThumbsDown size={12} />
        Not helpful
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-300">
      Unrated
    </span>
  );
}

function MetadataBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-300">
      {label}
    </span>
  );
}

function buildFilterParams(filters: EvaluationFilters) {
  const params = new URLSearchParams();

  params.set("rating", filters.rating);
  params.set("intent", filters.intent);
  params.set("agent", filters.agent);

  return params.toString();
}

function getFilenameFromResponse(response: Response) {
  const contentDisposition = response.headers.get("Content-Disposition") ?? "";
  const match = contentDisposition.match(/filename="(.+)"/);

  return match?.[1] ?? `pharmarev-evaluation-${new Date().toISOString()}.csv`;
}

function formatRatingLabel(value: string) {
  if (value === "all") return "All";
  if (value === "rated") return "Rated";
  if (value === "unrated") return "Unrated";
  if (value === "helpful") return "Helpful";
  if (value === "not_helpful") return "Not helpful";

  return value;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
"use client";

import { useEffect, useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  FileJson,
  FileText,
  GitBranch,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { Message } from "@/types/chat";
import type { AnswerDrawerType, SourceEvidence } from "@/types/evidence";

type AnswerDrawerProps = {
  type: AnswerDrawerType;
  message: Message | null;
  focusedCitationLabel?: string | null;
  onClose: () => void;
};

type EvidenceGroup = {
  key: "sql" | "kb" | "limit" | "other";
  title: string;
  description: string;
  icon: React.ReactNode;
  sources: SourceEvidence[];
};

type ComposerTrace = {
  enabled: boolean;
  usedLlm: boolean;
  provider: string;
  model: string;
  status: string;
  reason: string;
};

type VerificationTrace = {
  status: string;
  reason: string;
  warnings: string[];
  score?: number;
};

export function AnswerDrawer({
  type,
  message,
  focusedCitationLabel,
  onClose,
}: AnswerDrawerProps) {
  if (!type) return null;

  const title =
    type === "sources"
      ? "Evidence"
      : type === "sql"
      ? "Query details"
      : "Process";

  const description =
    type === "sources"
      ? "Citations and evidence cards attached to this answer."
      : type === "sql"
      ? "Query summary, rows, charts, and export options behind numeric claims."
      : "A safe process trace: routing, tool choice, evidence, limits, composer, and verification.";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex justify-end bg-black/55 backdrop-blur-sm"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-[620px] max-w-[96vw] flex-col border-l border-white/10 bg-[#0f172a] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-4">
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              {description}
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {type === "sources" && (
            <SourcesPanel
              message={message}
              focusedCitationLabel={focusedCitationLabel ?? null}
            />
          )}
          {type === "sql" && <QueryPanel message={message} />}
          {type === "agentSteps" && <ProcessPanel message={message} />}
        </div>
      </div>
    </div>
  );
}

function SourcesPanel({
  message,
  focusedCitationLabel,
}: {
  message: Message | null;
  focusedCitationLabel: string | null;
}) {
  const metadata = getRecord(message?.metadata);
  const sources = getSources(metadata.sources);
  const groups = buildEvidenceGroups(sources);

  useEffect(() => {
    if (!focusedCitationLabel) return;

    const element = document.getElementById(
      `source-card-${sanitizeId(focusedCitationLabel)}`
    );

    if (!element) return;

    setTimeout(() => {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [focusedCitationLabel]);

  if (sources.length === 0) {
    return (
      <EmptyPanel
        icon={<FileText size={18} />}
        title="No evidence cards saved"
        description="This message does not include citation metadata. Ask a new PharmaRev data question to generate evidence cards."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
        Evidence is grouped by source type so you can quickly separate public data records, FDA label evidence, and scope-limit notes.
      </div>

      <EvidenceSummary sources={sources} />

      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-white/10 p-2 text-slate-200">
              {group.icon}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">{group.title}</h4>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                {group.description}
              </p>
            </div>
          </div>

          {group.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              isFocused={focusedCitationLabel === source.citationLabel}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function SourceCard({
  source,
  isFocused,
}: {
  source: SourceEvidence;
  isFocused: boolean;
}) {
  return (
    <div
      id={
        source.citationLabel
          ? `source-card-${sanitizeId(source.citationLabel)}`
          : undefined
      }
      className={`rounded-2xl border p-4 transition ${
        isFocused
          ? "border-emerald-300 bg-emerald-400/10 shadow-[0_0_0_1px_rgba(110,231,183,0.35)]"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {source.citationLabel && (
              <CitationBadge
                label={source.citationLabel}
                type={source.citationType}
              />
            )}
            <SourceStatusBadge status={source.status} />
          </div>
          <h5 className="break-words text-sm font-semibold text-white">
            {source.title}
          </h5>
          <p className="mt-1 text-xs text-slate-500">{source.dataset}</p>
        </div>
      </div>

      <div className="mb-3 rounded-xl bg-black/20 p-3 text-sm leading-6 text-slate-300">
        {source.excerpt}
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>Evidence score</span>
          <span>{Math.round(source.score * 100)}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/10">
          <div
            className={`h-2 rounded-full ${
              source.status === "used" ? "bg-emerald-400" : "bg-red-400"
            }`}
            style={{ width: `${Math.max(source.score * 100, 4)}%` }}
          />
        </div>
      </div>

      {source.metadata.length > 0 && (
        <div className="space-y-2">
          {source.metadata.map((item) => (
            <div
              key={item}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-5 text-slate-400"
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QueryPanel({ message }: { message: Message | null }) {
  const metadata = getRecord(message?.metadata);
  const rows = getRows(metadata.rows);
  const sqlQuery = getString(metadata.sqlQuery);
  const route = getString(metadata.route);
  const intent = getString(metadata.intent);
  const toolName = getString(metadata.toolName) || getString(metadata.agent);
  const sources = getSources(metadata.sources);
  const sqlSources = sources.filter((source) => source.citationType === "sql");
  const hasQueryEvidence = Boolean(sqlQuery || rows.length > 0 || sqlSources.length > 0);
  const columns = getColumns(rows);
  const ranking = buildRankingPoints(rows);
  const trend = buildTrendPoints(rows);

  if (!hasQueryEvidence) {
    return (
      <EmptyPanel
        icon={<Database size={18} />}
        title="No query details for this message"
        description="This answer did not require a structured-data query, or the query metadata was not saved."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <InfoCard label="Route" value={route || "Not stored"} />
        <InfoCard label="Intent" value={intent || "Not stored"} />
        <InfoCard label="Agent" value={toolName || "Not stored"} />
        <InfoCard label="Rows attached" value={String(rows.length)} />
      </div>

      <ExportPanel sqlQuery={sqlQuery} rows={rows} filename={buildExportFilename(intent, toolName)} />

      {sqlQuery && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <PanelTitle icon={<Database size={16} />} title="Query summary" />
          <pre className="mt-3 overflow-x-auto rounded-xl bg-black/30 p-4 text-xs leading-6 text-slate-200">
            <code>{sqlQuery}</code>
          </pre>
        </div>
      )}

      {trend.length >= 2 && <TrendPanel points={trend} />}
      {trend.length < 2 && ranking.length >= 2 && <RankingPanel points={ranking} />}

      {rows.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <PanelTitle icon={<FileJson size={16} />} title="Result preview" />
          <p className="mt-1 text-xs leading-5 text-slate-500">
            First {Math.min(rows.length, 50)} rows attached to the answer.
          </p>

          <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-white/10 text-slate-300">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">
                      {humanizeColumn(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-white/10">
                    {columns.map((column) => (
                      <td key={column} className="whitespace-nowrap px-3 py-2 text-slate-300">
                        {formatCell(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessPanel({ message }: { message: Message | null }) {
  const metadata = getRecord(message?.metadata);
  const steps = buildProcessSteps(metadata);
  const originalQuestion = getString(metadata.originalQuestion);
  const resolvedQuestion = getString(metadata.resolvedQuestion);
  const followUp = getRecord(metadata.followUpResolution);
  const router = getRecord(metadata.router);
  const composer = getComposerTrace(metadata.composer);
  const verification = getVerificationTrace(metadata.verification);

  if (metadata.conversational === true) {
    return (
      <div className="space-y-4">
        <InfoBanner tone="emerald">
          This was a conversational response, so PharmaRev did not query public datasets.
        </InfoBanner>
        <InfoCard label="Intent" value={getString(metadata.intent, "conversational_help_or_greeting")} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
        <PanelTitle icon={<GitBranch size={16} />} title="Question handling" />
        <div className="mt-3 grid gap-3">
          <InfoCard label="Original question" value={originalQuestion || "Not stored"} />
          <InfoCard
            label="Resolved question"
            value={resolvedQuestion || originalQuestion || "Not stored"}
          />
          {(getString(followUp.reason) || getString(followUp.method)) && (
            <InfoCard
              label="Follow-up handling"
              value={`${getString(followUp.method, "context resolver")} — ${getString(
                followUp.reason,
                "Recent chat context was checked before routing."
              )}`}
            />
          )}
        </div>
      </section>

      <RouterCard router={router} metadata={metadata} />
      <ComposerCard composer={composer} />
      <VerificationCard verification={verification} />

      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-white">Step-by-step process</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            This is a safe trace of observable system steps, not hidden reasoning.
          </p>
        </div>

        {steps.map((step, index) => (
          <div key={step.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-400/15 text-sm font-semibold text-emerald-300">
                {index + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h5 className="text-sm font-semibold text-white">{step.name}</h5>
                  <StatusBadge status={step.status} />
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-300">{step.summary}</p>
              </div>
            </div>
            <div className="space-y-2">
              {step.details.map((detail) => (
                <div key={detail} className="rounded-xl bg-black/20 px-3 py-2 text-sm leading-6 text-slate-300">
                  {detail}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function EvidenceSummary({ sources }: { sources: SourceEvidence[] }) {
  const sql = sources.filter((source) => source.citationType === "sql").length;
  const kb = sources.filter((source) => source.citationType === "kb").length;
  const limit = sources.filter((source) => source.citationType === "limit").length;

  return (
    <div className="grid grid-cols-3 gap-3">
      <InfoCard label="SQL evidence" value={String(sql)} />
      <InfoCard label="FDA evidence" value={String(kb)} />
      <InfoCard label="Limit notes" value={String(limit)} />
    </div>
  );
}

function buildEvidenceGroups(sources: SourceEvidence[]): EvidenceGroup[] {
  const sqlSources = sources.filter((source) => source.citationType === "sql");
  const kbSources = sources.filter((source) => source.citationType === "kb");
  const limitSources = sources.filter((source) => source.citationType === "limit");
  const otherSources = sources.filter(
    (source) => !source.citationType || !["sql", "kb", "limit"].includes(source.citationType)
  );

  return [
    {
      key: "sql" as const,
      title: "SQL evidence",
      description: "Structured public-data records used for numeric claims.",
      icon: <Database size={16} />,
      sources: sqlSources,
    },
    {
      key: "kb" as const,
      title: "FDA label evidence",
      description: "Relevant openFDA label evidence used for label context.",
      icon: <FileText size={16} />,
      sources: kbSources,
    },
    {
      key: "limit" as const,
      title: "Scope and limitation notes",
      description: "Guardrails that prevent unsupported private-data or clinical claims.",
      icon: <ShieldCheck size={16} />,
      sources: limitSources,
    },
    {
      key: "other" as const,
      title: "Other evidence",
      description: "Additional evidence metadata attached to the answer.",
      icon: <Search size={16} />,
      sources: otherSources,
    },
  ].filter((group) => group.sources.length > 0);
}

function RouterCard({ router, metadata }: { router: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const planner = getRecord(router.planner);
  const intent = getString(router.intent) || getString(metadata.intent);
  const confidence = getString(router.confidence, "Not stored");
  const route = getString(router.route) || getString(metadata.route);
  const toolName = getString(router.toolName) || getString(metadata.toolName) || getString(metadata.agent);
  const reason = getString(planner.reason) || getString(router.reason) || "No router reason was stored.";

  return (
    <section className="rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4">
      <PanelTitle icon={<GitBranch size={16} />} title="Router decision" />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <InfoCard label="Route" value={route || "Not stored"} />
        <InfoCard label="Intent" value={intent || "Not stored"} />
        <InfoCard label="Confidence" value={confidence} />
        <InfoCard label="Selected agent" value={toolName || "Not stored"} />
        <InfoCard label="Planner status" value={getString(planner.status, "Not stored")} />
        <InfoCard label="Used LLM" value={planner.usedLlm === true ? "Yes" : "No"} />
      </div>
      <div className="mt-3 rounded-xl bg-black/20 p-3 text-sm leading-6 text-blue-100/90">
        {reason}
      </div>
    </section>
  );
}

function ComposerCard({ composer }: { composer: ComposerTrace }) {
  const used = composer.usedLlm || composer.status === "used";

  return (
    <section className={`rounded-2xl border p-4 ${used ? "border-purple-400/20 bg-purple-400/10" : "border-white/10 bg-white/[0.03]"}`}>
      <PanelTitle icon={<Sparkles size={16} />} title="Answer composer" />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <InfoCard label="Enabled" value={composer.enabled ? "Yes" : "No"} />
        <InfoCard label="Used LLM" value={composer.usedLlm ? "Yes" : "No"} />
        <InfoCard label="Provider" value={composer.provider || "Not stored"} />
        <InfoCard label="Model" value={composer.model || "Not stored"} />
        <InfoCard label="Status" value={composer.status || "Not stored"} />
        <InfoCard label="Answer mode" value={used ? "LLM-polished" : "Deterministic"} />
      </div>
      <div className="mt-3 rounded-xl bg-black/20 p-3 text-sm leading-6 text-slate-200">
        {composer.reason || "No composer reason was stored."}
      </div>
    </section>
  );
}

function VerificationCard({ verification }: { verification: VerificationTrace }) {
  const status = verification.status || "Not stored";
  const isWarning = status.toLowerCase().includes("warn") || verification.warnings.length > 0;
  const isFail = status.toLowerCase().includes("fail");

  return (
    <section className={`rounded-2xl border p-4 ${isFail ? "border-red-400/20 bg-red-400/10" : isWarning ? "border-amber-400/20 bg-amber-400/10" : "border-emerald-400/20 bg-emerald-400/10"}`}>
      <PanelTitle icon={<ShieldCheck size={16} />} title="Verifier" />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <InfoCard label="Status" value={status} />
        <InfoCard label="Warnings" value={String(verification.warnings.length)} />
      </div>
      <div className="mt-3 rounded-xl bg-black/20 p-3 text-sm leading-6 text-slate-200">
        {verification.reason || "No verifier reason was stored."}
      </div>
      {verification.warnings.length > 0 && (
        <div className="mt-3 space-y-2">
          {verification.warnings.map((warning) => (
            <div key={warning} className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm leading-6 text-amber-100">
              {warning}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function buildProcessSteps(metadata: Record<string, unknown>) {
  const route = getString(metadata.route, "Unknown route");
  const toolName = getString(metadata.toolName) || getString(metadata.agent, "Not stored");
  const rows = getRows(metadata.rows);
  const sources = getSources(metadata.sources);
  const sqlCount = sources.filter((source) => source.citationType === "sql").length;
  const kbCount = sources.filter((source) => source.citationType === "kb").length;
  const limitCount = sources.filter((source) => source.citationType === "limit").length;
  const composer = getComposerTrace(metadata.composer);
  const verification = getVerificationTrace(metadata.verification);

  const steps = [
    {
      id: "route",
      name: "Route selected",
      status: "complete" as const,
      summary: `Classified this message as ${route}.`,
      details: [`Selected agent: ${toolName}`],
    },
    {
      id: "tool",
      name: "Agent executed",
      status: toolName === "Not stored" ? ("warning" as const) : ("complete" as const),
      summary: `${toolName} handled the request.`,
      details: [
        rows.length > 0 ? `Attached database rows: ${rows.length}` : "No database rows were attached.",
        `SQL evidence cards: ${sqlCount}`,
        `FDA label evidence cards: ${kbCount}`,
      ],
    },
    {
      id: "evidence",
      name: "Evidence attached",
      status: sources.length > 0 ? ("complete" as const) : ("warning" as const),
      summary: `${sources.length} evidence cards were attached to the answer.`,
      details: [`SQL: ${sqlCount}`, `FDA label: ${kbCount}`, `Limits: ${limitCount}`],
    },
    {
      id: "composer",
      name: "Answer composed",
      status: composer.usedLlm || composer.status === "used" ? ("complete" as const) : ("warning" as const),
      summary: composer.usedLlm ? "The answer was polished by the LLM composer." : "A deterministic answer was used.",
      details: [
        `Composer enabled: ${composer.enabled ? "yes" : "no"}`,
        `Composer status: ${composer.status || "not stored"}`,
        composer.reason || "No composer reason was stored.",
      ],
    },
    {
      id: "verification",
      name: "Answer checked",
      status: verification.status.toLowerCase().includes("fail") ? ("failed" as const) : verification.warnings.length > 0 ? ("warning" as const) : ("complete" as const),
      summary: verification.status || "Verification metadata was checked.",
      details: [verification.reason || "No verifier reason was stored.", `Warnings: ${verification.warnings.length}`],
    },
  ];

  return steps;
}

function ExportPanel({ sqlQuery, rows, filename }: { sqlQuery: string; rows: Record<string, unknown>[]; filename: string }) {
  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
      <h4 className="text-sm font-semibold text-emerald-100">Export evidence</h4>
      <p className="mt-1 text-xs leading-5 text-emerald-100/75">
        Copy or download the exact query summary and rows attached to this answer.
      </p>

      <div className="mt-3 grid gap-2">
        <button onClick={() => copyText(sqlQuery)} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-black/30">
          <Clipboard size={14} />
          Copy query summary
        </button>
        <button onClick={() => downloadRowsAsCsv(rows, filename)} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-black/30">
          <Download size={14} />
          Download rows as CSV
        </button>
        <button onClick={() => copyText(JSON.stringify(rows, null, 2))} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-black/30">
          <FileJson size={14} />
          Copy rows as JSON
        </button>
      </div>
    </div>
  );
}

function TrendPanel({ points }: { points: { year: number; value: number; label: string }[] }) {
  const max = Math.max(...points.map((point) => point.value));
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.value - first.value;

  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
      <h4 className="text-sm font-semibold text-emerald-100">Trend preview</h4>
      <div className="mt-4 space-y-3">
        {points.map((point) => (
          <BarRow
            key={point.year}
            label={String(point.year)}
            valueLabel={point.label}
            width={max > 0 ? (point.value / max) * 100 : 0}
            tone="emerald"
          />
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-black/20 p-3 text-xs leading-5 text-emerald-100/85">
        Change from {first.year} to {last.year}: {formatCurrency(change)}
      </div>
    </div>
  );
}

function RankingPanel({ points }: { points: { label: string; value: number; valueLabel: string }[] }) {
  const top = points.slice(0, 8);
  const max = Math.max(...top.map((point) => point.value));

  return (
    <div className="rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4">
      <h4 className="text-sm font-semibold text-blue-100">Ranking preview</h4>
      <div className="mt-4 space-y-3">
        {top.map((point, index) => (
          <BarRow
            key={`${point.label}-${index}`}
            label={`${index + 1}. ${point.label}`}
            valueLabel={point.valueLabel}
            width={max > 0 ? (point.value / max) * 100 : 0}
            tone="blue"
          />
        ))}
      </div>
    </div>
  );
}

function BarRow({ label, valueLabel, width, tone }: { label: string; valueLabel: string; width: number; tone: "blue" | "emerald" }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={`max-w-[320px] truncate font-medium ${tone === "blue" ? "text-blue-100" : "text-emerald-100"}`}>{label}</span>
        <span className={tone === "blue" ? "text-blue-100/80" : "text-emerald-100/80"}>{valueLabel}</span>
      </div>
      <div className="h-3 rounded-full bg-black/30">
        <div className={`h-3 rounded-full ${tone === "blue" ? "bg-blue-300" : "bg-emerald-300"}`} style={{ width: `${Math.max(width, 4)}%` }} />
      </div>
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-100">
      <span className="text-emerald-300">{icon}</span>
      <h4 className="text-sm font-semibold">{title}</h4>
    </div>
  );
}

function InfoBanner({ children, tone }: { children: React.ReactNode; tone: "emerald" | "amber" }) {
  return (
    <div className={`rounded-2xl border p-4 text-sm leading-6 ${tone === "emerald" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100" : "border-amber-400/20 bg-amber-400/10 text-amber-100"}`}>
      {children}
    </div>
  );
}

function EmptyPanel({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-amber-400/15 p-2 text-amber-200">{icon}</div>
        <div>
          <h4 className="text-sm font-semibold text-amber-100">{title}</h4>
          <p className="mt-1 text-sm leading-6 text-amber-100/80">{description}</p>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="break-words text-sm leading-6 text-slate-200">{value}</p>
    </div>
  );
}

function CitationBadge({ label, type }: { label: string; type?: "sql" | "kb" | "limit" }) {
  const className =
    type === "sql"
      ? "bg-blue-400/15 text-blue-300"
      : type === "kb"
      ? "bg-purple-400/15 text-purple-300"
      : type === "limit"
      ? "bg-amber-400/15 text-amber-300"
      : "bg-white/10 text-slate-300";

  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

function SourceStatusBadge({ status }: { status: "used" | "rejected" }) {
  const className = status === "used" ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300";
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>{status}</span>;
}

function StatusBadge({ status }: { status: "complete" | "warning" | "failed" }) {
  const className =
    status === "complete"
      ? "bg-emerald-400/15 text-emerald-300"
      : status === "warning"
      ? "bg-amber-400/15 text-amber-300"
      : "bg-red-400/15 text-red-300";
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>{status}</span>;
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item)) : [];
}

function getSources(value: unknown): SourceEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSourceEvidence);
}

function isSourceEvidence(value: unknown): value is SourceEvidence {
  const source = getRecord(value);
  return Boolean(
    typeof source.id === "string" &&
    typeof source.title === "string" &&
    typeof source.dataset === "string" &&
    typeof source.score === "number" &&
    (source.status === "used" || source.status === "rejected") &&
    typeof source.excerpt === "string" &&
    Array.isArray(source.metadata)
  );
}

function getComposerTrace(value: unknown): ComposerTrace {
  const composer = getRecord(value);
  return {
    enabled: composer.enabled === true,
    usedLlm: composer.usedLlm === true,
    provider: getString(composer.provider, "not stored"),
    model: getString(composer.model, "not stored"),
    status: getString(composer.status, "not stored"),
    reason: getString(composer.reason, "No composer reason was stored."),
  };
}

function getVerificationTrace(value: unknown): VerificationTrace {
  const verification = getRecord(value);
  const warnings = Array.isArray(verification.warnings)
    ? verification.warnings.filter((item): item is string => typeof item === "string")
    : [];

  return {
    status: getString(verification.status, "not stored"),
    reason: getString(verification.reason, "No verifier reason was stored."),
    warnings,
    score: typeof verification.score === "number" ? verification.score : undefined,
  };
}

function getColumns(rows: Record<string, unknown>[]) {
  const columns = new Set<string>();
  rows.slice(0, 20).forEach((row) => Object.keys(row).forEach((key) => columns.add(key)));
  return Array.from(columns);
}

function humanizeColumn(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "") return numeric.toLocaleString("en-US");
    return value;
  }
  return JSON.stringify(value);
}

function buildTrendPoints(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => {
      const year = Number(row.year);
      const value = getMetricValue(row, ["total_spending", "total_drug_cost", "spending", "latest_spending"]);
      if (!Number.isFinite(year) || !Number.isFinite(value)) return null;
      return { year, value, label: formatCurrency(value) };
    })
    .filter((item): item is { year: number; value: number; label: string } => Boolean(item))
    .sort((a, b) => a.year - b.year);
}

function buildRankingPoints(rows: Record<string, unknown>[]) {
  const metricKeys = [
    "total_spending",
    "total_drug_cost",
    "spending_increase",
    "latest_spending",
    "total_payment_amount",
    "total_payments",
    "payment_amount",
    "total_quantity",
    "claims",
  ];

  return rows
    .map((row) => {
      const value = getMetricValue(row, metricKeys);
      if (!Number.isFinite(value)) return null;
      return {
        label: getRowLabel(row),
        value,
        valueLabel: metricLooksCurrency(row) ? formatCurrency(value) : value.toLocaleString("en-US"),
      };
    })
    .filter((item): item is { label: string; value: number; valueLabel: string } => Boolean(item))
    .sort((a, b) => b.value - a.value);
}

function getMetricValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

function getRowLabel(row: Record<string, unknown>) {
  const fields = [
    "drug",
    "brand_name",
    "generic_name",
    "manufacturer",
    "company_name",
    "company",
    "recipient_name",
    "provider_name",
    "location",
    "provider_state",
    "category",
    "atc_class",
  ];

  for (const field of fields) {
    const value = getString(row[field]);
    if (value) return value;
  }

  return "Record";
}

function metricLooksCurrency(row: Record<string, unknown>) {
  return Object.keys(row).some((key) => key.includes("spending") || key.includes("cost") || key.includes("payment"));
}

function copyText(value: string) {
  navigator.clipboard.writeText(value || "").catch((error) => console.error("Copy failed", error));
}

function downloadRowsAsCsv(rows: Record<string, unknown>[], filename: string) {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function rowsToCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const columns = getColumns(rows);
  const header = columns.map(escapeCsv).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsv(formatRaw(row[column]))).join(",")).join("\n");
  return `${header}\n${body}`;
}

function escapeCsv(value: string) {
  const escaped = value.replace(/"/g, '""');
  return escaped.includes(",") || escaped.includes("\n") || escaped.includes('"') ? `"${escaped}"` : escaped;
}

function formatRaw(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function buildExportFilename(intent: string, agent: string) {
  const base = intent || agent || "query-evidence";
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${safe || "query-evidence"}-${new Date().toISOString().slice(0, 10)}.csv`;
}

function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "not available";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

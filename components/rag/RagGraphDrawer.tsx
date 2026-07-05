"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import type { Message } from "@/types/chat";
import { RagGraph } from "@/components/rag/RagGraph";
import { buildTraceFromMessage } from "@/lib/rag/buildTraceFromMessage";

type RagGraphDrawerProps = {
  isOpen: boolean;
  message: Message | null;
  onClose: () => void;
};

export function RagGraphDrawer({
  isOpen,
  message,
  onClose,
}: RagGraphDrawerProps) {
  const trace = useMemo(() => buildTraceFromMessage(message), [message]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-sm"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-[94vw] max-w-7xl flex-col border-l border-white/10 bg-[#0f172a] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <h3 className="text-base font-semibold text-white">Answer flow</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
              Message-specific trace showing how PharmaRev interpreted the question,
              selected tools, attached evidence, applied limits, and produced the final answer.
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close answer flow"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-3 border-b border-white/10 p-4 md:grid-cols-4">
          <SummaryCard label="Route" value={trace.route} />
          <SummaryCard label="Agent" value={trace.toolName} />
          <SummaryCard label="Confidence" value={trace.confidence} />
          <SummaryCard label="Answer mode" value={trace.answerMode} />
        </div>

        <div className="border-b border-white/10 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <QuestionCard label="Original question" value={trace.question} />
            <QuestionCard
              label="Resolved question"
              value={trace.resolvedQuestion || trace.question}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 p-4">
          <RagGraph trace={trace} />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="mb-1 text-xs text-slate-500">{label}</p>
      <p className="line-clamp-2 text-sm font-medium text-slate-100">
        {value || "Not stored"}
      </p>
    </div>
  );
}

function QuestionCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="line-clamp-2 text-sm leading-6 text-slate-200">
        {value || "Not stored"}
      </p>
    </div>
  );
}

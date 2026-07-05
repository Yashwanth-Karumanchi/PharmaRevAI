"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import MarkdownMessage from "@/components/MarkdownMessage";
import {
  Activity,
  BarChart3,
  Database,
  Network,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import type { AnswerDrawerType } from "@/types/evidence";
import type { Message } from "@/types/chat";
import { ChatInput } from "./ChatInput";
import { EmptyState } from "./EmptyState";
import { ThinkingBubble } from "./ThinkingBubble";

type ChatWindowProps = {
  messages: Message[];
  input: string;
  isSending: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onUsePrompt: (prompt: string) => void;
  onOpenAnswerDrawer: (
    type: Exclude<AnswerDrawerType, null>,
    message: Message,
    citationLabel?: string
  ) => void;
  onOpenRagGraph: (message: Message) => void;
};

type FeedbackRating = "helpful" | "not_helpful";
type CitationType = "sql" | "kb" | "limit";

type CitationChip = {
  label: string;
  type?: CitationType;
};

export function ChatWindow({
  messages,
  input,
  isSending,
  onInputChange,
  onSend,
  onUsePrompt,
  onOpenAnswerDrawer,
  onOpenRagGraph,
}: ChatWindowProps) {
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<
    Record<string, FeedbackRating>
  >({});

  const visibleMessages = messages.filter(
    (message) => !isWelcomeMessage(message)
  );

  const shouldShowPromptCards = !visibleMessages.some(
    (message) => message.role === "user"
  );

  const latestEvidenceMessage = [...visibleMessages]
    .reverse()
    .find(
      (message) => message.role === "assistant" && hasAnswerArtifacts(message)
    );

  useEffect(() => {
    scrollToLatestMessage("smooth");
  }, [messages.length, isSending]);

  function scrollToLatestMessage(behavior: ScrollBehavior = "smooth") {
    requestAnimationFrame(() => {
      bottomAnchorRef.current?.scrollIntoView({
        behavior,
        block: "end",
      });
    });
  }

  function handleUsePrompt(prompt: string) {
    onUsePrompt(prompt);
    scrollToLatestMessage("smooth");
  }

  function handleSend() {
    onSend();
    scrollToLatestMessage("smooth");
  }

  async function handleFeedback(message: Message, rating: FeedbackRating) {
    const previousRating =
      feedbackByMessageId[message.id] ?? getSavedFeedbackRating(message);

    setFeedbackByMessageId((current) => ({
      ...current,
      [message.id]: rating,
    }));

    try {
      const response = await fetch(`/api/messages/${message.id}/feedback`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rating,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save feedback");
      }
    } catch (error) {
      console.error(error);

      setFeedbackByMessageId((current) => {
        const next = { ...current };

        if (previousRating) {
          next[message.id] = previousRating;
        } else {
          delete next[message.id];
        }

        return next;
      });
    }
  }

  function getCurrentFeedback(message: Message) {
    return feedbackByMessageId[message.id] ?? getSavedFeedbackRating(message);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-6">
        <div>
          <h2 className="text-sm font-semibold">PharmaRev assistant</h2>
          <p className="text-xs text-slate-400">
            Public pharma evidence, citations, query details, and answer flow
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/data-coverage"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <Database size={16} />
            Data coverage
          </Link>

          <Link
            href="/system-health"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <Activity size={16} />
            Health
          </Link>

          <Link
            href="/evaluation"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <BarChart3 size={16} />
            Review
          </Link>

          <button
            onClick={() => {
              if (latestEvidenceMessage) {
                onOpenRagGraph(latestEvidenceMessage);
              }
            }}
            disabled={!latestEvidenceMessage}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Network size={16} />
            Answer flow
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 py-6">
          <div className="mx-auto max-w-5xl space-y-4">
            {shouldShowPromptCards && (
              <EmptyState onPromptClick={handleUsePrompt} />
            )}

            {visibleMessages.map((message) => {
              const isUser = message.role === "user";
              const isAssistant = message.role === "assistant";
              const hasArtifacts = isAssistant && hasAnswerArtifacts(message);

              return (
                <div
                  key={message.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                      isUser
                        ? "max-w-[80%] whitespace-pre-wrap bg-emerald-500 text-emerald-950"
                        : "w-full max-w-[95%] border border-white/10 bg-white/5 text-slate-100"
                    }`}
                  >
                    {isAssistant ? (
                      <MarkdownMessage content={message.content || ""} />
                    ) : (
                      message.content
                    )}

                    {hasArtifacts && (
                      <CitationChips
                        message={message}
                        onCitationClick={(citationLabel) =>
                          onOpenAnswerDrawer("sources", message, citationLabel)
                        }
                      />
                    )}

                    {hasArtifacts && (
                      <AnswerControls
                        message={message}
                        onOpenAnswerDrawer={onOpenAnswerDrawer}
                        onOpenRagGraph={onOpenRagGraph}
                      />
                    )}

                    {hasArtifacts && (
                      <FeedbackButtons
                        currentRating={getCurrentFeedback(message)}
                        onRate={(rating) => handleFeedback(message, rating)}
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {isSending && <ThinkingBubble />}

            <div ref={bottomAnchorRef} className="h-1" />
          </div>
        </div>
      </div>

      <ChatInput
        input={input}
        isSending={isSending}
        onInputChange={onInputChange}
        onSend={handleSend}
      />
    </section>
  );
}

function AnswerControls({
  message,
  onOpenAnswerDrawer,
  onOpenRagGraph,
}: {
  message: Message;
  onOpenAnswerDrawer: (
    type: Exclude<AnswerDrawerType, null>,
    message: Message,
    citationLabel?: string
  ) => void;
  onOpenRagGraph: (message: Message) => void;
}) {
  const hasEvidence = getCitationLabels(message).length > 0;
  const hasQuery = hasSqlArtifacts(message);
  const hasProcess = hasProcessArtifacts(message);

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
      {hasEvidence && (
        <button
          onClick={() => onOpenAnswerDrawer("sources", message)}
          className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-300 transition hover:bg-white/15"
        >
          Evidence
        </button>
      )}

      {hasQuery && (
        <button
          onClick={() => onOpenAnswerDrawer("sql", message)}
          className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-300 transition hover:bg-white/15"
        >
          Query
        </button>
      )}

      {hasProcess && (
        <button
          onClick={() => onOpenAnswerDrawer("agentSteps", message)}
          className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-300 transition hover:bg-white/15"
        >
          Process
        </button>
      )}

      <button
        onClick={() => onOpenRagGraph(message)}
        className="rounded-lg bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300 transition hover:bg-emerald-500/25"
      >
        Answer flow
      </button>
    </div>
  );
}

function FeedbackButtons({
  currentRating,
  onRate,
}: {
  currentRating?: FeedbackRating;
  onRate: (rating: FeedbackRating) => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
      <span className="text-xs text-slate-500">Was this answer useful?</span>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onRate("helpful")}
          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${
            currentRating === "helpful"
              ? "bg-emerald-400/20 text-emerald-300"
              : "bg-white/10 text-slate-300 hover:bg-white/15"
          }`}
        >
          <ThumbsUp size={13} />
          Helpful
        </button>

        <button
          onClick={() => onRate("not_helpful")}
          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${
            currentRating === "not_helpful"
              ? "bg-red-400/20 text-red-300"
              : "bg-white/10 text-slate-300 hover:bg-white/15"
          }`}
        >
          <ThumbsDown size={13} />
          Not helpful
        </button>
      </div>
    </div>
  );
}

function CitationChips({
  message,
  onCitationClick,
}: {
  message: Message;
  onCitationClick: (citationLabel: string) => void;
}) {
  const citations = getCitationLabels(message);

  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
      {citations.map((citation) => (
        <button
          key={citation.label}
          onClick={() => onCitationClick(citation.label)}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition hover:scale-105 ${getCitationClassName(
            citation.type
          )}`}
        >
          {citation.label}
        </button>
      ))}
    </div>
  );
}

function getCitationLabels(message: Message): CitationChip[] {
  const sources = message.metadata?.sources;

  if (!Array.isArray(sources)) {
    return [];
  }

  return sources
    .filter(isRecord)
    .map((source): CitationChip => {
      const label =
        typeof source.citationLabel === "string" ? source.citationLabel : "";

      return {
        label,
        type: normalizeCitationType(source.citationType),
      };
    })
    .filter((citation) => citation.label.length > 0)
    .slice(0, 8);
}

function normalizeCitationType(value: unknown): CitationType | undefined {
  if (value === "sql" || value === "kb" || value === "limit") {
    return value;
  }

  return undefined;
}

function getSavedFeedbackRating(message: Message): FeedbackRating | undefined {
  const feedback = message.metadata?.feedback;

  if (!isRecord(feedback)) {
    return undefined;
  }

  if (feedback.rating === "helpful" || feedback.rating === "not_helpful") {
    return feedback.rating;
  }

  return undefined;
}

function getCitationClassName(type?: CitationType) {
  if (type === "sql") {
    return "bg-blue-400/15 text-blue-300";
  }

  if (type === "kb") {
    return "bg-purple-400/15 text-purple-300";
  }

  if (type === "limit") {
    return "bg-amber-400/15 text-amber-300";
  }

  return "bg-white/10 text-slate-300";
}

function isWelcomeMessage(message: Message) {
  return (
    message.role === "assistant" &&
    message.content.toLowerCase().startsWith("new chat started")
  );
}

function hasAnswerArtifacts(message: Message) {
  const metadata = message.metadata;

  if (!metadata || metadata.conversational === true) {
    return false;
  }

  return Boolean(
    getCitationLabels(message).length > 0 ||
      hasSqlArtifacts(message) ||
      hasProcessArtifacts(message)
  );
}

function hasSqlArtifacts(message: Message) {
  const metadata = message.metadata;

  if (!metadata) return false;

  const hasRows = Array.isArray(metadata.rows) && metadata.rows.length > 0;
  const hasQuery =
    typeof metadata.sqlQuery === "string" && metadata.sqlQuery.trim().length > 0;

  return Boolean(hasRows || hasQuery || metadata.sqlEvidence);
}

function hasProcessArtifacts(message: Message) {
  const metadata = message.metadata;

  if (!metadata) return false;

  return Boolean(
    metadata.router ||
      metadata.registry ||
      metadata.verification ||
      metadata.followUpResolution ||
      metadata.resolvedQuestion
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
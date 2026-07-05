import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

export const dynamic = "force-dynamic";

type RatingFilter = "all" | "rated" | "unrated" | "helpful" | "not_helpful";

type EvaluationFilters = {
  rating: RatingFilter;
  intent: string;
  agent: string;
};

type SummaryRow = {
  total_assistant_messages: number;
  rated_answers: number;
  helpful_count: number;
  not_helpful_count: number;
};

type BreakdownRow = {
  label: string | null;
  total_answers: number;
  rated_answers: number;
  helpful_count: number;
  not_helpful_count: number;
};

type FilterOptionRow = {
  label: string | null;
};

type RecentFeedbackRow = {
  id: string;
  content: string;
  created_at: string;
  rating: string | null;
  feedback_updated_at: string | null;
  intent: string | null;
  agent: string | null;
  route: string | null;
  original_question: string | null;
};

function safePercent(numerator: number, denominator: number) {
  if (denominator === 0) {
    return 0;
  }

  return Number(((numerator / denominator) * 100).toFixed(1));
}

function normalizeBreakdownRows(rows: BreakdownRow[]) {
  return rows.map((row) => ({
    label: row.label || "Unknown",
    totalAnswers: Number(row.total_answers),
    ratedAnswers: Number(row.rated_answers),
    helpfulCount: Number(row.helpful_count),
    notHelpfulCount: Number(row.not_helpful_count),
    feedbackRate: safePercent(
      Number(row.rated_answers),
      Number(row.total_answers)
    ),
    helpfulRate: safePercent(
      Number(row.helpful_count),
      Number(row.rated_answers)
    ),
  }));
}

function normalizeOptions(rows: FilterOptionRow[]) {
  return rows
    .map((row) => row.label || "Unknown")
    .filter((label, index, array) => array.indexOf(label) === index)
    .sort((a, b) => a.localeCompare(b));
}

function parseFilters(request: Request): EvaluationFilters {
  const url = new URL(request.url);
  const ratingValue = url.searchParams.get("rating");
  const intentValue = url.searchParams.get("intent");
  const agentValue = url.searchParams.get("agent");

  const rating: RatingFilter =
    ratingValue === "rated" ||
    ratingValue === "unrated" ||
    ratingValue === "helpful" ||
    ratingValue === "not_helpful"
      ? ratingValue
      : "all";

  return {
    rating,
    intent: intentValue && intentValue !== "all" ? intentValue : "all",
    agent: agentValue && agentValue !== "all" ? agentValue : "all",
  };
}

function buildWhereSql(filters: EvaluationFilters) {
  const clauses = [sql`role = 'assistant'`];

  if (filters.intent !== "all") {
    clauses.push(sql`coalesce(metadata->>'intent', 'Unknown') = ${filters.intent}`);
  }

  if (filters.agent !== "all") {
    clauses.push(sql`coalesce(metadata->>'agent', 'Unknown') = ${filters.agent}`);
  }

  if (filters.rating === "rated") {
    clauses.push(
      sql`metadata->'feedback'->>'rating' in ('helpful', 'not_helpful')`
    );
  }

  if (filters.rating === "unrated") {
    clauses.push(sql`
      (
        metadata->'feedback'->>'rating' is null
        or metadata->'feedback'->>'rating' not in ('helpful', 'not_helpful')
      )
    `);
  }

  if (filters.rating === "helpful") {
    clauses.push(sql`metadata->'feedback'->>'rating' = 'helpful'`);
  }

  if (filters.rating === "not_helpful") {
    clauses.push(sql`metadata->'feedback'->>'rating' = 'not_helpful'`);
  }

  return clauses.reduce((current, clause) => sql`${current} and ${clause}`);
}

export async function GET(request: Request) {
  try {
    const filters = parseFilters(request);
    const whereSql = buildWhereSql(filters);

    const summaryRows = await sql<SummaryRow[]>`
      select
        count(*)::int as total_assistant_messages,
        count(*) filter (
          where metadata->'feedback'->>'rating' in ('helpful', 'not_helpful')
        )::int as rated_answers,
        count(*) filter (
          where metadata->'feedback'->>'rating' = 'helpful'
        )::int as helpful_count,
        count(*) filter (
          where metadata->'feedback'->>'rating' = 'not_helpful'
        )::int as not_helpful_count
      from chat_messages
      where ${whereSql}
    `;

    const summaryRow = summaryRows[0];

    const totalAssistantMessages = Number(
      summaryRow?.total_assistant_messages ?? 0
    );
    const ratedAnswers = Number(summaryRow?.rated_answers ?? 0);
    const helpfulCount = Number(summaryRow?.helpful_count ?? 0);
    const notHelpfulCount = Number(summaryRow?.not_helpful_count ?? 0);

    const byIntentRows = await sql<BreakdownRow[]>`
      select
        coalesce(metadata->>'intent', 'Unknown') as label,
        count(*)::int as total_answers,
        count(*) filter (
          where metadata->'feedback'->>'rating' in ('helpful', 'not_helpful')
        )::int as rated_answers,
        count(*) filter (
          where metadata->'feedback'->>'rating' = 'helpful'
        )::int as helpful_count,
        count(*) filter (
          where metadata->'feedback'->>'rating' = 'not_helpful'
        )::int as not_helpful_count
      from chat_messages
      where ${whereSql}
      group by coalesce(metadata->>'intent', 'Unknown')
      order by total_answers desc
    `;

    const byAgentRows = await sql<BreakdownRow[]>`
      select
        coalesce(metadata->>'agent', 'Unknown') as label,
        count(*)::int as total_answers,
        count(*) filter (
          where metadata->'feedback'->>'rating' in ('helpful', 'not_helpful')
        )::int as rated_answers,
        count(*) filter (
          where metadata->'feedback'->>'rating' = 'helpful'
        )::int as helpful_count,
        count(*) filter (
          where metadata->'feedback'->>'rating' = 'not_helpful'
        )::int as not_helpful_count
      from chat_messages
      where ${whereSql}
      group by coalesce(metadata->>'agent', 'Unknown')
      order by total_answers desc
    `;

    const intentOptionRows = await sql<FilterOptionRow[]>`
      select distinct coalesce(metadata->>'intent', 'Unknown') as label
      from chat_messages
      where role = 'assistant'
      order by label asc
    `;

    const agentOptionRows = await sql<FilterOptionRow[]>`
      select distinct coalesce(metadata->>'agent', 'Unknown') as label
      from chat_messages
      where role = 'assistant'
      order by label asc
    `;

    const recentFeedbackRows = await sql<RecentFeedbackRow[]>`
      select
        id,
        content,
        created_at::text,
        metadata->'feedback'->>'rating' as rating,
        metadata->'feedback'->>'updatedAt' as feedback_updated_at,
        metadata->>'intent' as intent,
        metadata->>'agent' as agent,
        metadata->>'route' as route,
        metadata->>'originalQuestion' as original_question
      from chat_messages
      where ${whereSql}
      order by
        coalesce(metadata->'feedback'->>'updatedAt', created_at::text) desc,
        created_at desc
      limit 50
    `;

    return NextResponse.json({
      ok: true,
      filters,
      filterOptions: {
        ratings: ["all", "rated", "unrated", "helpful", "not_helpful"],
        intents: normalizeOptions(intentOptionRows),
        agents: normalizeOptions(agentOptionRows),
      },
      summary: {
        totalAssistantMessages,
        ratedAnswers,
        helpfulCount,
        notHelpfulCount,
        unratedAnswers: Math.max(totalAssistantMessages - ratedAnswers, 0),
        feedbackRate: safePercent(ratedAnswers, totalAssistantMessages),
        helpfulRate: safePercent(helpfulCount, ratedAnswers),
      },
      byIntent: normalizeBreakdownRows(byIntentRows),
      byAgent: normalizeBreakdownRows(byAgentRows),
      recentFeedback: recentFeedbackRows.map((row) => ({
        id: row.id,
        rating: row.rating,
        content: row.content,
        createdAt: row.created_at,
        feedbackUpdatedAt: row.feedback_updated_at,
        intent: row.intent || "Unknown",
        agent: row.agent || "Unknown",
        route: row.route || "Unknown",
        originalQuestion: row.original_question || "Question not stored",
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown evaluation error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
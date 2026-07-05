import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

export const dynamic = "force-dynamic";

type RatingFilter = "all" | "rated" | "unrated" | "helpful" | "not_helpful";

type EvaluationFilters = {
  rating: RatingFilter;
  intent: string;
  agent: string;
};

type ExportRow = {
  id: string;
  chat_session_id: string;
  content: string;
  created_at: string;
  rating: string | null;
  feedback_updated_at: string | null;
  intent: string | null;
  agent: string | null;
  route: string | null;
  original_question: string | null;
  sql_query: string | null;
  row_count: number;
};

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
    clauses.push(
      sql`coalesce(metadata->>'intent', 'Unknown') = ${filters.intent}`
    );
  }

  if (filters.agent !== "all") {
    clauses.push(
      sql`coalesce(metadata->>'agent', 'Unknown') = ${filters.agent}`
    );
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

function escapeCsvCell(value: string) {
  const escapedValue = value.replace(/"/g, '""');

  if (
    escapedValue.includes(",") ||
    escapedValue.includes("\n") ||
    escapedValue.includes('"')
  ) {
    return `"${escapedValue}"`;
  }

  return escapedValue;
}

function rowsToCsv(rows: ExportRow[]) {
  const columns = [
    "id",
    "chat_session_id",
    "rating",
    "feedback_updated_at",
    "intent",
    "agent",
    "route",
    "original_question",
    "answer",
    "sql_query",
    "row_count",
    "created_at",
  ];

  const header = columns.map(escapeCsvCell).join(",");

  const body = rows
    .map((row) => {
      const values: Record<string, string | number | null> = {
        id: row.id,
        chat_session_id: row.chat_session_id,
        rating: row.rating,
        feedback_updated_at: row.feedback_updated_at,
        intent: row.intent,
        agent: row.agent,
        route: row.route,
        original_question: row.original_question,
        answer: row.content,
        sql_query: row.sql_query,
        row_count: row.row_count,
        created_at: row.created_at,
      };

      return columns
        .map((column) => escapeCsvCell(String(values[column] ?? "")))
        .join(",");
    })
    .join("\n");

  return `${header}\n${body}`;
}

function buildFilename(filters: EvaluationFilters) {
  const filterPart = [filters.rating, filters.intent, filters.agent]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `pharmarev-evaluation-${filterPart}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
}

export async function GET(request: Request) {
  try {
    const filters = parseFilters(request);
    const whereSql = buildWhereSql(filters);

    const rows = await sql<ExportRow[]>`
      select
        id,
        chat_session_id,
        content,
        created_at::text,
        metadata->'feedback'->>'rating' as rating,
        metadata->'feedback'->>'updatedAt' as feedback_updated_at,
        metadata->>'intent' as intent,
        metadata->>'agent' as agent,
        metadata->>'route' as route,
        metadata->>'originalQuestion' as original_question,
        metadata->>'sqlQuery' as sql_query,
        jsonb_array_length(coalesce(metadata->'rows', '[]'::jsonb))::int as row_count
      from chat_messages
      where ${whereSql}
      order by
        coalesce(metadata->'feedback'->>'updatedAt', created_at::text) desc,
        created_at desc
    `;

    const csv = rowsToCsv(rows);
    const filename = buildFilename(filters);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown evaluation export error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
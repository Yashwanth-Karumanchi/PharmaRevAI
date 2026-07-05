import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

type RouteParams = {
  params: Promise<{ messageId: string }>;
};

type FeedbackRating = "helpful" | "not_helpful";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidRating(value: unknown): value is FeedbackRating {
  return value === "helpful" || value === "not_helpful";
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { messageId } = await params;
    const body = await request.json();

    const rating = body.rating;

    if (!isValidRating(rating)) {
      return NextResponse.json(
        {
          error: "rating must be helpful or not_helpful",
        },
        { status: 400 }
      );
    }

    const note = typeof body.note === "string" ? body.note.trim() : "";

    const messageRows = await sql`
      select id, role, metadata
      from chat_messages
      where id = ${messageId}
      limit 1
    `;

    if (messageRows.length === 0) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (messageRows[0].role !== "assistant") {
      return NextResponse.json(
        {
          error: "Feedback can only be saved for assistant messages",
        },
        { status: 400 }
      );
    }

    const currentMetadata = isRecord(messageRows[0].metadata)
      ? messageRows[0].metadata
      : {};

    const nextMetadata = {
      ...currentMetadata,
      feedback: {
        rating,
        note,
        updatedAt: new Date().toISOString(),
      },
    };

    const updatedRows = await sql`
      update chat_messages
      set metadata = ${sql.json(nextMetadata)}
      where id = ${messageId}
      returning id, role, content, metadata, created_at
    `;

    return NextResponse.json({
      ok: true,
      message: updatedRows[0],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown feedback route error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
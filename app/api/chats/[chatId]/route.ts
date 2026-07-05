import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { formatChat } from "@/lib/chat/formatters";

type RouteParams = {
  params: Promise<{
    chatId: string;
  }>;
};

export async function GET(_: Request, { params }: RouteParams) {
  try {
    const { chatId } = await params;

    const chatRows = await sql`
      select id, title, created_at, updated_at
      from chat_sessions
      where id = ${chatId}
        and deleted_at is null
      limit 1
    `;

    if (chatRows.length === 0) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const messageRows = await sql`
    select id, role, content, metadata, created_at
    from chat_messages
    where chat_session_id = ${chatId}
    order by created_at asc
    `;

    return NextResponse.json({
      chat: formatChat(chatRows[0], messageRows),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { chatId } = await params;
    const body = await request.json();
    const title = body.title;

    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    await sql`
      update chat_sessions
      set title = ${title}, updated_at = now()
      where id = ${chatId}
        and deleted_at is null
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: RouteParams) {
  try {
    const { chatId } = await params;

    await sql`
      update chat_sessions
      set deleted_at = now(), updated_at = now()
      where id = ${chatId}
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
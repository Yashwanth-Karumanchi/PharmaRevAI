import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { formatChat } from "@/lib/chat/formatters";

type RouteParams = {
  params: Promise<{ chatId: string }>;
};

type DbChatSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type DbChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { chatId } = await params;

    const chatRows = await sql<DbChatSession[]>`
      select
        id,
        title,
        created_at::text as created_at,
        updated_at::text as updated_at
      from chat_sessions
      where id = ${chatId}
        and deleted_at is null
      limit 1
    `;

    if (chatRows.length === 0) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const messageRows = await sql<DbChatMessage[]>`
      select
        id,
        role,
        content,
        metadata,
        created_at::text as created_at
      from chat_messages
      where chat_session_id = ${chatId}
      order by created_at asc
    `;

    return NextResponse.json({
      chat: formatChat(chatRows[0], messageRows),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown chat route error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { chatId } = await params;
    const body = await request.json();

    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!title) {
      return NextResponse.json(
        { error: "Chat title is required" },
        { status: 400 }
      );
    }

    const chatRows = await sql<DbChatSession[]>`
      update chat_sessions
      set title = ${title},
          updated_at = now()
      where id = ${chatId}
        and deleted_at is null
      returning
        id,
        title,
        created_at::text as created_at,
        updated_at::text as updated_at
    `;

    if (chatRows.length === 0) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const messageRows = await sql<DbChatMessage[]>`
      select
        id,
        role,
        content,
        metadata,
        created_at::text as created_at
      from chat_messages
      where chat_session_id = ${chatId}
      order by created_at asc
    `;

    return NextResponse.json({
      chat: formatChat(chatRows[0], messageRows),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown chat update error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { chatId } = await params;

    const rows = await sql<{ id: string }[]>`
      update chat_sessions
      set deleted_at = now(),
          updated_at = now()
      where id = ${chatId}
        and deleted_at is null
      returning id
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown chat delete error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
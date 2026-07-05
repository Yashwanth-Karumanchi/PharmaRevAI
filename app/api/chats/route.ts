import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { formatChatSummary } from "@/lib/chat/formatters";

type DbChatSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

function buildTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim() : "";

  if (!title) {
    return "New chat";
  }

  return title.length <= 60 ? title : `${title.slice(0, 60)}...`;
}

export async function GET() {
  try {
    const chats = await sql<DbChatSession[]>`
      select
        id,
        title,
        created_at::text as created_at,
        updated_at::text as updated_at
      from chat_sessions
      where deleted_at is null
      order by updated_at desc
      limit 100
    `;

    return NextResponse.json({
      chats: chats.map(formatChatSummary),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown chats route error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let body: { title?: unknown } = {};

    try {
      body = (await request.json()) as { title?: unknown };
    } catch {
      body = {};
    }

    const title = buildTitle(body.title);

    const chats = await sql<DbChatSession[]>`
      insert into chat_sessions (title)
      values (${title})
      returning
        id,
        title,
        created_at::text as created_at,
        updated_at::text as updated_at
    `;

    return NextResponse.json({
      chat: formatChatSummary(chats[0]),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown chat create error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const rows = await sql<{ id: string }[]>`
      update chat_sessions
      set deleted_at = now(),
          updated_at = now()
      where deleted_at is null
      returning id
    `;

    return NextResponse.json({
      ok: true,
      deletedCount: rows.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown chats delete error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
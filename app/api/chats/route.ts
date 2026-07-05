import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { formatChat, formatChatSummary } from "@/lib/chat/formatters";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const anonymousUserKey = searchParams.get("anonymousUserKey");

    if (!anonymousUserKey) {
      return NextResponse.json(
        { error: "anonymousUserKey is required" },
        { status: 400 }
      );
    }

    const users = await sql`
      select id
      from anonymous_users
      where anonymous_key = ${anonymousUserKey}
      limit 1
    `;

    if (users.length === 0) {
      return NextResponse.json({ chats: [] });
    }

    const chats = await sql`
      select id, title, created_at, updated_at
      from chat_sessions
      where anonymous_user_id = ${users[0].id}
        and deleted_at is null
      order by updated_at desc
    `;

    return NextResponse.json({
      chats: chats.map(formatChatSummary),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const anonymousUserKey = body.anonymousUserKey;

    if (!anonymousUserKey || typeof anonymousUserKey !== "string") {
      return NextResponse.json(
        { error: "anonymousUserKey is required" },
        { status: 400 }
      );
    }

    const users = await sql`
      insert into anonymous_users (anonymous_key)
      values (${anonymousUserKey})
      on conflict (anonymous_key)
      do update set last_seen_at = now()
      returning id
    `;

    const chatRows = await sql`
      insert into chat_sessions (anonymous_user_id, title)
      values (${users[0].id}, 'New chat')
      returning id, title, created_at, updated_at
    `;

    const messageRows = await sql`
      insert into chat_messages (chat_session_id, role, content)
      values (
        ${chatRows[0].id},
        'assistant',
        'New chat started. Ask a pharma intelligence question using real public data.'
      )
      returning id, role, content, created_at
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
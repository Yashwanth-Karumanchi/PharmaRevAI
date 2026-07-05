import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

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
      returning id, anonymous_key
    `;

    return NextResponse.json({
      user: users[0],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
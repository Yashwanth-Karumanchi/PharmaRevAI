import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { routeQuestion } from "@/lib/agents/queryRouter";
import { executeRegisteredTool } from "@/lib/agents/safeToolRegistry";
import { resolveConversationQuestion } from "@/lib/agents/conversationContextResolver";
import { formatMessage } from "@/lib/chat/formatters";
import { maybeAnswerConversationally } from "@/lib/agents/conversationalAssistant";

function toDatabaseJson(value: unknown): Parameters<typeof sql.json>[0] {
  return JSON.parse(JSON.stringify(value ?? {})) as Parameters<
    typeof sql.json
  >[0];
}

type RouteParams = {
  params: Promise<{ chatId: string }>;
};

type RouterResult = Awaited<ReturnType<typeof routeQuestion>>;
type ToolResult = Awaited<ReturnType<typeof executeRegisteredTool>>;

type RecentMessageRow = {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function buildChatTitle(firstUserMessage: string) {
  if (firstUserMessage.length <= 38) {
    return firstUserMessage;
  }

  return `${firstUserMessage.slice(0, 38)}...`;
}

function buildSharedMetadata({
  originalQuestion,
  resolvedQuestion,
  followUpResolution,
  router,
  result,
}: {
  originalQuestion: string;
  resolvedQuestion: string;
  followUpResolution: Awaited<ReturnType<typeof resolveConversationQuestion>>;
  router: RouterResult;
  result: ToolResult;
}) {
  return {
    route: router.route,
    intent: router.intent,
    router,
    agent: router.toolName,
    toolName: router.toolName,
    registry: result.registry,
    originalQuestion,
    resolvedQuestion,
    followUpResolution: {
      wasFollowUp: followUpResolution.wasFollowUp,
      method: followUpResolution.method,
      reason: followUpResolution.reason,
      contextSource: followUpResolution.contextSource,
    },
    sqlQuery: result.sqlQuery,
    rows: result.rows,
    sources: result.sources,
    entities: result.entities,
    extractedEntities: router.extractedEntities,
    composer: result.composer,
    verification: result.verification,
    limitation:
      "The assistant answers only from loaded public datasets and must not invent private pharma revenue, profit, rebate-adjusted net revenue, sales-rep performance, CRM deals, discounts, or contract loss.",
  };
}

async function loadRecentMessages(chatId: string) {
  const rows = await sql<RecentMessageRow[]>`
    select id, role, content, metadata, created_at::text
    from chat_messages
    where chat_session_id = ${chatId}
    order by created_at desc
    limit 12
  `;

  return rows.reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }));
}


async function buildAssistantResponse({
  originalQuestion,
  recentMessages,
}: {
  originalQuestion: string;
  recentMessages: Awaited<ReturnType<typeof loadRecentMessages>>;
}) {
  const followUpResolution = await resolveConversationQuestion({
    question: originalQuestion,
    messages: recentMessages,
  });

  const resolvedQuestion = followUpResolution.resolvedQuestion;
  const router = await routeQuestion(resolvedQuestion);

  const result = await executeRegisteredTool({
    toolName: router.toolName,
    question: resolvedQuestion,
    extractedEntities: {
      ...router.extractedEntities,
      originalQuestion,
      resolvedQuestion,
      followUpResolution,
    },
  });

  return {
    content: result.answer,
    metadata: buildSharedMetadata({
      originalQuestion,
      resolvedQuestion,
      followUpResolution,
      router,
      result,
    }),
  };
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { chatId } = await params;
    const body = await request.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";

    if (!content) {
      return NextResponse.json(
        { error: "Message content is required" },
        { status: 400 }
      );
    }

    const chatRows = await sql`
      select id, title
      from chat_sessions
      where id = ${chatId}
        and deleted_at is null
      limit 1
    `;

    if (chatRows.length === 0) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const recentMessages = await loadRecentMessages(chatId);

    const userRows = await sql`
      insert into chat_messages (chat_session_id, role, content, metadata)
      values (${chatId}, 'user', ${content}, ${sql.json({})})
      returning id, role, content, metadata, created_at
    `;

    if (chatRows[0].title === "New chat") {
      await sql`
        update chat_sessions
        set title = ${buildChatTitle(content)},
            updated_at = now()
        where id = ${chatId}
      `;
    }

    const conversationalResponse = await maybeAnswerConversationally({
      question: content,
    });

    if (conversationalResponse) {
      const assistantRows = await sql`
        insert into chat_messages (chat_session_id, role, content, metadata)
        values (
          ${chatId},
          'assistant',
          ${conversationalResponse.answer},
          ${sql.json(toDatabaseJson(conversationalResponse.metadata))}
        )
        returning id, role, content, metadata, created_at
      `;

      await sql`
        update chat_sessions
        set updated_at = now()
        where id = ${chatId}
      `;

      return NextResponse.json({
        userMessage: formatMessage(userRows[0]),
        assistantMessage: formatMessage(assistantRows[0]),
      });
    }
    const assistantResponse = await buildAssistantResponse({
      originalQuestion: content,
      recentMessages,
    });

    const assistantRows = await sql`
      insert into chat_messages (chat_session_id, role, content, metadata)
      values (
        ${chatId},
        'assistant',
        ${assistantResponse.content},
        ${sql.json(toDatabaseJson(assistantResponse.metadata))}
      )
      returning id, role, content, metadata, created_at
    `;

    await sql`
      update chat_sessions
      set updated_at = now()
      where id = ${chatId}
    `;

    return NextResponse.json({
      userMessage: formatMessage(userRows[0]),
      assistantMessage: formatMessage(assistantRows[0]),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown message route error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

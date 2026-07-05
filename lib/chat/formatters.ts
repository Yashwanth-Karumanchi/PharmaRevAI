import type { Chat, ChatSummary, Message } from "@/types/chat";

type DbChatSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type DbChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: unknown;
  created_at: string;
};

export function formatChatSummary(row: DbChatSession): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function formatMessage(row: DbChatMessage): Message {
  return {
    id: row.id,
    role: row.role === "system" ? "assistant" : row.role,
    content: row.content,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.created_at,
  };
}

export function formatChat(
  chatRow: DbChatSession,
  messageRows: DbChatMessage[]
): Chat {
  return {
    id: chatRow.id,
    title: chatRow.title,
    createdAt: chatRow.created_at,
    updatedAt: chatRow.updated_at,
    messages: messageRows.map(formatMessage),
  };
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      const parsedValue = JSON.parse(value);

      if (isRecord(parsedValue)) {
        return parsedValue;
      }

      return {};
    } catch {
      return {};
    }
  }

  if (isRecord(value)) {
    return value;
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
import type { Chat, Message } from "@/types/chat";

const STORAGE_KEY = "pharmarev-ai-chats";

export function createAssistantMessage(content: string): Message {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  };
}

export function createUserMessage(content: string): Message {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
}

export function createEmptyChat(): Chat {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [
      createAssistantMessage(
        "New chat started. Ask a pharma intelligence question using real public data."
      ),
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function createStarterChats(): Chat[] {
  const now = new Date().toISOString();

  return [
    {
      id: "starter-chat-1",
      title: "Medicare spending trends",
      createdAt: now,
      updatedAt: now,
      messages: [
        createAssistantMessage(
          "Hi, I’m PharmaRev AI. Ask me about public pharma sales, CMS spending, prescriber data, Open Payments, or FDA product context."
        ),
      ],
    },
    {
      id: "starter-chat-2",
      title: "FDA label explanation",
      createdAt: now,
      updatedAt: now,
      messages: [
        createAssistantMessage(
          "Ask me what a public FDA label says about a drug. Later, I will retrieve grounded chunks from the RAG knowledge base."
        ),
      ],
    },
  ];
}

export function loadChatsFromStorage(): Chat[] {
  if (typeof window === "undefined") {
    return [];
  }

  const storedValue = window.localStorage.getItem(STORAGE_KEY);

  if (!storedValue) {
    return [];
  }

  try {
    const parsedChats = JSON.parse(storedValue) as Chat[];

    if (!Array.isArray(parsedChats)) {
      return [];
    }

    return parsedChats;
  } catch {
    return [];
  }
}

export function saveChatsToStorage(chats: Chat[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

export function buildChatTitle(firstUserMessage: string) {
  const cleanedMessage = firstUserMessage.trim().replace(/\s+/g, " ");

  if (cleanedMessage.length <= 38) {
    return cleanedMessage;
  }

  return `${cleanedMessage.slice(0, 38)}...`;
}
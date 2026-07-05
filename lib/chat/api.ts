import type { Chat, ChatSummary, Message } from "@/types/chat";

type CreateChatResponse = {
  chat: Chat;
};

type ChatListResponse = {
  chats: ChatSummary[];
};

type ChatResponse = {
  chat: Chat;
};

type CreateMessageResponse = {
  userMessage: Message;
  assistantMessage: Message;
};

export async function fetchChats(anonymousUserKey: string) {
  const response = await fetch(`/api/chats?anonymousUserKey=${anonymousUserKey}`);

  if (!response.ok) {
    throw new Error("Failed to fetch chats");
  }

  const data = (await response.json()) as ChatListResponse;

  return data.chats;
}

export async function fetchChat(chatId: string) {
  const response = await fetch(`/api/chats/${chatId}`);

  if (!response.ok) {
    throw new Error("Failed to fetch chat");
  }

  const data = (await response.json()) as ChatResponse;

  return data.chat;
}

export async function createChat(anonymousUserKey: string) {
  const response = await fetch("/api/chats", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ anonymousUserKey }),
  });

  if (!response.ok) {
    throw new Error("Failed to create chat");
  }

  const data = (await response.json()) as CreateChatResponse;

  return data.chat;
}

export async function renameChat(chatId: string, title: string) {
  const response = await fetch(`/api/chats/${chatId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw new Error("Failed to rename chat");
  }
}

export async function deleteChat(chatId: string) {
  const response = await fetch(`/api/chats/${chatId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to delete chat");
  }
}

export async function createMessage(chatId: string, content: string) {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    let errorMessage = "Failed to create message";

    try {
      const errorData = await response.json();

      if (typeof errorData.error === "string") {
        errorMessage = errorData.error;
      }
    } catch {
      errorMessage = "Failed to create message";
    }

    throw new Error(errorMessage);
  }

  const data = (await response.json()) as CreateMessageResponse;

  return data;
}
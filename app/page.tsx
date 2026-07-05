"use client";

import { useEffect, useMemo, useState } from "react";
import { AnswerDrawer } from "@/components/drawers/AnswerDrawer";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { RagGraphDrawer } from "@/components/rag/RagGraphDrawer";
import type { AnswerDrawerType } from "@/types/evidence";
import type { Chat, ChatSummary, Message } from "@/types/chat";
import { getOrCreateAnonymousUserKey } from "@/lib/chat/anonymousUser";
import {
  createChat,
  createMessage,
  deleteChat,
  fetchChat,
  fetchChats,
  renameChat,
} from "@/lib/chat/api";

export default function Home() {
  const [anonymousUserKey, setAnonymousUserKey] = useState("");
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [activeChatId, setActiveChatId] = useState("");
  const [input, setInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [activeAnswerDrawer, setActiveAnswerDrawer] =
    useState<AnswerDrawerType>(null);
  const [selectedDrawerMessage, setSelectedDrawerMessage] =
    useState<Message | null>(null);
  const [focusedCitationLabel, setFocusedCitationLabel] = useState<string | null>(
    null
  );

  const [showRagGraph, setShowRagGraph] = useState(false);
  const [selectedRagGraphMessage, setSelectedRagGraphMessage] =
    useState<Message | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const sidebarChats = useMemo(() => {
    return chatSummaries.map((chat) => ({
      ...chat,
      messages: [],
    }));
  }, [chatSummaries]);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const key = getOrCreateAnonymousUserKey();
        setAnonymousUserKey(key);

        let chats = await fetchChats(key);

        if (chats.length === 0) {
          const newChat = await createChat(key);

          chats = [
            {
              id: newChat.id,
              title: newChat.title,
              createdAt: newChat.createdAt,
              updatedAt: newChat.updatedAt,
            },
          ];

          setActiveChat(newChat);
          setActiveChatId(newChat.id);
        } else {
          const firstChat = await fetchChat(chats[0].id);

          setActiveChat(firstChat);
          setActiveChatId(firstChat.id);
        }

        setChatSummaries(chats);
      } catch (error) {
        console.error(error);
        alert("Failed to load PharmaRev chats. Check the terminal error.");
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialData();
  }, []);

  async function refreshChatList(selectedChatId?: string) {
    if (!anonymousUserKey) return;

    const chats = await fetchChats(anonymousUserKey);
    setChatSummaries(chats);

    if (selectedChatId) {
      const selectedChat = await fetchChat(selectedChatId);
      setActiveChat(selectedChat);
      setActiveChatId(selectedChat.id);
    }
  }

  function openAnswerDrawer(
    type: Exclude<AnswerDrawerType, null>,
    message: Message,
    citationLabel?: string
  ) {
    setSelectedDrawerMessage(message);
    setFocusedCitationLabel(citationLabel ?? null);
    setActiveAnswerDrawer(type);
  }

  function closeAnswerDrawer() {
    setSelectedDrawerMessage(null);
    setFocusedCitationLabel(null);
    setActiveAnswerDrawer(null);
  }

  function openRagGraph(message: Message) {
    setSelectedRagGraphMessage(message);
    setShowRagGraph(true);
  }

  function closeRagGraph() {
    setSelectedRagGraphMessage(null);
    setShowRagGraph(false);
  }

  async function handleCreateNewChat() {
    try {
      const newChat = await createChat(anonymousUserKey);

      setChatSummaries((currentChats) => [
        {
          id: newChat.id,
          title: newChat.title,
          createdAt: newChat.createdAt,
          updatedAt: newChat.updatedAt,
        },
        ...currentChats,
      ]);

      setActiveChat(newChat);
      setActiveChatId(newChat.id);
      setInput("");
      setSearchTerm("");
      closeAnswerDrawer();
      closeRagGraph();
    } catch (error) {
      console.error(error);
      alert("Failed to create chat.");
    }
  }

  async function handleSelectChat(chatId: string) {
    try {
      const selectedChat = await fetchChat(chatId);

      setActiveChat(selectedChat);
      setActiveChatId(chatId);
      setInput("");
      closeAnswerDrawer();
      closeRagGraph();
    } catch (error) {
      console.error(error);
      alert("Failed to load chat.");
    }
  }

  async function handleDeleteChat(chatId: string) {
    try {
      await deleteChat(chatId);

      const remainingChats = chatSummaries.filter((chat) => chat.id !== chatId);

      if (remainingChats.length === 0) {
        const newChat = await createChat(anonymousUserKey);

        setChatSummaries([
          {
            id: newChat.id,
            title: newChat.title,
            createdAt: newChat.createdAt,
            updatedAt: newChat.updatedAt,
          },
        ]);

        setActiveChat(newChat);
        setActiveChatId(newChat.id);
        closeAnswerDrawer();
        closeRagGraph();

        return;
      }

      setChatSummaries(remainingChats);

      if (activeChatId === chatId) {
        const nextChat = await fetchChat(remainingChats[0].id);

        setActiveChat(nextChat);
        setActiveChatId(nextChat.id);
        closeAnswerDrawer();
        closeRagGraph();
      }
    } catch (error) {
      console.error(error);
      alert("Failed to delete chat.");
    }
  }

  async function handleRenameChat(chatId: string, title: string) {
    try {
      await renameChat(chatId, title);

      setChatSummaries((currentChats) =>
        currentChats.map((chat) => {
          if (chat.id !== chatId) return chat;

          return {
            ...chat,
            title,
            updatedAt: new Date().toISOString(),
          };
        })
      );

      if (activeChat?.id === chatId) {
        setActiveChat({
          ...activeChat,
          title,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error(error);
      alert("Failed to rename chat.");
    }
  }

  async function handleClearAllChats() {
    const shouldClear = window.confirm(
      "This will delete all chats for this browser. Continue?"
    );

    if (!shouldClear) return;

    try {
      for (const chat of chatSummaries) {
        await deleteChat(chat.id);
      }

      const newChat = await createChat(anonymousUserKey);

      setChatSummaries([
        {
          id: newChat.id,
          title: newChat.title,
          createdAt: newChat.createdAt,
          updatedAt: newChat.updatedAt,
        },
      ]);

      setActiveChat(newChat);
      setActiveChatId(newChat.id);
      setInput("");
      setSearchTerm("");
      closeAnswerDrawer();
      closeRagGraph();
    } catch (error) {
      console.error(error);
      alert("Failed to clear chats.");
    }
  }

  function sendMessage() {
    sendMessageFromText(input);
  }

  async function sendMessageFromText(rawText: string) {
    const trimmedInput = rawText.trim();
    const currentChat = activeChat;

    if (!trimmedInput || !currentChat || isSending) return;

    const sentAt = new Date().toISOString();
    const localUserMessage = buildLocalUserMessage(trimmedInput, sentAt);
    const loadingMessage = buildLoadingAssistantMessage(trimmedInput);
    const shouldUpdateTitle = currentChat.title === "New chat" || currentChat.messages.length <= 1;
    const optimisticTitle = shouldUpdateTitle
      ? buildChatTitle(trimmedInput)
      : currentChat.title;

    setIsSending(true);
    setInput("");
    closeAnswerDrawer();
    closeRagGraph();

    setActiveChat((chat) => {
      if (!chat || chat.id !== currentChat.id) return chat;

      return {
        ...chat,
        title: optimisticTitle,
        messages: [...chat.messages, localUserMessage, loadingMessage],
        updatedAt: sentAt,
      };
    });

    setChatSummaries((currentChats) =>
      currentChats.map((chat) => {
        if (chat.id !== currentChat.id) return chat;

        return {
          ...chat,
          title: optimisticTitle,
          updatedAt: sentAt,
        };
      })
    );

    try {
      const { userMessage, assistantMessage } = await createMessage(
        currentChat.id,
        trimmedInput
      );

      setActiveChat((chat) => {
        if (!chat || chat.id !== currentChat.id) return chat;

        const withoutTemporaryMessages = chat.messages.filter(
          (message) =>
            message.id !== localUserMessage.id && message.id !== loadingMessage.id
        );

        return {
          ...chat,
          title: optimisticTitle,
          messages: [...withoutTemporaryMessages, userMessage, assistantMessage],
          updatedAt: new Date().toISOString(),
        };
      });

      await refreshChatList(currentChat.id);
    } catch (error) {
      console.error(error);

      const message =
        error instanceof Error ? error.message : "Failed to send message.";

      const failedAssistantMessage = buildFailedAssistantMessage(message);

      setActiveChat((chat) => {
        if (!chat || chat.id !== currentChat.id) return chat;

        return {
          ...chat,
          messages: chat.messages.map((existingMessage) => {
            if (existingMessage.id === loadingMessage.id) {
              return failedAssistantMessage;
            }

            return existingMessage;
          }),
          updatedAt: new Date().toISOString(),
        };
      });
    } finally {
      setIsSending(false);
    }
  }

  if (isLoading) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#0b0f19] text-slate-100">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-slate-300 shadow-2xl">
          Preparing PharmaRev AI...
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen bg-[#0b0f19] text-slate-100">
      <ChatSidebar
        chats={sidebarChats}
        activeChatId={activeChatId}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onNewChat={handleCreateNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
        onClearAllChats={handleClearAllChats}
      />

      <ChatWindow
        messages={activeChat?.messages ?? []}
        input={input}
        isSending={isSending}
        onInputChange={setInput}
        onSend={sendMessage}
        onUsePrompt={sendMessageFromText}
        onOpenAnswerDrawer={openAnswerDrawer}
        onOpenRagGraph={openRagGraph}
      />

      <AnswerDrawer
        type={activeAnswerDrawer}
        message={selectedDrawerMessage}
        focusedCitationLabel={focusedCitationLabel}
        onClose={closeAnswerDrawer}
      />

      <RagGraphDrawer
        isOpen={showRagGraph}
        message={selectedRagGraphMessage}
        onClose={closeRagGraph}
      />
    </main>
  );
}

function buildChatTitle(firstUserMessage: string) {
  if (firstUserMessage.length <= 38) {
    return firstUserMessage;
  }

  return `${firstUserMessage.slice(0, 38)}...`;
}

function buildLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildLocalUserMessage(content: string, createdAt: string): Message {
  return {
    id: buildLocalId("local-user"),
    role: "user",
    content,
    createdAt,
    metadata: {
      optimistic: true,
    },
  };
}

function buildLoadingAssistantMessage(question: string): Message {
  return {
    id: buildLocalId("local-assistant-loading"),
    role: "assistant",
    content:
      "PharmaRev is reviewing the question, selecting the right evidence, and preparing a cited answer...",
    createdAt: new Date().toISOString(),
    metadata: {
      pending: true,
      conversational: true,
      route: "PENDING",
      intent: "answer_in_progress",
      agent: "pharmarev_assistant",
      toolName: "pending",
      originalQuestion: question,
      sources: [],
      rows: [],
      sqlQuery: "",
    },
  };
}

function buildFailedAssistantMessage(errorMessage: string): Message {
  return {
    id: buildLocalId("local-assistant-error"),
    role: "assistant",
    content: [
      "I could not create this answer because the request failed before completion.",
      "",
      `Error: ${errorMessage}`,
      "",
      "Try again after checking the terminal for the underlying build or API error.",
    ].join("\n"),
    createdAt: new Date().toISOString(),
    metadata: {
      conversational: true,
      route: "ERROR",
      intent: "message_creation_failed",
      agent: "pharmarev_assistant",
      toolName: "error_handler",
      sources: [],
      rows: [],
      sqlQuery: "",
    },
  };
}

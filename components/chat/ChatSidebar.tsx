"use client";

import { useState } from "react";
import {
  Bot,
  Check,
  MessageSquarePlus,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { Chat } from "@/types/chat";

type ChatSidebarProps = {
  chats: Chat[];
  activeChatId: string;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onClearAllChats: () => void;
};

export function ChatSidebar({
  chats,
  activeChatId,
  searchTerm,
  onSearchChange,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onClearAllChats,
}: ChatSidebarProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const visibleChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function startRenaming(chat: Chat) {
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  }

  function cancelRenaming() {
    setEditingChatId(null);
    setEditingTitle("");
  }

  function submitRename(chatId: string) {
    const trimmedTitle = editingTitle.trim();

    if (trimmedTitle) {
      onRenameChat(chatId, trimmedTitle);
    }

    cancelRenaming();
  }

  return (
    <aside className="flex w-72 flex-col border-r border-white/10 bg-[#080b12]">
      <div className="border-b border-white/10 p-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
            <Bot size={20} />
          </div>

          <div>
            <h1 className="text-sm font-semibold text-white">PharmaRev AI</h1>
            <p className="text-xs text-slate-400">
              Public pharma intelligence
            </p>
          </div>
        </div>

        <button
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400"
        >
          <MessageSquarePlus size={16} />
          New chat
        </button>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-400">
          <Search size={15} />

          <input
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search chats"
            className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {visibleChats.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center text-xs leading-5 text-slate-500">
            No matching chats.
          </div>
        )}

        {visibleChats.map((chat) => {
          const isActive = activeChatId === chat.id;
          const isEditing = editingChatId === chat.id;

          return (
            <div
              key={chat.id}
              className={`group flex w-full items-center gap-1 rounded-xl px-2 py-2 text-sm transition ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              {isEditing ? (
                <input
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submitRename(chat.id);
                    }

                    if (event.key === "Escape") {
                      cancelRenaming();
                    }
                  }}
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-sm text-white outline-none"
                />
              ) : (
                <button
                  onClick={() => onSelectChat(chat.id)}
                  className="min-w-0 flex-1 truncate text-left"
                  title={chat.title}
                >
                  {chat.title}
                </button>
              )}

              {isEditing ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => submitRename(chat.id)}
                    aria-label="Save chat title"
                    className="rounded-md p-1 text-slate-400 transition hover:bg-emerald-500/20 hover:text-emerald-300"
                  >
                    <Check size={14} />
                  </button>

                  <button
                    onClick={cancelRenaming}
                    aria-label="Cancel rename"
                    className="rounded-md p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => startRenaming(chat)}
                    aria-label="Rename chat"
                    className="rounded-md p-1 transition hover:bg-white/10 hover:text-white"
                  >
                    <Pencil size={14} />
                  </button>

                  <button
                    onClick={() => onDeleteChat(chat.id)}
                    aria-label="Delete chat"
                    className="rounded-md p-1 transition hover:bg-red-500/20 hover:text-red-300"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-3 border-t border-white/10 p-4">
        <button
          onClick={onClearAllChats}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200 transition hover:bg-red-400/20"
        >
          <Trash2 size={15} />
          Clear chat history
        </button>

        <p className="text-xs leading-5 text-slate-500">
          Cited public evidence, query details, and answer flow in one workspace.
        </p>
      </div>
    </aside>
  );
}
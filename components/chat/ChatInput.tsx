"use client";

import { Send } from "lucide-react";

type ChatInputProps = {
  input: string;
  isSending: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
};

export function ChatInput({
  input,
  isSending,
  onInputChange,
  onSend,
}: ChatInputProps) {
  return (
    <div className="border-t border-white/10 p-4">
      <div className="mx-auto flex max-w-3xl items-end gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
        <textarea
          value={input}
          disabled={isSending}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={
            isSending
              ? "PharmaRev AI is checking evidence..."
              : "Ask: Which drugs had the biggest Medicare Part D spending increase?"
          }
          className="min-h-12 flex-1 resize-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
        />

        <button
          onClick={onSend}
          disabled={!input.trim() || isSending}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={17} />
        </button>
      </div>
    </div>
  );
}
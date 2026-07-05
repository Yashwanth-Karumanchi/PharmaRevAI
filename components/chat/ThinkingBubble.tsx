"use client";

import { Bot, Database, GitBranch, ShieldCheck } from "lucide-react";

export function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-slate-100">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
            <Bot size={15} />
          </div>

          <div>
            <p className="font-medium text-white">PharmaRev AI is working</p>
            <p className="text-xs text-slate-500">
              Checking data, tools, and limitations
            </p>
          </div>

          <div className="ml-2 flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-300 [animation-delay:-0.2s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-300 [animation-delay:-0.1s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-300" />
          </div>
        </div>

        <div className="space-y-2 border-t border-white/10 pt-3">
          <LoadingStep
            icon={<GitBranch size={14} />}
            text="Routing the question"
          />
          <LoadingStep
            icon={<Database size={14} />}
            text="Checking Neon data"
          />
          <LoadingStep
            icon={<ShieldCheck size={14} />}
            text="Preparing grounded answer"
          />
        </div>
      </div>
    </div>
  );
}

function LoadingStep({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <span className="text-emerald-300">{icon}</span>
      <span>{text}</span>
    </div>
  );
}
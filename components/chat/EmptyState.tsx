
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Database,
  FileText,
  LineChart,
  MapPinned,
  Sparkles,
} from "lucide-react";

type EmptyStateProps = {
  onPromptClick: (prompt: string) => void;
};

type PromptCategory = "ranking" | "overview" | "trend" | "prescriber" | "label";

type CapabilityPrompt = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  category: PromptCategory;
};

type CapabilitiesResponse = {
  ok: boolean;
  availableYears?: number[];
  availableYearsLabel?: string;
  sampleDrug?: string | null;
  prompts?: CapabilityPrompt[];
};

const stablePromptFallback: CapabilityPrompt[] = [
  {
    id: "highest-spending",
    title: "Highest spending drugs",
    description: "Rank medicines by Medicare Part D spending.",
    prompt: "Which drugs had the highest Medicare Part D spending in 2024?",
    category: "ranking",
  },
  {
    id: "spending-overview",
    title: "Spending overview",
    description: "Summarize the available Medicare Part D spending picture.",
    prompt: "Show the overall Medicare Part D spending overview for 2024.",
    category: "overview",
  },
  {
    id: "prescriber-locations",
    title: "Prescriber cost locations",
    description: "Find where public prescriber costs are concentrated.",
    prompt: "For Humira, where were prescriber costs highest?",
    category: "prescriber",
  },
  {
    id: "label-context",
    title: "FDA label context",
    description: "Answer from cited FDA label evidence.",
    prompt: "What is Eliquis used for according to the FDA label?",
    category: "label",
  },
];

export function EmptyState({ onPromptClick }: EmptyStateProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [availableYearsLabel, setAvailableYearsLabel] =
    useState("Checking available years...");
  const [sampleDrug, setSampleDrug] = useState<string | null>(null);
  const [remotePrompts, setRemotePrompts] = useState<CapabilityPrompt[] | null>(
    null
  );

  useEffect(() => {
    let isMounted = true;

    async function loadCapabilities() {
      try {
        const response = await fetch("/api/capabilities", {
          cache: "no-store",
        });

        const data = (await response.json()) as CapabilitiesResponse;

        if (!isMounted) return;

        if (data.ok) {
          setAvailableYearsLabel(data.availableYearsLabel ?? "Available data");
          setSampleDrug(data.sampleDrug ?? null);

          if (Array.isArray(data.prompts) && data.prompts.length >= 4) {
            setRemotePrompts(data.prompts.slice(0, 4));
          }
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadCapabilities();

    return () => {
      isMounted = false;
    };
  }, []);

  const prompts = useMemo(() => {
    const source = remotePrompts && remotePrompts.length >= 4 ? remotePrompts : stablePromptFallback;
    return source.slice(0, 4);
  }, [remotePrompts]);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/10">
      <div className="mx-auto mb-6 flex max-w-2xl flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
          <Sparkles size={22} />
        </div>

        <h1 className="text-xl font-semibold text-white">
          PharmaRev AI Intelligence Chat
        </h1>

        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
          Ask questions across Medicare Part D spending, prescriber costs, Open
          Payments, public sales trends, and FDA label evidence. PharmaRev routes
          each question to the right public evidence and shows citations when data
          supports the answer.
        </p>

        <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
          <CapabilityPill
            icon={<Database size={13} />}
            label={`Years: ${availableYearsLabel}`}
          />
          <CapabilityPill
            icon={<LineChart size={13} />}
            label={sampleDrug ? `Example drug: ${sampleDrug}` : "Drug examples available"}
          />
          <CapabilityPill
            icon={<Sparkles size={13} />}
            label={isLoading ? "Checking capabilities..." : "Ready for questions"}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {prompts.map((prompt) => (
          <button
            key={prompt.id}
            onClick={() => onPromptClick(prompt.prompt)}
            className="group rounded-2xl border border-white/10 bg-black/20 p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-300/50 hover:bg-emerald-400/10"
          >
            <div className="mb-3 flex items-center gap-3">
              <div
                className={`rounded-xl p-2 ${getPromptIconClassName(
                  prompt.category
                )}`}
              >
                {getPromptIcon(prompt.category)}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-white">
                  {prompt.title}
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {prompt.description}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-xs leading-5 text-slate-300 group-hover:text-emerald-100">
              {prompt.prompt}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-xs leading-5 text-amber-100/90">
        Data note: PharmaRev answers from available public evidence. It cannot
        infer private revenue, discounts, rebates, CRM activity, sales-rep
        performance, contract loss, or margins unless those sources are added.
      </div>
    </div>
  );
}

function CapabilityPill({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300">
      <span className="text-emerald-300">{icon}</span>
      {label}
    </span>
  );
}

function getPromptIcon(category: PromptCategory) {
  if (category === "ranking") return <BarChart3 size={16} />;
  if (category === "overview") return <LineChart size={16} />;
  if (category === "trend") return <LineChart size={16} />;
  if (category === "prescriber") return <MapPinned size={16} />;
  return <FileText size={16} />;
}

function getPromptIconClassName(category: PromptCategory) {
  if (category === "ranking") return "bg-blue-400/15 text-blue-300";
  if (category === "overview") return "bg-emerald-400/15 text-emerald-300";
  if (category === "trend") return "bg-purple-400/15 text-purple-300";
  if (category === "prescriber") return "bg-cyan-400/15 text-cyan-300";
  return "bg-amber-400/15 text-amber-300";
}

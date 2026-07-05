export type AnswerDrawerType = "sources" | "sql" | "agentSteps" | null;

export type SourceEvidence = {
  id: string;
  title: string;
  dataset: string;
  score: number;
  status: "used" | "rejected";
  excerpt: string;
  metadata: string[];
  citationLabel?: string;
  citationType?: "sql" | "kb" | "limit";
};

export type SqlEvidence = {
  query: string;
  resultRows: Record<string, string | number>[];
  notes: string[];
};

export type AgentStep = {
  id: string;
  name: string;
  status: "complete" | "warning" | "failed";
  summary: string;
  details: string[];
};
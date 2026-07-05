export type RagNodeStatus = "complete" | "used" | "warning" | "failed" | "skipped";

export type RagNodeType =
  | "question"
  | "context"
  | "router"
  | "intent"
  | "tool"
  | "database"
  | "retriever"
  | "sources"
  | "composer"
  | "limitation"
  | "verifier"
  | "answer"
  | "result";

export type RagTraceNode = {
  id: string;
  label: string;
  description: string;
  type: RagNodeType;
  status: RagNodeStatus;
  details: string[];
  score?: number;
};

export type RagTraceEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type RagTrace = {
  question: string;
  resolvedQuestion: string;
  route: string;
  confidence: string;
  toolName: string;
  answerMode: string;
  nodes: RagTraceNode[];
  edges: RagTraceEdge[];
};

"use client";

import { memo, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  GitBranch,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { RagNodeStatus, RagTrace, RagTraceNode } from "@/types/rag";

type RagFlowNode = Node<RagTraceNode, "ragNode">;

const nodePositions: Record<string, { x: number; y: number }> = {
  question: { x: 430, y: 20 },
  context: { x: 430, y: 190 },
  router: { x: 430, y: 360 },
  tool: { x: 430, y: 530 },

  database: { x: 110, y: 710 },
  "sql-result": { x: 110, y: 890 },

  retriever: { x: 750, y: 710 },
  sources: { x: 750, y: 890 },

  composer: { x: 430, y: 1080 },
  limitation: { x: 750, y: 1080 },
  verifier: { x: 430, y: 1260 },
  answer: { x: 430, y: 1440 },
};

const RagNode = memo(function RagNodeInner({
  data,
  selected,
}: NodeProps<RagFlowNode>) {
  const icon = getNodeIcon(data.type);
  const statusClass = getStatusClass(data.status);

  return (
    <div
      className={`w-72 rounded-2xl border bg-[#0f172a] p-4 shadow-xl transition ${
        selected
          ? "border-emerald-300 shadow-emerald-500/20"
          : "border-white/10"
      }`}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />

      <div className="mb-3 flex items-start gap-3">
        <div className={`rounded-xl p-2 ${statusClass.icon}`}>{icon}</div>

        <div className="min-w-0 flex-1">
          <h4 className="break-words text-sm font-semibold text-white">
            {data.label}
          </h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
            {data.description}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass.badge}`}
        >
          {formatStatus(data.status)}
        </span>

        {typeof data.score === "number" && Number.isFinite(data.score) && (
          <span className="text-xs text-slate-500">
            {(data.score * 100).toFixed(0)}%
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
});

RagNode.displayName = "RagNode";

const nodeTypes = {
  ragNode: RagNode,
};

export function RagGraph({ trace }: { trace: RagTrace }) {
  const [selectedNodeId, setSelectedNodeId] = useState(
    trace.nodes[0]?.id ?? ""
  );

  const selectedNode =
    trace.nodes.find((node) => node.id === selectedNodeId) ?? trace.nodes[0];

  const nodes = useMemo<RagFlowNode[]>(() => {
    return trace.nodes.map((node, index) => ({
      id: node.id,
      type: "ragNode",
      position: nodePositions[node.id] ?? {
        x: 430,
        y: 120 + index * 170,
      },
      data: node,
    }));
  }, [trace.nodes]);

  const edges = useMemo<Edge[]>(() => {
    return trace.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: true,
      type: "smoothstep",
      label: edge.label ?? "",
      style: {
        strokeWidth: 2,
        stroke: "rgba(148, 163, 184, 0.72)",
      },
    }));
  }, [trace.edges]);

  return (
    <div className="grid h-full grid-cols-[1fr_360px] gap-4">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#020617]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          fitView
          fitViewOptions={{
            padding: 0.24,
            maxZoom: 0.82,
          }}
          minZoom={0.22}
          maxZoom={1.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <aside className="overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Answer flow
          </p>
          <h3 className="mt-2 text-sm font-semibold text-white">
            {selectedNode?.label ?? "Select a node"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {selectedNode?.description ??
              "Click a node to inspect how the answer was routed and supported."}
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <InfoPill label="Route" value={trace.route} />
          <InfoPill label="Confidence" value={trace.confidence} />
          <InfoPill label="Agent" value={trace.toolName} />
          <InfoPill label="Answer mode" value={trace.answerMode} />
        </div>

        {trace.resolvedQuestion !== trace.question && (
          <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-emerald-200/70">
              Resolved question
            </p>
            <p className="mt-2 text-sm leading-6 text-emerald-50">
              {trace.resolvedQuestion}
            </p>
          </div>
        )}

        {selectedNode && (
          <div className="space-y-3">
            <StatusPanel
              status={selectedNode.status}
              score={selectedNode.score}
            />

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Details
              </h4>

              <div className="space-y-2">
                {selectedNode.details.map((detail) => (
                  <div
                    key={detail}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-slate-300"
                  >
                    {detail}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-xs font-medium text-slate-200">
        {value || "Not stored"}
      </p>
    </div>
  );
}

function StatusPanel({
  status,
  score,
}: {
  status: RagTraceNode["status"];
  score?: number;
}) {
  const statusClass = getStatusClass(status);

  return (
    <div className={`rounded-2xl border p-4 ${statusClass.panel}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-400">Node status</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {formatStatus(status)}
          </p>
        </div>

        {typeof score === "number" && Number.isFinite(score) && (
          <div className="text-right">
            <p className="text-xs text-slate-400">Score</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {(score * 100).toFixed(0)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function getNodeIcon(type: string) {
  if (type === "question") return <MessageSquare size={16} />;
  if (type === "context") return <GitBranch size={16} />;
  if (type === "router" || type === "intent") return <GitBranch size={16} />;
  if (type === "tool" || type === "database" || type === "result") {
    return <Database size={16} />;
  }
  if (type === "retriever") return <Search size={16} />;
  if (type === "sources") return <FileText size={16} />;
  if (type === "composer") return <Sparkles size={16} />;
  if (type === "limitation") return <XCircle size={16} />;
  if (type === "verifier") return <ShieldCheck size={16} />;
  if (type === "answer") return <CheckCircle2 size={16} />;

  return <AlertTriangle size={16} />;
}

function formatStatus(status: RagNodeStatus) {
  if (status === "complete") return "complete";
  if (status === "used") return "used";
  if (status === "warning") return "attention";
  if (status === "failed") return "failed";
  return "skipped";
}

function getStatusClass(status: RagNodeStatus) {
  if (status === "complete" || status === "used") {
    return {
      icon: "bg-emerald-400/15 text-emerald-300",
      badge: "bg-emerald-400/15 text-emerald-300",
      panel: "border-emerald-400/20 bg-emerald-400/10",
    };
  }

  if (status === "skipped") {
    return {
      icon: "bg-slate-400/15 text-slate-300",
      badge: "bg-slate-400/15 text-slate-300",
      panel: "border-white/10 bg-white/[0.03]",
    };
  }

  if (status === "failed") {
    return {
      icon: "bg-red-400/15 text-red-300",
      badge: "bg-red-400/15 text-red-300",
      panel: "border-red-400/20 bg-red-400/10",
    };
  }

  return {
    icon: "bg-amber-400/15 text-amber-300",
    badge: "bg-amber-400/15 text-amber-300",
    panel: "border-amber-400/20 bg-amber-400/10",
  };
}

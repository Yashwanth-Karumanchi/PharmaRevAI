
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

type MarkdownMessageProps = {
  content: string;
};

const components: Components = {
  table({ children }) {
    return (
      <div className="markdownTableWrap">
        <table>{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th>{children}</th>;
  },
  td({ children }) {
    return <td>{children}</td>;
  },
  p({ children }) {
    return <p>{children}</p>;
  },
  ul({ children }) {
    return <ul>{children}</ul>;
  },
  ol({ children }) {
    return <ol>{children}</ol>;
  },
  li({ children }) {
    return <li>{children}</li>;
  },
  code({ children, className }) {
    if (className) {
      return <code className={className}>{children}</code>;
    }

    return <code className="inlineCode">{children}</code>;
  },
  pre({ children }) {
    return <pre className="markdownCodeBlock">{children}</pre>;
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="markdownMessage">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content || ""}
      </ReactMarkdown>
    </div>
  );
}

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Catches React render errors and displays them instead of leaving the page
 * blank. This makes startup/runtime failures visible so they can be fixed.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--bg-primary, #0f172a)",
            color: "var(--text-primary, #f1f5f9)",
            fontFamily: "var(--font-sans, sans-serif)",
            padding: 32,
            overflow: "auto",
            zIndex: 99999,
          }}
        >
          <h1 style={{ color: "var(--error, #ef4444)", marginBottom: 16 }}>
            ETL Studio failed to start
          </h1>
          <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
            A runtime error prevented the app from rendering. Details are below.
            If this persists, try resetting the app with the browser console
            command <code>localStorage.clear(); indexedDB.deleteDatabase(&quot;pwa_etl_file&quot;); location.reload()</code>.
          </p>
          <pre
            style={{
              background: "var(--bg-secondary, #1e293b)",
              border: "1px solid var(--border, #334155)",
              borderRadius: 8,
              padding: 16,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.stack ?? this.state.error.message}
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

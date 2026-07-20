// AI setup panel: configure AI provider (Ollama, Claude, OpenAI, Gemini, Groq, OpenRouter)
// and pick a model. Settings persist in localStorage.

import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import {
  getAiSettings,
  saveAiSettings,
  listOllamaModels,
  type AiProvider,
} from "../../lib/ai";

const PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: "ollama", label: "Ollama (local)" },
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Google Gemini" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
];

const CLAUDE_MODELS = [
  "claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5",
  "claude-sonnet-4-20250514", "claude-3-5-sonnet-latest",
].map((m) => ({ value: m, label: m }));

const OPENAI_MODELS = [
  "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "o3-mini",
].map((m) => ({ value: m, label: m }));

const GEMINI_MODELS = [
  "gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro", "gemini-1.5-flash",
].map((m) => ({ value: m, label: m }));

const GROQ_MODELS = [
  "llama-3.3-70b", "llama-3.1-8b", "mixtral-8x7b", "gemma2-9b",
].map((m) => ({ value: m, label: m }));

export function AiPanel() {
  const open = useEditorStore((s) => s.aiOpen);
  const close = useEditorStore((s) => s.closeAi);

  const [settings, setSettings] = useState(getAiSettings());
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  if (!open) return null;

  const patch = (p: Partial<typeof settings>) => {
    const next = saveAiSettings({ ...settings, ...p });
    setSettings(next);
  };

  const loadOllamaModels = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await listOllamaModels(settings.baseUrl);
      setOllamaModels(list);
      if (!settings.model && list.length > 0) {
        patch({ model: list[0] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const { aiGenerate } = await import("../../lib/ai");
      const result = await aiGenerate({
        provider: settings.provider,
        prompt: "Return exactly the word 'OK' and nothing else.",
        baseUrl: settings.baseUrl,
        model: settings.model,
        claudeApiKey: settings.claudeApiKey,
        claudeModel: settings.claudeModel,
        claudeBaseUrl: settings.claudeBaseUrl,
        openaiApiKey: settings.openaiApiKey,
        openaiModel: settings.openaiModel,
        geminiApiKey: settings.geminiApiKey,
        geminiModel: settings.geminiModel,
        groqApiKey: settings.groqApiKey,
        groqModel: settings.groqModel,
        openrouterApiKey: settings.openrouterApiKey,
        openrouterModel: settings.openrouterModel,
        temperature: settings.temperature,
        maxTokens: 50,
      });
      setTestResult(`Connected! Response: ${result.slice(0, 100)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleKeyVisibility = (provider: string) => {
    setShowKey((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const renderApiKeyInput = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    keyName: string,
  ) => (
    <div className="step-row" style={{ alignItems: "center" }}>
      <input
        className="step-input"
        type={showKey[keyName] ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${label}`}
        style={{ flex: 1, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
      />
      <button
        className="step-icon-btn"
        onClick={() => toggleKeyVisibility(keyName)}
        title={showKey[keyName] ? "Hide" : "Show"}
        style={{ fontSize: 11 }}
      >
        {showKey[keyName] ? "🙈" : "👁"}
      </button>
      {value && (
        <button
          className="step-icon-btn"
          onClick={() => onChange("")}
          title="Clear"
          style={{ fontSize: 11, color: "var(--error)" }}
        >
          ✕
        </button>
      )}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" style={{ width: "min(680px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>AI Setup</span>
          <button className="step-icon-btn" title="Close" onClick={close}>✕</button>
        </div>
        <div className="step-dialog-body">
          {/* Provider selector */}
          <label className="step-field">
            <span className="step-field-label">Provider</span>
            <select
              className="step-input"
              value={settings.provider}
              onChange={(e) => patch({ provider: e.target.value as AiProvider })}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>

          {/* Provider-specific settings */}
          {settings.provider === "ollama" && (
            <>
              <p className="step-field-hint">
                Connect to a local Ollama server. Start Ollama with <code>OLLAMA_ORIGINS=*</code> for browser access.
              </p>
              <label className="step-field">
                <span className="step-field-label">Ollama base URL</span>
                <input className="step-input" value={settings.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} />
              </label>
              <div className="step-row">
                <select
                  className="step-input"
                  value={settings.model}
                  onChange={(e) => patch({ model: e.target.value })}
                >
                  <option value="">(select model)</option>
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <button onClick={loadOllamaModels} disabled={busy}>{busy ? "Loading…" : "Load models"}</button>
              </div>
            </>
          )}

          {settings.provider === "claude" && (
            <>
              <p className="step-field-hint">
                Use Anthropic's Claude API. Get an API key from console.anthropic.com.
              </p>
              <label className="step-field">
                <span className="step-field-label">API Key</span>
                {renderApiKeyInput("Claude API Key", settings.claudeApiKey, (v) => patch({ claudeApiKey: v }), "claude")}
              </label>
              <label className="step-field">
                <span className="step-field-label">Model</span>
                <select
                  className="step-input"
                  value={settings.claudeModel}
                  onChange={(e) => patch({ claudeModel: e.target.value })}
                >
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label className="step-field">
                <span className="step-field-label">Base URL</span>
                <input className="step-input" value={settings.claudeBaseUrl} onChange={(e) => patch({ claudeBaseUrl: e.target.value })} />
              </label>
            </>
          )}

          {settings.provider === "openai" && (
            <>
              <p className="step-field-hint">
                Use OpenAI's API. Get an API key from platform.openai.com.
              </p>
              <label className="step-field">
                <span className="step-field-label">API Key</span>
                {renderApiKeyInput("OpenAI API Key", settings.openaiApiKey, (v) => patch({ openaiApiKey: v }), "openai")}
              </label>
              <label className="step-field">
                <span className="step-field-label">Model</span>
                <select
                  className="step-input"
                  value={settings.openaiModel}
                  onChange={(e) => patch({ openaiModel: e.target.value })}
                >
                  {OPENAI_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          {settings.provider === "gemini" && (
            <>
              <p className="step-field-hint">
                Use Google's Gemini API. Get an API key from aistudio.google.com.
              </p>
              <label className="step-field">
                <span className="step-field-label">API Key</span>
                {renderApiKeyInput("Gemini API Key", settings.geminiApiKey, (v) => patch({ geminiApiKey: v }), "gemini")}
              </label>
              <label className="step-field">
                <span className="step-field-label">Model</span>
                <select
                  className="step-input"
                  value={settings.geminiModel}
                  onChange={(e) => patch({ geminiModel: e.target.value })}
                >
                  {GEMINI_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          {settings.provider === "groq" && (
            <>
              <p className="step-field-hint">
                Use Groq's fast inference API. Get an API key from console.groq.com.
              </p>
              <label className="step-field">
                <span className="step-field-label">API Key</span>
                {renderApiKeyInput("Groq API Key", settings.groqApiKey, (v) => patch({ groqApiKey: v }), "groq")}
              </label>
              <label className="step-field">
                <span className="step-field-label">Model</span>
                <select
                  className="step-input"
                  value={settings.groqModel}
                  onChange={(e) => patch({ groqModel: e.target.value })}
                >
                  {GROQ_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          {settings.provider === "openrouter" && (
            <>
              <p className="step-field-hint">
                Use OpenRouter to access many models through one API. Get an API key from openrouter.ai/keys.
              </p>
              <label className="step-field">
                <span className="step-field-label">API Key</span>
                {renderApiKeyInput("OpenRouter API Key", settings.openrouterApiKey, (v) => patch({ openrouterApiKey: v }), "openrouter")}
              </label>
              <label className="step-field">
                <span className="step-field-label">Model</span>
                <input
                  className="step-input"
                  value={settings.openrouterModel}
                  onChange={(e) => patch({ openrouterModel: e.target.value })}
                  placeholder="openai/gpt-4o, anthropic/claude-sonnet-4, etc."
                  style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
                />
                <span className="step-field-hint">Enter any model ID supported by OpenRouter</span>
              </label>
            </>
          )}

          {/* Shared settings */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
            <label className="step-field">
              <span className="step-field-label">Temperature: {settings.temperature}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.temperature}
                onChange={(e) => patch({ temperature: parseFloat(e.target.value) })}
                style={{ width: "100%" }}
              />
            </label>
            <label className="step-field">
              <span className="step-field-label">Max tokens</span>
              <input
                className="step-input"
                type="number"
                value={settings.maxTokens}
                min={64}
                max={8192}
                step={64}
                onChange={(e) => patch({ maxTokens: parseInt(e.target.value) || 1024 })}
              />
            </label>
          </div>

          {/* Test connection */}
          <div style={{ marginTop: 12 }}>
            <button onClick={testConnection} disabled={busy} className="primary">
              {busy ? "Testing..." : "Test connection"}
            </button>
            {testResult && (
              <div style={{
                marginTop: 8,
                padding: "8px 10px",
                background: "rgba(34,197,94,0.1)",
                border: "1px solid var(--success)",
                borderRadius: "var(--radius)",
                fontSize: 12,
                color: "var(--success)",
              }}>
                {testResult}
              </div>
            )}
          </div>

          {error && <div className="step-error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

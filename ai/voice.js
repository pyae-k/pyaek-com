// voice.js — browser voice I/O helpers for ChatAI PWA.
// Uses the Web Speech API when available; falls back to configured API providers for
// speech-to-text (Whisper) and text-to-speech (OpenAI / ElevenLabs).

import { typeById } from "./providers.js";

export function isSpeechRecognitionSupported() {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function isSpeechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// ---------- Speech-to-text (Web Speech API) ----------

export function createSpeechRecognizer({ onResult, onError, onEnd, lang = "en-US" } = {}) {
  if (!isSpeechRecognitionSupported()) throw new Error("Speech recognition not supported in this browser");
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = lang;
  rec.maxAlternatives = 1;
  let finalTranscript = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0].transcript;
      if (r.isFinal) finalTranscript += text;
      else interim += text;
    }
    if (onResult) onResult({ final: finalTranscript, interim });
  };
  rec.onerror = (e) => {
    if (e.error === "aborted" || e.error === "no-speech") return;
    if (onError) onError(new Error(`Speech recognition error: ${e.error}`));
  };
  rec.onend = () => {
    if (onEnd) onEnd(finalTranscript);
  };
  return rec;
}

// ---------- Speech-to-text (Whisper API) ----------

export async function transcribeWithWhisper(connection, audioBlob, signal) {
  const type = typeById(connection.type);
  const endpoint = connection.endpoint || type?.defaultEndpoint || "";
  const key = connection.key || "";
  if (!endpoint) throw new Error("No Whisper endpoint configured");
  if (!key && type?.keyRequired) throw new Error(`${type?.label || connection.type} requires an API key`);

  const form = new FormData();
  form.append("file", audioBlob, "recording.webm");
  form.append("model", connection.model || type?.defaultModel || "whisper-1");
  form.append("response_format", "json");

  const headers = {};
  if (key) headers["Authorization"] = "Bearer " + key;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: form,
    signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`${type?.label || connection.type} HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.text || data.transcription || "";
}

// ---------- Text-to-speech (Web Speech API) ----------

let currentUtterance = null;

export function stopSpeaking() {
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
  if (currentUtterance?.audio) {
    currentUtterance.audio.pause();
    currentUtterance.audio.currentTime = 0;
  }
  currentUtterance = null;
}

export function speakWithWebSpeech(text, { voiceURI, rate = 1, pitch = 1, lang, onEnd, onError } = {}) {
  if (!isSpeechSynthesisSupported()) {
    if (onError) onError(new Error("Text-to-speech not supported in this browser"));
    return null;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  if (lang) utter.lang = lang;
  utter.rate = rate;
  utter.pitch = pitch;
  if (voiceURI) {
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.voiceURI === voiceURI);
    if (voice) utter.voice = voice;
  }
  utter.onend = () => { currentUtterance = null; if (onEnd) onEnd(); };
  utter.onerror = (e) => { currentUtterance = null; if (onError) onError(e); };
  currentUtterance = { type: "web", utter };
  window.speechSynthesis.speak(utter);
  return utter;
}

export function getWebSpeechVoices() {
  if (!isSpeechSynthesisSupported()) return [];
  return window.speechSynthesis.getVoices();
}

// ---------- Text-to-speech (OpenAI TTS) ----------

export async function speakWithOpenAI_TTS(connection, text, signal) {
  const type = typeById(connection.type);
  const endpoint = connection.endpoint || type?.defaultEndpoint || "";
  const key = connection.key || "";
  if (!endpoint) throw new Error("No TTS endpoint configured");
  if (!key && type?.keyRequired) throw new Error(`${type?.label || connection.type} requires an API key`);

  const body = {
    model: connection.model || type?.defaultModel || "tts-1",
    input: text,
    voice: "alloy",
    response_format: "mp3",
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`${type?.label || connection.type} HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const blob = await resp.blob();
  return playAudioBlob(blob, signal);
}

// ---------- Text-to-speech (ElevenLabs) ----------

export async function speakWithElevenLabs_TTS(connection, text, signal) {
  const type = typeById(connection.type);
  let endpoint = connection.endpoint || type?.defaultEndpoint || "";
  const key = connection.key || "";
  const voiceId = connection.model || type?.defaultModel || "21m00Tcm4TlvDq8ikWAM";
  if (!endpoint) throw new Error("No ElevenLabs endpoint configured");
  if (!key && type?.keyRequired) throw new Error(`${type?.label || connection.type} requires an API key`);

  endpoint = endpoint.replace("{voice_id}", encodeURIComponent(voiceId));

  const body = {
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": key },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`${type?.label || connection.type} HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const blob = await resp.blob();
  return playAudioBlob(blob, signal);
}

// ---------- Audio playback helper ----------

function playAudioBlob(blob, signal) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const abortHandler = () => {
      audio.pause();
      audio.currentTime = 0;
      URL.revokeObjectURL(url);
      reject(new Error("aborted"));
    };
    if (signal) signal.addEventListener("abort", abortHandler);
    audio.onended = () => {
      if (signal) signal.removeEventListener("abort", abortHandler);
      URL.revokeObjectURL(url);
      currentUtterance = null;
      resolve();
    };
    audio.onerror = (e) => {
      if (signal) signal.removeEventListener("abort", abortHandler);
      URL.revokeObjectURL(url);
      currentUtterance = null;
      reject(e);
    };
    currentUtterance = { type: "api", audio };
    audio.play().catch(reject);
  });
}

// ---------- High-level TTS dispatcher ----------

export async function speakText(text, settings, connections, signal) {
  const provider = settings?.ttsProvider || "web-speech";
  if (provider === "web-speech") {
    return new Promise((resolve, reject) => {
      speakWithWebSpeech(text, {
        voiceURI: settings?.ttsVoice || "",
        rate: settings?.ttsRate || 1,
        pitch: settings?.ttsPitch || 1,
        lang: settings?.ttsLang || "",
        onEnd: resolve,
        onError: reject,
      });
    });
  }

  const match = connections.find((c) => c.enabled !== false && c.type === provider);
  if (!match) throw new Error(`No enabled ${provider} connection for text-to-speech`);

  if (provider === "openai_tts") return speakWithOpenAI_TTS(match, text, signal);
  if (provider === "elevenlabs_tts") return speakWithElevenLabs_TTS(match, text, signal);
  throw new Error(`Unsupported TTS provider: ${provider}`);
}

// ---------- High-level STT dispatcher ----------

export async function transcribeAudio(audioBlob, settings, connections, signal) {
  const provider = settings?.voiceInputProvider || "web-speech";
  if (provider === "web-speech") {
    throw new Error("Web Speech transcription happens live via createSpeechRecognizer; use that path");
  }
  const match = connections.find((c) => c.enabled !== false && c.type === provider);
  if (!match) throw new Error(`No enabled ${provider} connection for speech-to-text`);
  return transcribeWithWhisper(match, audioBlob, signal);
}

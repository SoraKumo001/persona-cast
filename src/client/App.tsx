import React, { useState, useEffect } from "react";
import { Persona } from "../worker/types";
import { DEFAULT_PERSONAS } from "../worker/presets";
import { UrlInputForm } from "./components/UrlInputForm";
import { DialogueStage, DisplayMessage, PastMemoryInfo } from "./components/DialogueStage";
import { MemoryExplorer } from "./components/MemoryExplorer";
import { PersonaManager } from "./components/PersonaManager";
import { Radio, BrainCircuit, Users, Sparkles, Activity } from "lucide-react";

export default function App() {
  const [activeTab, setActiveTab] = useState<"stage" | "memories" | "personas">("stage");
  const [personas, setPersonas] = useState<Persona[]>(DEFAULT_PERSONAS);
  const [healthStatus, setHealthStatus] = useState<any>(null);

  // 対談ステージの状態
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [articleTitle, setArticleTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [stagePersonas, setStagePersonas] = useState<Persona[]>([]);
  const [currentSpeakerId, setCurrentSpeakerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [pastMemories, setPastMemories] = useState<PastMemoryInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  useEffect(() => {
    loadPersonas();
    checkHealth();
  }, []);

  const loadPersonas = async () => {
    try {
      const res = await fetch("/api/personas");
      const data = await res.json();
      if (data.personas) {
        setPersonas(data.personas);
      }
    } catch (err) {
      console.error("Failed to fetch personas:", err);
    }
  };

  const checkHealth = async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setHealthStatus(data);
    } catch (err) {
      console.warn("Health check failed:", err);
    }
  };

  // 新規セッション開始とSSEストリーミング接続
  const handleStartDialogue = async ({
    url,
    personaIds,
    totalTurns,
    modelName,
  }: {
    url: string;
    personaIds: string[];
    totalTurns: number;
    modelName: string;
  }) => {
    setIsLoading(true);
    setIsCompleted(false);
    setMessages([]);
    setCurrentSpeakerId(null);

    // 参加ペルソナオブジェクトの特定
    const selected = personas.filter((p) => personaIds.includes(p.id));
    setStagePersonas(selected);
    setSourceUrl(url);

    try {
      // 1. セッション作成 (URLスクレイピング & 過去記憶検索)
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, personaIds, totalTurns, modelName }),
      });

      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || "対談セッションの作成に失敗しました");
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      setSessionId(data.sessionId);
      setArticleTitle(data.articleTitle);
      setPastMemories(data.pastMemories || []);
      setIsLoading(false);
      setIsStreaming(true);

      // 2. SSEストリーミング接続
      if (eventSource) {
        eventSource.close();
      }

      const sse = new EventSource(
        `/api/sessions/${data.sessionId}/stream?turns=${totalTurns}&model=${encodeURIComponent(modelName)}`
      );
      setEventSource(sse);

      sse.addEventListener("session_start", (e: MessageEvent) => {
        const evt = JSON.parse(e.data);
        console.log("Dialogue session started:", evt);
      });

      sse.addEventListener("turn_start", (e: MessageEvent) => {
        const evt = JSON.parse(e.data);
        const persona = evt.persona;
        setCurrentSpeakerId(persona.id);

        setMessages((prev) => [
          ...prev,
          {
            turnIndex: evt.turnIndex,
            personaId: persona.id,
            personaName: persona.name,
            personaRole: persona.role,
            personaAvatar: persona.avatar,
            personaThemeColor: persona.themeColor,
            content: "",
            isStreaming: true,
          },
        ]);
      });

      sse.addEventListener("chunk", (e: MessageEvent) => {
        const evt = JSON.parse(e.data);
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: updated[lastIdx].content + evt.chunk,
            isStreaming: true,
          };
          return updated;
        });
      });

      sse.addEventListener("turn_end", (e: MessageEvent) => {
        const evt = JSON.parse(e.data);
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: evt.content,
            isStreaming: false,
            referencedSessionId: evt.referencedSessionId,
            referencedArticleTitle: evt.referencedArticleTitle,
          };
          return updated;
        });
      });

      sse.addEventListener("session_end", () => {
        setCurrentSpeakerId(null);
        setIsStreaming(false);
        setIsCompleted(true);
        sse.close();
      });

      sse.addEventListener("error", (e: any) => {
        console.error("SSE stream error:", e);
        setIsStreaming(false);
        setCurrentSpeakerId(null);
        sse.close();
      });
    } catch (err: any) {
      console.error("Start dialogue error:", err);
      alert(`対談の開始に失敗しました: ${err.message}`);
      setIsLoading(false);
      setIsStreaming(false);
    }
  };

  // 過去セッションを開いて表示
  const handleOpenPastSession = async (pastSessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${pastSessionId}`);
      const data = await res.json();
      if (data.session) {
        setSessionId(data.session.id);
        setArticleTitle(data.session.articleTitle);
        setSourceUrl(data.session.sourceUrl);
        setPastMemories([]);
        setIsCompleted(true);
        setIsStreaming(false);

        // メッセージ復元
        const formattedMessages: DisplayMessage[] = (data.messages || []).map((m: any) => ({
          turnIndex: m.turnIndex,
          personaId: m.personaId,
          personaName: m.personaName || "ペルソナ",
          personaRole: "",
          personaAvatar: m.personaAvatar || "🎙️",
          personaThemeColor: m.personaThemeColor || "#3b82f6",
          content: m.content,
          isStreaming: false,
          referencedSessionId: m.referencedSessionId,
          referencedArticleTitle: m.referencedArticleTitle,
        }));
        setMessages(formattedMessages);

        // 参加ペルソナ設定
        const active = personas.filter((p) => data.session.personaIds.includes(p.id));
        setStagePersonas(active.length > 0 ? active : personas.slice(0, 2));

        setActiveTab("stage");
      }
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  };

  const handleReset = () => {
    if (eventSource) {
      eventSource.close();
    }
    setSessionId(null);
    setArticleTitle("");
    setSourceUrl("");
    setMessages([]);
    setPastMemories([]);
    setIsStreaming(false);
    setIsCompleted(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* ナビゲーションバー */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl p-1.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 shadow-lg shadow-indigo-500/20">
              🎙️
            </span>
            <div>
              <h1 className="font-bold text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Persona-Cast
              </h1>
              <p className="text-[10px] text-slate-400 hidden sm:block">
                URL記事を題材に、AIペルソナが過去の対談記憶を辿りながら語り合う
              </p>
            </div>
          </div>

          {/* タブ切り替え */}
          <nav className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab("stage")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === "stage"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>対談ステージ</span>
            </button>

            <button
              onClick={() => setActiveTab("memories")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === "memories"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <BrainCircuit className="w-3.5 h-3.5" />
              <span>記憶探索</span>
            </button>

            <button
              onClick={() => setActiveTab("personas")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === "personas"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>ペルソナ設定</span>
            </button>
          </nav>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        {activeTab === "stage" && (
          <div className="space-y-6">
            {!sessionId ? (
              <UrlInputForm
                personas={personas}
                onSubmit={handleStartDialogue}
                isLoading={isLoading}
              />
            ) : (
              <DialogueStage
                articleTitle={articleTitle}
                sourceUrl={sourceUrl}
                personas={stagePersonas}
                currentSpeakerId={currentSpeakerId}
                messages={messages}
                pastMemories={pastMemories}
                isStreaming={isStreaming}
                isCompleted={isCompleted}
                onReset={handleReset}
                onSelectPastSession={handleOpenPastSession}
              />
            )}
          </div>
        )}

        {activeTab === "memories" && (
          <MemoryExplorer onOpenSession={handleOpenPastSession} />
        )}

        {activeTab === "personas" && (
          <PersonaManager personas={personas} onRefresh={loadPersonas} />
        )}
      </main>

      {/* フッター */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 px-4 text-center text-xs text-slate-500">
        <div className="flex flex-wrap items-center justify-center gap-4">
          <span className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Infra: Cloudflare Workers + D1 + Vectorize</span>
          </span>
          <span>•</span>
          <span>Embedding: Workers AI (@cf/baai/bge-m3)</span>
          <span>•</span>
          <span>LLM: OpenCode Go API</span>
        </div>
      </footer>
    </div>
  );
}

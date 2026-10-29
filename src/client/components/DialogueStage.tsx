import React, { useRef, useEffect } from "react";
import { Persona } from "../../worker/types";
import { Sparkles, BrainCircuit, ExternalLink, RefreshCw, CheckCircle2 } from "lucide-react";

export interface DisplayMessage {
  turnIndex: number;
  personaId: string;
  personaName: string;
  personaRole: string;
  personaAvatar: string;
  personaThemeColor: string;
  content: string;
  isStreaming?: boolean;
  referencedSessionId?: string | null;
  referencedArticleTitle?: string | null;
}

export interface PastMemoryInfo {
  sessionId: string;
  articleTitle: string;
  topicSummary: string;
  score: number;
}

interface DialogueStageProps {
  articleTitle: string;
  sourceUrl: string;
  personas: Persona[];
  currentSpeakerId: string | null;
  messages: DisplayMessage[];
  pastMemories: PastMemoryInfo[];
  isStreaming: boolean;
  isCompleted: boolean;
  onReset: () => void;
  onSelectPastSession?: (sessionId: string) => void;
}

export const DialogueStage: React.FC<DialogueStageProps> = ({
  articleTitle,
  sourceUrl,
  personas,
  currentSpeakerId,
  messages,
  pastMemories,
  isStreaming,
  isCompleted,
  onReset,
  onSelectPastSession,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 新しい発言やストリーミング中にスムーズに下部へスクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="space-y-6">
      {/* 記事ヘッダー情報 */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mb-2">
              <Sparkles className="w-3 h-3" />
              対談トピック
            </span>
            <h2 className="text-lg sm:text-xl font-bold text-slate-100 truncate">
              {articleTitle || "記事を読み込み中..."}
            </h2>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-400 transition-colors mt-1"
            >
              <ExternalLink className="w-3 h-3" />
              <span className="truncate max-w-xs sm:max-w-md">{sourceUrl}</span>
            </a>
          </div>

          <button
            onClick={onReset}
            className="self-start sm:self-center px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            新しい記事で対談
          </button>
        </div>

        {/* 過去記憶の引き出しアラート (Workers AI Embedding + Vectorize) */}
        {pastMemories.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-800/80">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 mb-2">
              <BrainCircuit className="w-4 h-4" />
              <span>過去の対談記憶（エピソード記憶）を発見・AIへ注入しました</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {pastMemories.map((mem) => (
                <div
                  key={mem.sessionId}
                  onClick={() => onSelectPastSession && onSelectPastSession(mem.sessionId)}
                  className="bg-amber-950/20 border border-amber-800/40 rounded-lg p-2.5 hover:bg-amber-950/40 transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center justify-between text-xs text-amber-300 font-medium">
                    <span className="truncate max-w-[180px]">『{mem.articleTitle}』</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200">
                      類似度 {Math.round(mem.score * 100)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                    {mem.topicSummary}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 参加ペルソナブース (話者インジケーター) */}
      <div className="flex flex-wrap items-center justify-center gap-4 py-2">
        {personas.map((p) => {
          const isSpeaking = currentSpeakerId === p.id;
          return (
            <div
              key={p.id}
              className={`flex items-center gap-3 px-4 py-2 rounded-xl border transition-all duration-300 ${
                isSpeaking
                  ? "bg-indigo-950/60 border-indigo-500 shadow-lg shadow-indigo-500/20 scale-105"
                  : "bg-slate-900/60 border-slate-800 opacity-75"
              }`}
            >
              <span
                className={`text-2xl p-1.5 rounded-lg bg-slate-950 border border-slate-800 ${
                  isSpeaking ? "animate-pulse ring-2 ring-indigo-400" : ""
                }`}
              >
                {p.avatar}
              </span>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-200">{p.name}</span>
                  {isSpeaking && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400">{p.role}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 会話タイムライン */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 min-h-[420px] max-h-[680px] overflow-y-auto space-y-6">
        {messages.length === 0 && isStreaming && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">ペルソナたちが記事を読み込み、議論を開始しています...</p>
          </div>
        )}

        {messages.map((msg, index) => {
          return (
            <div key={index} className="flex gap-4 items-start animate-in fade-in duration-300">
              {/* アバター */}
              <div className="shrink-0 flex flex-col items-center">
                <span className="text-2xl p-2.5 rounded-2xl bg-slate-800 border border-slate-700 shadow-md">
                  {msg.personaAvatar}
                </span>
                <span className="text-[10px] text-slate-500 font-mono mt-1">
                  #{msg.turnIndex + 1}
                </span>
              </div>

              {/* 発言吹き出し */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-bold text-slate-200">{msg.personaName}</span>
                  <span className="text-[11px] text-slate-400 px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/60">
                    {msg.personaRole}
                  </span>

                  {/* 過去記憶引用バッジ */}
                  {msg.referencedArticleTitle && (
                    <span
                      onClick={() =>
                        msg.referencedSessionId &&
                        onSelectPastSession &&
                        onSelectPastSession(msg.referencedSessionId)
                      }
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 cursor-pointer hover:bg-amber-500/20 transition-colors"
                      title="クリックすると引用元の過去対談を開きます"
                    >
                      <BrainCircuit className="w-3 h-3" />
                      過去対談『{msg.referencedArticleTitle}』を引用
                    </span>
                  )}
                </div>

                <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-slate-100 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
                  {msg.content}
                  {msg.isStreaming && (
                    <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isCompleted && (
          <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/50 text-emerald-300 text-xs flex items-center justify-between gap-3 mt-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                対談が完了しました！議論の要点はCloudflare Workers AIでベクトル化され、長期記憶として保存されました。
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

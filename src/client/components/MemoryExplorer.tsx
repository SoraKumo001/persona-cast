import React, { useState, useEffect } from "react";
import { Search, BrainCircuit, ExternalLink, Calendar, MessageSquare, ArrowRight } from "lucide-react";

interface MemoryItem {
  id: string;
  sessionId: string;
  articleTitle: string;
  sourceUrl: string;
  topicSummary: string;
  keyQuotes: string;
  personaIds: string[];
  score?: number;
  createdAt: string;
}

interface MemoryExplorerProps {
  onOpenSession: (sessionId: string) => void;
}

export const MemoryExplorer: React.FC<MemoryExplorerProps> = ({ onOpenSession }) => {
  const [query, setQuery] = useState("");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);

  // 初回ロード時は最近の記憶一覧を取得
  useEffect(() => {
    loadRecentMemories();
  }, []);

  const loadRecentMemories = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/memories");
      const data: any = await res.json();
      if (data.memories) {
        setMemories(data.memories);
      }
    } catch (err) {
      console.error("Failed to load memories:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setIsSearchMode(false);
      loadRecentMemories();
      return;
    }

    setIsLoading(true);
    setIsSearchMode(true);
    try {
      const res = await fetch(`/api/memories/search?q=${encodeURIComponent(query.trim())}`);
      const data: any = await res.json();
      if (data.results) {
        setMemories(data.results);
      }
    } catch (err) {
      console.error("Semantic search failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const sampleQueries = ["インフラの運用と課金", "ユーザー体験とプロダクト開発", "AIの倫理とデータセキュリティ"];

  return (
    <div className="space-y-6">
      {/* 検索バー */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-2 text-indigo-400 text-xs font-semibold">
          <BrainCircuit className="w-4 h-4" />
          <span>Cloudflare Workers AI 埋め込みモデルによるセマンティック記憶検索</span>
        </div>
        <h3 className="text-lg font-bold text-slate-100 mb-3">
          過去の対談エピソード・記憶を辿る
        </h3>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          単語の完全一致だけでなく、AIが意味的な類似度（Vectorize / bge-m3）を計算して、過去にペルソナたちが議論した記憶を引き出します。
        </p>

        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="知りたいトピックや議論内容を入力（例: エッジコンピューティングの課題）..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            {isLoading ? "検索中..." : "記憶を検索"}
          </button>
        </form>

        <div className="flex flex-wrap gap-2 mt-3 items-center">
          <span className="text-xs text-slate-500">おすすめクエリ:</span>
          {sampleQueries.map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuery(q);
              }}
              className="text-xs px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-md transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* 記憶カード一覧 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>
            {isSearchMode ? `「${query}」の検索結果 (${memories.length}件)` : `最近の長期記憶 (${memories.length}件)`}
          </span>
          {isSearchMode && (
            <button
              onClick={() => {
                setQuery("");
                setIsSearchMode(false);
                loadRecentMemories();
              }}
              className="text-indigo-400 hover:underline"
            >
              全件表示に戻す
            </button>
          )}
        </div>

        {memories.length === 0 && !isLoading && (
          <div className="text-center py-16 bg-slate-900/40 border border-slate-800/60 rounded-2xl text-slate-400">
            <BrainCircuit className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-medium">該当する過去の対談記憶が見つかりませんでした</p>
            <p className="text-xs text-slate-500 mt-1">
              対談ステージで新しいURLについて議論を行うと、自動的に記憶が蓄積されます。
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {memories.map((mem) => (
            <div
              key={mem.id}
              className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-xl p-5 shadow-sm transition-all hover:shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h4 className="font-semibold text-slate-100 text-sm leading-snug line-clamp-2">
                    {mem.articleTitle}
                  </h4>
                  {mem.score !== undefined && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 shrink-0">
                      一致度 {Math.round(mem.score * 100)}%
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed line-clamp-3 mb-3">
                  {mem.topicSummary}
                </p>

                {mem.keyQuotes && (
                  <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 text-slate-400 text-[11px] italic mb-3 line-clamp-2">
                    💭 "{mem.keyQuotes}"
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-500" />
                  <span>{new Date(mem.createdAt).toLocaleDateString("ja-JP")}</span>
                </div>

                <div className="flex items-center gap-2">
                  {mem.sourceUrl && (
                    <a
                      href={mem.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-indigo-400 transition-colors"
                      title="元記事を開く"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    onClick={() => onOpenSession(mem.sessionId)}
                    className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                  >
                    <span>対談ログを見る</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

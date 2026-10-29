import { ArrowRight, BrainCircuit, Calendar, ExternalLink, Search } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

interface MemoryItem {
  articleTitle: string;
  createdAt: string;
  id: string;
  keyQuotes: string;
  personaIds: string[];
  score?: number;
  sessionId: string;
  sourceUrl: string;
  topicSummary: string;
}

interface MemoryExplorerProps {
  onOpenSession: (sessionId: string) => void;
}

export const MemoryExplorer: React.FC<MemoryExplorerProps> = ({ onOpenSession }) => {
  const [query, setQuery] = useState("");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);

  const loadRecentMemories = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/memories");
      const data = (await res.json()) as { memories?: MemoryItem[] };
      if (data.memories) {
        setMemories(data.memories);
      }
    } catch (err) {
      console.error("Failed to load memories:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回ロード時は最近の記憶一覧を取得
  useEffect(() => {
    loadRecentMemories();
  }, [loadRecentMemories]);

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
      const data = (await res.json()) as { results?: MemoryItem[] };
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
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-indigo-400">
          <BrainCircuit className="h-4 w-4" />
          <span>Cloudflare Workers AI 埋め込みモデルによるセマンティック記憶検索</span>
        </div>
        <h3 className="mb-3 text-lg font-bold text-zinc-100">過去の対談エピソード・記憶を辿る</h3>
        <p className="mb-4 text-xs leading-relaxed text-zinc-400">
          単語の完全一致だけでなく、AIが意味的な類似度（Vectorize /
          bge-m3）を計算して、過去にペルソナたちが議論した記憶を引き出します。
        </p>

        <form className="flex gap-2" onSubmit={handleSearch}>
          <div className="relative flex-1">
            <Search className="absolute top-3.5 left-3.5 h-4 w-4 text-zinc-400" />
            <input
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 py-2.5 pr-4 pl-10 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-indigo-500 focus:outline-none"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="知りたいトピックや議論内容を入力（例: エッジコンピューティングの課題）..."
              type="text"
              value={query}
            />
          </div>
          <button
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            disabled={isLoading}
            type="submit"
          >
            {isLoading ? "検索中..." : "記憶を検索"}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">おすすめクエリ:</span>
          {sampleQueries.map((q) => (
            <button
              className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
              key={q}
              onClick={() => {
                setQuery(q);
              }}
              type="button"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* 記憶カード一覧 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1 text-xs text-zinc-400">
          <span>
            {isSearchMode ? `「${query}」の検索結果 (${memories.length}件)` : `最近の長期記憶 (${memories.length}件)`}
          </span>
          {isSearchMode ? (
            <button
              className="text-indigo-400 hover:underline"
              onClick={() => {
                setQuery("");
                setIsSearchMode(false);
                loadRecentMemories();
              }}
              type="button"
            >
              全件表示に戻す
            </button>
          ) : null}
        </div>

        {memories.length === 0 && !isLoading && (
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 py-16 text-center text-zinc-400">
            <BrainCircuit className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
            <p className="text-sm font-medium">該当する過去の対談記憶が見つかりませんでした</p>
            <p className="mt-1 text-xs text-zinc-500">
              対談ステージで新しいURLについて議論を行うと、自動的に記憶が蓄積されます。
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {memories.map((mem) => (
            <div
              className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm transition-all hover:border-zinc-700 hover:shadow-md"
              key={mem.id}
            >
              <div>
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h4 className="line-clamp-2 text-sm leading-snug font-semibold text-zinc-100">{mem.articleTitle}</h4>
                  {mem.score !== undefined && (
                    <span className="shrink-0 rounded-full border border-indigo-700/60 bg-indigo-950/80 px-2 py-0.5 font-mono text-[11px] text-indigo-300">
                      一致度 {Math.round(mem.score * 100)}%
                    </span>
                  )}
                </div>

                <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-zinc-300">{mem.topicSummary}</p>

                {mem.keyQuotes ? (
                  <div className="mb-3 line-clamp-2 rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-2.5 text-[11px] text-zinc-400 italic">
                    💭 "{mem.keyQuotes}"
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between border-t border-zinc-800/60 pt-3 text-[11px] text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                  <span>{new Date(mem.createdAt).toLocaleDateString("ja-JP")}</span>
                </div>

                <div className="flex items-center gap-2">
                  {mem.sourceUrl ? (
                    <a
                      className="transition-colors hover:text-indigo-400"
                      href={mem.sourceUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                      title="元記事を開く"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  <button
                    className="inline-flex items-center gap-1 font-medium text-indigo-400 transition-colors hover:text-indigo-300"
                    onClick={() => onOpenSession(mem.sessionId)}
                    type="button"
                  >
                    <span>対談ログを見る</span>
                    <ArrowRight className="h-3.5 w-3.5" />
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

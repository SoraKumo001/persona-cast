import React, { useState } from "react";
import { Persona } from "../../worker/types";
import { Sparkles, Globe, Radio, Settings2, CheckCircle2 } from "lucide-react";

interface UrlInputFormProps {
  personas: Persona[];
  onSubmit: (data: { url: string; personaIds: string[]; totalTurns: number; modelName: string }) => void;
  isLoading: boolean;
}

const PRESET_URLS = [
  {
    label: "Cloudflare Blog (Workers AI)",
    url: "https://blog.cloudflare.com/workers-ai/",
  },
  {
    label: "Hono Web Framework",
    url: "https://hono.dev/",
  },
  {
    label: "OpenCode AI Documentation",
    url: "https://opencode.ai/",
  },
];

export const UrlInputForm: React.FC<UrlInputFormProps> = ({ personas, onSubmit, isLoading }) => {
  const [url, setUrl] = useState("");
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>(
    personas.slice(0, 2).map((p) => p.id)
  );
  const [totalTurns, setTotalTurns] = useState<number>(6);
  const [modelName, setModelName] = useState<string>("deepseek-v4.1-flash");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ペルソナがロードされた時、未選択なら先頭2つを選択
  React.useEffect(() => {
    if (selectedPersonaIds.length === 0 && personas.length > 0) {
      setSelectedPersonaIds(personas.slice(0, 2).map((p) => p.id));
    }
  }, [personas]);

  const togglePersona = (id: string) => {
    if (selectedPersonaIds.includes(id)) {
      if (selectedPersonaIds.length > 1) {
        setSelectedPersonaIds(selectedPersonaIds.filter((p) => p !== id));
      }
    } else {
      if (selectedPersonaIds.length < 3) {
        setSelectedPersonaIds([...selectedPersonaIds, id]);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || selectedPersonaIds.length === 0) return;
    onSubmit({
      url: url.trim(),
      personaIds: selectedPersonaIds,
      totalTurns,
      modelName,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
      <div className="space-y-6">
        {/* URL入力 */}
        <div>
          <label className="block text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-400" />
            語り合いたい記事のURL
          </label>
          <div className="relative">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article..."
              className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
              disabled={isLoading}
            />
          </div>

          {/* サンプルURL */}
          <div className="flex flex-wrap gap-2 mt-2 items-center">
            <span className="text-xs text-slate-500">サンプル:</span>
            {PRESET_URLS.map((preset) => (
              <button
                key={preset.url}
                type="button"
                onClick={() => setUrl(preset.url)}
                className="text-xs px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-300 rounded-md transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* 参加ペルソナ選択 */}
        <div>
          <label className="block text-sm font-semibold text-slate-200 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" />
              参加するペルソナを選択（2〜3人）
            </span>
            <span className="text-xs text-slate-400">
              選択中: {selectedPersonaIds.length} / 3 人
            </span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {personas.map((p) => {
              const isSelected = selectedPersonaIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  onClick={() => !isLoading && togglePersona(p.id)}
                  className={`cursor-pointer border rounded-xl p-3.5 transition-all relative select-none ${
                    isSelected
                      ? "bg-slate-800/90 border-indigo-500/80 ring-2 ring-indigo-500/30"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700 opacity-70 hover:opacity-100"
                  }`}
                >
                  {isSelected && (
                    <CheckCircle2 className="w-4 h-4 text-indigo-400 absolute top-3 right-3" />
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-2xl p-2 rounded-lg bg-slate-900 border border-slate-800">
                      {p.avatar}
                    </span>
                    <div className="min-w-0 pr-4">
                      <h4 className="font-medium text-slate-100 text-sm truncate">{p.name}</h4>
                      <p className="text-xs text-slate-400 truncate">{p.role}</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                    {p.personality}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* 詳細設定トグル */}
        <div className="pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {showAdvanced ? "詳細設定を閉じる" : "詳細設定 (モデル・ターン数)"}
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 p-4 bg-slate-950/60 border border-slate-800/80 rounded-xl">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  対談ターン数
                </label>
                <select
                  value={totalTurns}
                  onChange={(e) => setTotalTurns(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200"
                  disabled={isLoading}
                >
                  <option value={4}>4 ターン（手短な感想）</option>
                  <option value={6}>6 ターン（おすすめ・標準）</option>
                  <option value={8}>8 ターン（深掘りディスカッション）</option>
                  <option value={10}>10 ターン（徹底議論）</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  OpenCode Go AI モデル
                </label>
                <select
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200"
                  disabled={isLoading}
                >
                  <option value="deepseek-v4.1-flash">DeepSeek V4.1 Flash (推奨・高速)</option>
                  <option value="glm-5.3-flash">GLM-5.3-Flash (多言語・安定)</option>
                  <option value="kimi-k3.1-pro">Kimi K3.1 Pro (長文・高精度)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* スタートボタン */}
        <button
          type="submit"
          disabled={isLoading || !url.trim() || selectedPersonaIds.length === 0}
          className="w-full py-3.5 px-6 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>記事を分析し、過去の記憶を検索中...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>ペルソナ対談をスタートする</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};

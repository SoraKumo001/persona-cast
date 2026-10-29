import React, { useState } from "react";
import { Persona } from "../../worker/types";
import { Users, Plus, Trash2, Sparkles, Check } from "lucide-react";

interface PersonaManagerProps {
  personas: Persona[];
  onRefresh: () => void;
}

export const PersonaManager: React.FC<PersonaManagerProps> = ({ personas, onRefresh }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [avatar, setAvatar] = useState("🤖");
  const [personality, setPersonality] = useState("");
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emojiList = ["🤖", "💻", "🚀", "🧐", "🎨", "⚖️", "🐱", "☕", "📊", "🎯"];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !personality.trim() || !speakingStyle.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim() || "コメンテーター",
          avatar,
          personality: personality.trim(),
          speakingStyle: speakingStyle.trim(),
        }),
      });

      if (res.ok) {
        setName("");
        setRole("");
        setPersonality("");
        setSpeakingStyle("");
        setIsAdding(false);
        onRefresh();
      }
    } catch (err) {
      console.error("Failed to create persona:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このペルソナを削除しますか？")) return;
    try {
      await fetch(`/api/personas/${id}`, { method: "DELETE" });
      onRefresh();
    } catch (err) {
      console.error("Failed to delete persona:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-indigo-400">
            <Users className="w-4 h-4" />
            <span>AIペルソナ管理</span>
          </div>
          <h3 className="text-lg font-bold text-slate-100">出演ペルソナのカスタマイズ</h3>
          <p className="text-xs text-slate-400 mt-1">
            対談に登場させるキャラクターの性格・価値観・口調を設定できます。
          </p>
        </div>

        <button
          onClick={() => setIsAdding(!isAdding)}
          className="self-start sm:self-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>新しいペルソナを追加</span>
        </button>
      </div>

      {/* 新規追加フォーム */}
      {isAdding && (
        <form onSubmit={handleCreate} className="bg-slate-900/95 border border-indigo-500/40 rounded-2xl p-6 shadow-2xl space-y-4">
          <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            オリジナルペルソナの作成
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">名前</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: サクラ (Sakura)"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">肩書き・立場</label>
              <input
                type="text"
                required
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="例: UI/UXデザイナー / デザイン思考実践者"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">アイコン絵文字</label>
            <div className="flex flex-wrap gap-2">
              {emojiList.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatar(emoji)}
                  className={`text-xl p-2 rounded-lg border transition-all ${
                    avatar === emoji
                      ? "bg-indigo-600/30 border-indigo-500 ring-2 ring-indigo-400"
                      : "bg-slate-950 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              性格・価値観・主張の傾向
            </label>
            <textarea
              required
              rows={3}
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="例: ユーザーの感情や共感を最も大切にする。技術の難しさよりも『使った人がどう感じるか』を追求し、優しく温かみのある視点で語る。"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              口調・一人称・語尾のルール
            </label>
            <textarea
              required
              rows={2}
              value={speakingStyle}
              onChange={(e) => setSpeakingStyle(e.target.value)}
              placeholder="例: 一人称は「わたし」。「〜ですね」「素敵だと思います！」「でも使いにくいと悲しいかも…」といった柔らかく親しみやすい語尾。"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>ペルソナを保存</span>
            </button>
          </div>
        </form>
      )}

      {/* ペルソナ一覧 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {personas.map((p) => {
          const isPreset = ["ken", "yuki", "ren"].includes(p.id);
          return (
            <div
              key={p.id}
              className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm hover:border-slate-700 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl p-2 rounded-xl bg-slate-950 border border-slate-800">
                      {p.avatar}
                    </span>
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm">{p.name}</h4>
                      <p className="text-xs text-slate-400">{p.role}</p>
                    </div>
                  </div>

                  {!isPreset && (
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                      title="ペルソナを削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="space-y-2 mt-4 text-xs">
                  <div>
                    <span className="text-slate-500 font-medium">性格・価値観:</span>
                    <p className="text-slate-300 mt-0.5 line-clamp-3 leading-relaxed">
                      {p.personality}
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-800/60">
                    <span className="text-slate-500 font-medium">口調設定:</span>
                    <p className="text-slate-300 mt-0.5 line-clamp-2 leading-relaxed">
                      {p.speakingStyle}
                    </p>
                  </div>
                </div>
              </div>

              {isPreset && (
                <div className="mt-4 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>システムプリセット</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400">標準</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

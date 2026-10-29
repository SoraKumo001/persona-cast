import React from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/** ページが描画される前にテーマを適用するインラインスクリプト (ちらつき防止) */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){}})();`;

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** ライト/ダークの切り替え。選択はlocalStorageに保存し、未選択ならOSの設定に従う */
export function ThemeToggle() {
  // SSR時はダーク固定で描画し、マウント後に実際のテーマへ同期する
  const [theme, setTheme] = React.useState<Theme>("dark");
  React.useEffect(() => setTheme(currentTheme()), []);

  const toggle = () => {
    const next: Theme = currentTheme() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // 保存できなくても切り替え自体は有効
    }
    setTheme(next);
  };

  const toLight = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={toLight ? "ライトモードに切り替え" : "ダークモードに切り替え"}
      title={toLight ? "ライトモードに切り替え" : "ダークモードに切り替え"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
    >
      {toLight ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

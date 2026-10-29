const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/**
 * テンプレート内の {{変数}} を差し込む。
 * - テンプレートにあるのに渡されていない変数、渡されたのにテンプレートにない変数は例外にする
 *   (綴り違いや渡し忘れを、LLMに送る前に検出するため)
 * - 差し込んだ値の中の {{...}} は再展開しない (記事など外部由来の文字列を安全に扱う)
 * - 取り込みで付く末尾の改行1つ、CRLF、BOMは取り除く
 */
export function renderPrompt(template: string, vars: Record<string, string | number> = {}): string {
  const text = template.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\n$/, "");

  const used = new Set<string>();
  const out = text.replace(PLACEHOLDER, (_, name: string) => {
    if (!(name in vars)) throw new Error(`プロンプトの変数 "${name}" が渡されていません`);
    used.add(name);
    return String(vars[name]);
  });

  for (const name of Object.keys(vars)) {
    if (!used.has(name)) throw new Error(`プロンプトに変数 "${name}" のプレースホルダーがありません`);
  }
  return out;
}

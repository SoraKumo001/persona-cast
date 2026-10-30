/** JSON 文字列を試しにパースする (オブジェクト以外は捨てる) */
export function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

interface JsonScanState {
  escaped: boolean;
  inString: boolean;
  stack: string[];
}

function updateScanState(state: JsonScanState, ch: string): void {
  if (state.inString) {
    if (state.escaped) {
      state.escaped = false;
    } else if (ch === "\\") {
      state.escaped = true;
    } else if (ch === '"') {
      state.inString = false;
    }
    return;
  }
  if (ch === '"') {
    state.inString = true;
  } else if (ch === "{" || ch === "[") {
    state.stack.push(ch);
  } else if (ch === "}" || ch === "]") {
    state.stack.pop();
  }
}

function scanJsonState(snippet: string): JsonScanState {
  const state: JsonScanState = { inString: false, escaped: false, stack: [] };
  for (const ch of snippet) {
    updateScanState(state, ch);
  }
  return state;
}

/**
 * 途中で切れた JSON を、文字列・括弧の対応を見ながら閉じて読める形にする。
 * 値の無いキー (..., "genre": ) は捨て、値の途中なら閉じ引用符だけ補う。
 */
export function closeTruncatedJson(snippet: string): string {
  const { inString, escaped, stack } = scanJsonState(snippet);

  let out = snippet;
  if (escaped) {
    out = out.slice(0, -1); // 末尾の不完全なエスケープを落とす
  }
  if (inString) {
    out += '"';
  }
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/u, ""); // 値の無いキーを落とす
  out = out.replace(/,\s*$/u, ""); // 末尾のカンマを落とす
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return out;
}

/**
 * 応答から最初の JSON オブジェクトを取り出す。閉じ括弧まで揃っていればそのまま、
 * トークン上限で途中から切れていれば補完して読む (truncated: true)
 */
export function extractJsonObject(text: string): { raw: Record<string, unknown>; truncated: boolean } | undefined {
  const start = text.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  const candidate = text.slice(start);
  const end = text.lastIndexOf("}");
  if (end > start) {
    const raw = tryParseObject(candidate.slice(0, end - start + 1));
    if (raw) {
      return { raw, truncated: false };
    }
  }
  // 切れている場合は、区切り (カンマ) まで戻しながら読める範囲を探す
  let snippet = candidate;
  for (let i = 0; i < 8; i++) {
    const raw = tryParseObject(closeTruncatedJson(snippet));
    if (raw) {
      return { raw, truncated: true };
    }
    const cut = snippet.lastIndexOf(",");
    if (cut <= 0) {
      break;
    }
    snippet = snippet.slice(0, cut);
  }
  return undefined;
}

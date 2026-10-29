import { Env } from "../types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

/**
 * OpenCode Go API (OpenAI互換エンドポイント) を呼び出してストリーミング生成
 */
export async function* streamChatCompletion(
  messages: ChatMessage[],
  env: Env,
  sessionId: string,
  modelName?: string
): AsyncGenerator<string, void, unknown> {
  const apiKey = env.OPENCODE_API_KEY;
  const baseUrl = env.OPENCODE_BASE_URL || "https://opencode.ai/inference/go/openai/v1";
  const model = modelName || env.OPENCODE_DEFAULT_MODEL || "deepseek-v4.1-flash";

  // APIキーが未設定の場合は、開発・デモ用のシミュレーション応答を返す
  if (!apiKey || apiKey === "your-opencode-api-key-here") {
    yield* simulateDialogueResponse(messages);
    return;
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      // OpenCode Go 用のセッション指定ヘッダー
      "x-opencode-session": `ses_${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.75,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenCode Go API Error (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error("No response body received from LLM API.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;

      if (trimmed.startsWith("data: ")) {
        const dataStr = trimmed.slice(6);
        if (dataStr === "[DONE]") {
          return;
        }

        try {
          const json = JSON.parse(dataStr);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            yield delta;
          }
        } catch {
          // 不完全なJSON行はスキップ
        }
      }
    }
  }
}

/**
 * 単発完了用（要約や記憶チャンク抽出用）
 */
export async function generateChatCompletion(
  messages: ChatMessage[],
  env: Env,
  sessionId: string,
  modelName?: string
): Promise<string> {
  let full = "";
  for await (const chunk of streamChatCompletion(messages, env, sessionId, modelName)) {
    full += chunk;
  }
  return full;
}

/**
 * APIキー未設定時のローカル動作確認用シミュレーター
 */
async function* simulateDialogueResponse(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
  const lastUserMsg = messages[messages.length - 1]?.content || "";
  const isKen = lastUserMsg.includes("ケン");
  const isYuki = lastUserMsg.includes("ユキ");

  let mockResponse = "";
  if (isKen) {
    mockResponse =
      "ふむ、記事を見たが理屈はわかる。ただ、これを本番環境で運用しようとするとキャッシュの整合性やインフラの課金爆発で詰む未来が見えるな。以前話したCloudflareの記事でもそうだったが、エッジで動かすならステートの持ち方を一番慎重に設計すべきだ。";
  } else if (isYuki) {
    mockResponse =
      "わかります！でもユーザー体験の観点から見たら、これほど即座にレスポンスが返ってくるのは圧倒的な強みですよね。前回のディスカッションでも話しましたが、まずは小さくプロトタイプを出して、実際のユーザーの反応を見ながら改善していけば十分勝機があるはずです！";
  } else {
    mockResponse =
      "興味深い論点ですね。両者の意見を踏まえると、技術的な堅牢性とビジネスのスピード感のバランスが鍵になりそうです。過去の記憶とも照らし合わせると、初期段階でのモニタリング体制を整えておくことが最善手と言えるでしょう。";
  }

  // タイピング感を出すため少しずつチャンク配信
  const parts = mockResponse.match(/.{1,6}/g) || [mockResponse];
  for (const part of parts) {
    yield part;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

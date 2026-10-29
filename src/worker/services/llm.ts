import { streamText, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
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
 * OpenCode Go API を @ai-sdk/openai 経由で呼び出すプロバイダーを作成
 */
function getOpenCodeProvider(env: Env, sessionId: string) {
  const apiKey = env.OPENCODE_API_KEY;
  const baseUrl = env.OPENCODE_BASE_URL || "https://opencode.ai/inference/go/openai/v1";

  return createOpenAI({
    baseURL: baseUrl.replace(/\/+$/, ""),
    apiKey: apiKey || "",
    headers: {
      "x-opencode-session": `ses_${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    },
  });
}

/**
 * @ai-sdk の streamText を使ってリアルタイムストリーミング生成
 */
export async function* streamChatCompletion(
  messages: ChatMessage[],
  env: Env,
  sessionId: string,
  modelName?: string
): AsyncGenerator<string, void, unknown> {
  const apiKey = env.OPENCODE_API_KEY;
  const modelId = modelName || env.OPENCODE_DEFAULT_MODEL || "deepseek-v4.1-flash";

  // APIキーが未設定の場合は、開発・デモ用のシミュレーション応答を返す
  if (!apiKey || apiKey === "your-opencode-api-key-here") {
    yield* simulateDialogueResponse(messages);
    return;
  }

  const provider = getOpenCodeProvider(env, sessionId);
  const model = provider(modelId);

  const result = streamText({
    model,
    messages: messages as any,
    maxTokens: 1200,
    temperature: 0.75,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

/**
 * @ai-sdk の generateText を使って要約・記憶抽出用の一括生成
 */
export async function generateChatCompletion(
  messages: ChatMessage[],
  env: Env,
  sessionId: string,
  modelName?: string
): Promise<string> {
  const apiKey = env.OPENCODE_API_KEY;
  const modelId = modelName || env.OPENCODE_DEFAULT_MODEL || "deepseek-v4.1-flash";

  if (!apiKey || apiKey === "your-opencode-api-key-here") {
    let full = "";
    for await (const chunk of simulateDialogueResponse(messages)) {
      full += chunk;
    }
    return full;
  }

  const provider = getOpenCodeProvider(env, sessionId);
  const model = provider(modelId);

  const { text } = await generateText({
    model,
    messages: messages as any,
    maxTokens: 1000,
    temperature: 0.7,
  });

  return text;
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

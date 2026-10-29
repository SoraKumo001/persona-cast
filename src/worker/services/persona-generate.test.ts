import { describe, expect, test } from "bun:test";
import { buildPersonaMessages, parsePersonaDraft } from "./persona-generate";

const valid = {
  name: "ミキ (Miki)",
  role: "皮肉屋の編集者",
  avatar: "📝",
  themeColor: "#E11D48",
  personality: "言葉の正確さにうるさい。",
  speakingStyle: "一人称は「私」。「それ、本当に？」が口癖。",
};

describe("parsePersonaDraft", () => {
  test("前置きやコードブロック付きでもJSONを取り出し、色は小文字に正規化する", () => {
    const text = "どうぞ\n```json\n" + JSON.stringify(valid) + "\n```";
    expect(parsePersonaDraft(text)).toEqual({ ...valid, themeColor: "#e11d48" });
  });

  test("必須項目(名前・性格・口調)が欠けていれば null", () => {
    expect(parsePersonaDraft(JSON.stringify({ ...valid, name: "" }))).toBeNull();
    expect(parsePersonaDraft(JSON.stringify({ ...valid, personality: undefined }))).toBeNull();
    expect(parsePersonaDraft(JSON.stringify({ ...valid, speakingStyle: " " }))).toBeNull();
  });

  test("JSONでない/壊れている出力は null", () => {
    expect(parsePersonaDraft("作れません")).toBeNull();
    expect(parsePersonaDraft('{"name": "x"')).toBeNull();
  });

  test("不正な色はフォールバック色、肩書き・絵文字の欠落は既定値にする", () => {
    const d = parsePersonaDraft(JSON.stringify({ ...valid, themeColor: "red", role: "", avatar: "" }), "#112233");
    expect(d).toMatchObject({ themeColor: "#112233", role: "コメンテーター", avatar: "🎙️" });
  });

  test("長すぎる項目は上限で切る", () => {
    const d = parsePersonaDraft(JSON.stringify({ ...valid, name: "あ".repeat(100), avatar: "x".repeat(50) }));
    expect(d!.name).toHaveLength(40);
    expect(d!.avatar).toHaveLength(8);
  });
});

describe("buildPersonaMessages", () => {
  test("新規生成では指示と既存出演者を含める", () => {
    const [system, user] = buildPersonaMessages("皮肉屋の編集者", null, [{ name: "ケン", role: "エンジニア", themeColor: "#2563eb" }]);
    expect(system.content).toContain("ケン (エンジニア) 色: #2563eb");
    expect(user.content).toContain("皮肉屋の編集者");
    expect(user.content).not.toContain("現在:");
  });

  test("修正では現在の内容と指示の両方を含める", () => {
    const [, user] = buildPersonaMessages("もっと辛口に", valid, []);
    expect(user.content).toContain("現在:");
    expect(user.content).toContain("ミキ (Miki)");
    expect(user.content).toContain("もっと辛口に");
  });
});

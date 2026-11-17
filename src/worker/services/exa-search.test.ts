import { describe, expect, test } from "bun:test";
import { ExaSearchError, parseExaSearchResults, searchExaLite } from "./exa-search";

describe("parseExaSearchResults", () => {
  test("results から URL を順に抜き、重複を除く", () => {
    const payload = {
      results: [
        { title: "A", url: "https://a.example/1" },
        { title: "B", url: "https://b.example/2#frag" },
        { title: "A again", url: "https://a.example/1" },
        { title: "C", url: "https://c.example/3" },
      ],
    };
    expect(parseExaSearchResults(payload, 10)).toEqual([
      "https://a.example/1",
      "https://b.example/2",
      "https://c.example/3",
    ]);
  });

  test("limit で打ち切る", () => {
    const payload = {
      results: [{ url: "https://a.example/1" }, { url: "https://b.example/2" }],
    };
    expect(parseExaSearchResults(payload, 1)).toEqual(["https://a.example/1"]);
  });

  test("プライベート URL や壊れたペイロードは捨てる", () => {
    expect(parseExaSearchResults(null)).toEqual([]);
    expect(
      parseExaSearchResults({
        results: [{ url: "http://127.0.0.1/x" }, { url: "https://ok.example/y" }, { url: 1 }],
      })
    ).toEqual(["https://ok.example/y"]);
  });
});

describe("searchExaLite", () => {
  test("API キー未設定は例外", async () => {
    await expect(searchExaLite("React RSC", "")).rejects.toBeInstanceOf(ExaSearchError);
  });

  test("空クエリは空配列", async () => {
    expect(await searchExaLite("  ", "key")).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { parseDuckDuckGoResults, unwrapDdgHref } from "./duckduckgo";

describe("unwrapDdgHref", () => {
  test("uddg パラメータから実URLを取り出す", () => {
    const href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Freference%2Frsc&rut=abc";
    expect(unwrapDdgHref(href)).toBe("https://react.dev/reference/rsc");
  });

  test("duckduckgo 自身のリンクは捨てる", () => {
    expect(unwrapDdgHref("https://duckduckgo.com/about")).toBeNull();
  });
});

describe("parseDuckDuckGoResults", () => {
  test("result__a のリンクを順番に抜き、重複を除く", () => {
    const html = `
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F1">A</a>
      <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.example%2F2" class="result__a">B</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F1">A again</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fc.example%2F3">C</a>
    `;
    expect(parseDuckDuckGoResults(html, 10)).toEqual([
      "https://a.example/1",
      "https://b.example/2",
      "https://c.example/3",
    ]);
  });

  test("件数上限を守る", () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F1">1</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.example%2F2">2</a>
    `;
    expect(parseDuckDuckGoResults(html, 1)).toEqual(["https://a.example/1"]);
  });

  test("プライベート宛ては捨てる", () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=http%3A%2F%2F127.0.0.1%2Fx">local</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fok.example%2Fy">ok</a>
    `;
    expect(parseDuckDuckGoResults(html)).toEqual(["https://ok.example/y"]);
  });
});

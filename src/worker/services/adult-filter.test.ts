import { describe, expect, test } from "bun:test";
import { adultScore, hasAdultRating, isAdultHost, looksAdult } from "./adult-filter";
import { parseAnalysis } from "./analyze";

describe("isAdultHost", () => {
  test("アダルト専用TLDと代表的なサイト (サブドメイン含む)", () => {
    expect(isAdultHost("example.xxx")).toBe(true);
    expect(isAdultHost("foo.adult")).toBe(true);
    expect(isAdultHost("www.pornhub.com")).toBe(true);
    expect(isAdultHost("jp.xvideos.com")).toBe(true);
    expect(isAdultHost("PornHub.com.")).toBe(true);
  });
  test("通常のサイトは対象外 (部分一致しない)", () => {
    expect(isAdultHost("example.com")).toBe(false);
    expect(isAdultHost("en.wikipedia.org")).toBe(false);
    expect(isAdultHost("notpornhub.com")).toBe(false);
    expect(isAdultHost("sexy-news.example.com")).toBe(false);
  });
});

describe("hasAdultRating", () => {
  test("rating メタと RTA ラベル", () => {
    expect(hasAdultRating(new Map([["rating", "adult"]]))).toBe(true);
    expect(hasAdultRating(new Map([["rating", "Mature"]]))).toBe(true);
    expect(hasAdultRating(new Map([["rating", "RTA-5042-1996-1400-1577-RTA"]]))).toBe(true);
  });
  test("一般向けや未指定は対象外", () => {
    expect(hasAdultRating(new Map([["rating", "general"]]))).toBe(false);
    expect(hasAdultRating(new Map([["rating", "safe for kids"]]))).toBe(false);
    expect(hasAdultRating(new Map())).toBe(false);
  });
});

describe("looksAdult", () => {
  test("強い語が複数あるときだけ真", () => {
    expect(adultScore("無修正のエロ動画とアダルト動画、porn")).toBe(4);
    expect(looksAdult("無修正のエロ動画とアダルト動画、porn")).toBe(true);
  });
  test("医療・報道の記事に出やすい語だけなら偽", () => {
    expect(looksAdult("性感染症の予防と性教育について。性交によるリスクを解説する。")).toBe(false);
    expect(looksAdult("ポルノ規制に関する法案が国会に提出された。")).toBe(false);
  });
});

describe("parseAnalysis の adult", () => {
  const candidates = [{ id: "ken", name: "k", role: "r", personality: "p" }];
  test("真偽値だけを採用する", () => {
    expect(parseAnalysis('{"adult":true}', candidates).adult).toBe(true);
    expect(parseAnalysis('{"adult":false}', candidates).adult).toBe(false);
    expect(parseAnalysis('{"adult":"true"}', candidates).adult).toBeUndefined();
    expect(parseAnalysis('{"summary":"s"}', candidates).adult).toBeUndefined();
  });
});

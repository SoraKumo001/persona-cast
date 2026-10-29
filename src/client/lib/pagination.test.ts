import { describe, expect, test } from "bun:test";
import { pageItems } from "./pagination";

describe("pageItems", () => {
  test("少ないページはすべて並べる", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 4)).toEqual([1, 2, 3, 4]);
  });
  test("間は「…」にし、1つだけ抜ける所は数字にする", () => {
    expect(pageItems(1, 10)).toEqual([1, 2, "…", 10]);
    expect(pageItems(5, 10)).toEqual([1, "…", 4, 5, 6, "…", 10]);
    expect(pageItems(4, 10)).toEqual([1, 2, 3, 4, 5, "…", 10]);
    expect(pageItems(10, 10)).toEqual([1, "…", 9, 10]);
  });
});

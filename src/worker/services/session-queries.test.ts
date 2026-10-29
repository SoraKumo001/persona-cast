import { describe, expect, test } from "bun:test";
import { escapeLike, SEARCH_MAX_CHARS, searchCondition } from "./session-queries";

describe("escapeLike", () => {
  test("LIKE のワイルドカードと区切り文字をエスケープする", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("searchCondition", () => {
  test("空・空白だけなら絞り込まない", () => {
    expect(searchCondition(undefined)).toBeNull();
    expect(searchCondition("   　 ")).toBeNull();
  });

  test("空白区切りの語を、すべて含む条件 (AND) にする", () => {
    const cond = searchCondition("AI  規制");
    expect(cond?.sql.split(" AND ")).toHaveLength(2);
    expect(cond?.binds).toEqual(["%AI%", "%AI%", "%規制%", "%規制%"]);
  });

  test("語のワイルドカードは文字として扱う", () => {
    expect(searchCondition("100%")?.binds[0]).toBe("%100\\%%");
  });

  test("語は5つまで、全体は上限の文字数まで", () => {
    expect(searchCondition("a b c d e f g")?.binds).toHaveLength(10);
    expect(searchCondition("x".repeat(SEARCH_MAX_CHARS + 20))?.binds[0]).toBe(`%${"x".repeat(SEARCH_MAX_CHARS)}%`);
  });
});

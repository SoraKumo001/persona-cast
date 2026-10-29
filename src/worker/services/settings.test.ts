import { describe, expect, test } from "bun:test";
import { jstDayStartIso } from "./settings";

describe("jstDayStartIso", () => {
  test("日本時間の0時 (UTC 15:00) に切り替わる", () => {
    expect(jstDayStartIso(new Date("2026-10-29T14:59:00Z"))).toBe("2026-10-28T15:00:00.000Z");
    expect(jstDayStartIso(new Date("2026-10-29T15:00:00Z"))).toBe("2026-10-29T15:00:00.000Z");
    expect(jstDayStartIso(new Date("2026-10-29T03:00:00Z"))).toBe("2026-10-28T15:00:00.000Z");
  });
});

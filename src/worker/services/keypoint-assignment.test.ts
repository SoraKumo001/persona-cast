import { describe, expect, test } from "bun:test";
import type { Env } from "../types";
import { assignKeyPoints, KEYPOINT_ASSIGN_OFF } from "./keypoint-assignment";

const personas = [{ id: "ken" }, { id: "yuki" }, { id: "ren" }];
const env = {} as Env;

describe("assignKeyPoints", () => {
  test("3人3論点は personas の順に1つずつ持つ", () => {
    const assignments = assignKeyPoints(personas, ["論点A", "論点B", "論点C"], env);

    expect(assignments.get("ken")).toEqual(["論点A"]);
    expect(assignments.get("yuki")).toEqual(["論点B"]);
    expect(assignments.get("ren")).toEqual(["論点C"]);
  });

  test("3:3 以外は剰余で配る (2人に3論点なら先頭が2つ)", () => {
    const assignments = assignKeyPoints(personas.slice(0, 2), ["論点A", "論点B", "論点C"], env);

    expect(assignments.get("ken")).toEqual(["論点A", "論点C"]);
    expect(assignments.get("yuki")).toEqual(["論点B"]);
    expect(assignments.has("ren")).toBe(false);
  });

  test("論点は最大3つまで (4つ目以降は割り当てない)", () => {
    const assignments = assignKeyPoints(personas, ["A", "B", "C", "D"], env);
    const all = [...assignments.values()].flat();

    expect(all).toEqual(["A", "B", "C"]);
  });

  test("改行や「・」区切りの文字列も論点として扱う", () => {
    const assignments = assignKeyPoints(personas.slice(0, 1), "・論点A\n・論点B", env);

    expect(assignments.get("ken")).toEqual(["論点A", "論点B"]);
  });

  test("KEYPOINT_ASSIGN=off なら誰にも割り当てない", () => {
    const assignments = assignKeyPoints(personas, ["論点A", "論点B"], {
      KEYPOINT_ASSIGN: KEYPOINT_ASSIGN_OFF,
    } as Env);

    expect(assignments.size).toBe(0);
  });

  test("論点が空、またはペルソナが空なら割り当てない", () => {
    expect(assignKeyPoints(personas, [], env).size).toBe(0);
    expect(assignKeyPoints(personas, undefined, env).size).toBe(0);
    expect(assignKeyPoints([], ["論点A"], env).size).toBe(0);
  });
});

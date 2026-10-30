import { describe, expect, test } from "bun:test";
import { DEFAULT_STREAM_TEMPERATURE } from "./llm";
import { PERSONA_TEMPERATURE_PILOT, personaTemperature } from "./persona-temperature";

describe("personaTemperature", () => {
  test("パイロット有効時はペルソナごとの値を使う", () => {
    expect(personaTemperature("yuki", {})).toBe(PERSONA_TEMPERATURE_PILOT.yuki as number);
    expect(personaTemperature("ken", {})).toBe(PERSONA_TEMPERATURE_PILOT.ken as number);
    expect(personaTemperature("ren", {})).toBe(PERSONA_TEMPERATURE_PILOT.ren as number);
  });

  test("マップに無いペルソナは既定 0.75", () => {
    expect(personaTemperature("unknown-persona", {})).toBe(DEFAULT_STREAM_TEMPERATURE);
  });

  test("PERSONA_TEMP_PILOT=off なら一律 0.75 に戻る", () => {
    for (const id of ["yuki", "ken", "ren", "unknown-persona"]) {
      expect(personaTemperature(id, { PERSONA_TEMP_PILOT: "off" })).toBe(DEFAULT_STREAM_TEMPERATURE);
    }
  });

  test("off 以外の値ではパイロットを止めない", () => {
    expect(personaTemperature("ren", { PERSONA_TEMP_PILOT: "on" })).toBe(PERSONA_TEMPERATURE_PILOT.ren as number);
    expect(personaTemperature("ren", { PERSONA_TEMP_PILOT: "" })).toBe(PERSONA_TEMPERATURE_PILOT.ren as number);
  });
});

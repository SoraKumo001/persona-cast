/**
 * 第一声と締めを担当させるペルソナ。話を前向きに始めて終えるため、出演していれば先頭に置く。
 * 分析プロンプトで先頭の人を指示しても実 LLM は従わなかった (12回中0回) ので、ここで決定的に並べる。
 * 一覧に無いペルソナだけの対談は、分析が返した順のまま。
 */
const OPENER_PERSONA_IDS: readonly string[] = ["yuki"];

export function withOpenerFirst<T extends { id: string }>(personas: readonly T[]): T[] {
  const openerIndex = personas.findIndex((p) => OPENER_PERSONA_IDS.includes(p.id));
  if (openerIndex <= 0) {
    return [...personas];
  }
  return [personas[openerIndex], ...personas.slice(0, openerIndex), ...personas.slice(openerIndex + 1)];
}

/**
 * そのターンの話者。基本は順番に回し、最終ターンだけ第一声の人に戻す。
 * 第一声の人が自分の問いを受けて締めると番組が閉じ、批判役で終わることも減る。
 * 直前が第一声の人なら同じ人の連続発言になるので、順番どおりにする。
 */
export function speakerIndexForTurn(turn: number, totalTurns: number, speakerCount: number): number {
  const isClosing = turn === totalTurns - 1;
  if (isClosing && turn > 0 && (turn - 1) % speakerCount !== 0) {
    return 0;
  }
  return turn % speakerCount;
}

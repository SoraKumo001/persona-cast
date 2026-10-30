import { Metric, Panel } from "./AnalyticsUi";
import { money, nf } from "./format";
import type { Cost, Report } from "./types";

export function LlmPanel({ llm, cost }: { llm: Report["llm"]; cost: Cost | null }) {
  return (
    <Panel title="LLM の使用量と費用の目安">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Metric label="入力トークン" value={nf.format(Math.round(llm.inputTokens))} />
        <Metric label="出力トークン" value={nf.format(Math.round(llm.outputTokens))} />
        <Metric label="新しい対談" value={`${nf.format(llm.dialogues)} 件`} />
        <Metric
          label="対談1件あたり"
          value={llm.tokensPerDialogue === null ? "—" : `${nf.format(llm.tokensPerDialogue)} トークン`}
        />
        {cost ? (
          <>
            <Metric label="期間の費用" value={money(cost.total, cost.currency)} />
            <Metric label="対談1件あたり" value={money(cost.perDialogue, cost.currency)} />
            <Metric label="1日の上限まで作られた場合 (1日)" value={money(cost.atDailyLimit, cost.currency)} />
          </>
        ) : null}
      </dl>
      <p className="mt-3 text-xs text-zinc-500">
        {cost
          ? "費用は、記録したトークン数に設定した単価を掛けた試算です。請求額とは一致しないことがあります。"
          : "単価を設定すると、費用の試算も表示します (LLM_PRICE_INPUT / LLM_PRICE_OUTPUT。100万トークンあたり)。"}
      </p>
    </Panel>
  );
}

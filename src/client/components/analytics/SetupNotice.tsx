export function SetupNotice({ hasDataset }: { hasDataset: boolean }) {
  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 text-sm text-zinc-300">
      <h2 className="font-semibold text-zinc-100">集計を表示するための設定が未完了です</h2>
      <p>
        アクセスの記録は Workers Analytics Engine に保存されます
        {hasDataset ? "" : " (このWorkerにはデータセットのバインディングがありません)"}。
        画面に出すには、次の2つのシークレットを設定してください。
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Cloudflare ダッシュボードで、権限が「アカウント &gt; Account Analytics &gt; 読み取り」だけの API
          トークンを作る
        </li>
        <li>
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">CF_ACCOUNT_ID</code> (アカウントID) と{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">CF_API_TOKEN</code> を{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">cf workers secrets update</code> で登録する
        </li>
      </ol>
      <p className="text-xs text-zinc-500">
        ローカル開発 (cf dev) では、記録先のデータセットに問い合わせできないため、集計は表示できません。
      </p>
    </div>
  );
}

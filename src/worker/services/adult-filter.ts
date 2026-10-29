/**
 * 18禁コンテンツの判定。対談の対象にしないための多層の確認で、ここで扱うのは LLM を使わない部分:
 * 1. ドメイン (アダルト専用のTLD・代表的なアダルトサイト)
 * 2. ページ自身の宣言 (<meta name="rating" content="adult"> と RTA ラベル)
 * 3. キーワード (強い語が複数あるときだけ。LLM が使えないときの代替・補強)
 * 記事の内容そのものの判定は、記事分析の LLM 呼び出し (analyze.ts) が `adult` で返す。
 */

export const ADULT_MESSAGE = "18歳未満の閲覧に適さない内容と判断したため、対談できません。";

// アダルト専用のトップレベルドメイン
const ADULT_TLDS = ["xxx", "adult", "porn", "sex", "sexy"];

// 代表的なアダルトサイト (サブドメインも対象)。網羅はできないので、他の判定と併用する
const ADULT_DOMAINS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "spankbang.com",
  "chaturbate.com",
  "stripchat.com",
  "onlyfans.com",
  "fanza.com",
  "dlsite.com",
  "e-hentai.org",
  "nhentai.net",
  "rule34.xxx",
];

export function isAdultHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const tld = host.split(".").pop() ?? "";
  if (ADULT_TLDS.includes(tld)) return true;
  return ADULT_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** ページが自分で成人向けと宣言しているか (rating メタ / RTA ラベル) */
export function hasAdultRating(meta: Map<string, string>): boolean {
  const rating = (meta.get("rating") ?? "").toLowerCase();
  return /\b(adult|mature|18\+)\b/.test(rating) || rating.includes("rta-5042-1996-1400-1577-rta");
}

// 誤検出を避けるため、医療・報道・性教育の記事にも出やすい語 (「性交」「セックス」など) は入れない
const STRONG_TERMS = [
  "ポルノ",
  "無修正",
  "エロ動画",
  "エロ画像",
  "エロ漫画",
  "アダルト動画",
  "アダルトビデオ",
  "av女優",
  "オナニー",
  "ヌード画像",
  "ハメ撮り",
  "中出し",
  "fc2アダルト",
  "porn",
  "xxx video",
  "hardcore",
  "nsfw",
  "hentai",
  "onlyfans",
  "camgirl",
  "escort service",
];

/** 強い語が何種類含まれるか */
export function adultScore(text: string): number {
  const lower = text.toLowerCase();
  return STRONG_TERMS.filter((t) => lower.includes(t)).length;
}

/** 強い語が複数あるときだけ成人向けとみなす */
export function looksAdult(text: string): boolean {
  return adultScore(text) >= 4;
}

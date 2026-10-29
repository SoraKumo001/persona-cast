/** ページ番号の並び。常に先頭と末尾、現在地の前後を出し、間は「…」にする */
export function pageItems(current: number, total: number, around = 1): (number | "…")[] {
  const pages = new Set<number>([1, total]);
  for (let p = current - around; p <= current + around; p++) if (p >= 1 && p <= total) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);

  const items: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev === 2) items.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) items.push("…");
    items.push(p);
  });
  return items;
}

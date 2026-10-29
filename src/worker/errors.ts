/** catch した値 (unknown) からメッセージを取り出す */
export function errorMessage(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return typeof err === "string" && err ? err : fallback;
}

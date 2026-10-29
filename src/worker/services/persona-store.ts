import type { PersonaRow } from "../db-types";
import type { Persona } from "../types";

export const PERSONA_COLUMNS =
  "id, name, role, avatar, avatar_type as avatarType, avatar_key as avatarKey, theme_color as themeColor, personality, speaking_style as speakingStyle, created_at as createdAt, updated_at as updatedAt, archived_at as archivedAt";

/** DB行から公開用の Persona に変換する (avatarKey は内部情報なので返さず、配信URLに変える) */
export function toPersona(row: PersonaRow): Persona {
  const { avatarKey, ...rest } = row;
  const isImage = rest.avatarType === "image" && !!avatarKey;
  return {
    ...rest,
    avatarType: isImage ? "image" : "emoji",
    // キーに内容ハッシュを含むため、差し替え時はURLが変わり immutable キャッシュできる
    avatarUrl: isImage
      ? `/api/personas/${rest.id}/avatar?v=${encodeURIComponent(avatarKey.split("/").pop() ?? "")}`
      : null,
  };
}

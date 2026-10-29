import React from "react";

interface PersonaAvatarProps {
  active?: boolean;
  avatar?: string;
  avatarUrl?: string | null;
  name: string;
  size?: number;
  themeColor?: string;
}

/** 画像アバター → 絵文字 → イニシャル の順にフォールバックする丸型アバター */
export function PersonaAvatar({
  name,
  avatar,
  avatarUrl,
  themeColor = "#6366f1",
  size = 40,
  active,
}: PersonaAvatarProps) {
  const [broken, setBroken] = React.useState(false);
  const imageSrc = broken ? null : avatarUrl;

  const fallback = avatar ? (
    <span aria-hidden>{avatar}</span>
  ) : (
    <span className="font-semibold" style={{ color: themeColor, fontSize: size * 0.4 }}>
      {name.slice(0, 1)}
    </span>
  );

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full transition-shadow select-none"
      style={{
        width: size,
        height: size,
        background: `${themeColor}33`,
        boxShadow: active
          ? `0 0 0 2px var(--color-zinc-950), 0 0 0 4px ${themeColor}`
          : `inset 0 0 0 1.5px ${themeColor}66`,
        fontSize: size * 0.5,
      }}
      title={name}
    >
      {imageSrc ? (
        <img
          alt={name}
          className="h-full w-full object-cover"
          height={size}
          onError={() => setBroken(true)}
          src={imageSrc}
          width={size}
        />
      ) : (
        fallback
      )}
    </span>
  );
}

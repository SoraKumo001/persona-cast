import React from "react";

interface PersonaAvatarProps {
  name: string;
  avatar?: string;
  avatarUrl?: string | null;
  themeColor?: string;
  size?: number;
  active?: boolean;
}

/** 画像アバター → 絵文字 → イニシャル の順にフォールバックする丸型アバター */
export function PersonaAvatar({ name, avatar, avatarUrl, themeColor = "#6366f1", size = 40, active }: PersonaAvatarProps) {
  const [broken, setBroken] = React.useState(false);
  const showImage = !!avatarUrl && !broken;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full select-none transition-shadow"
      style={{
        width: size,
        height: size,
        background: `${themeColor}33`,
        boxShadow: active ? `0 0 0 2px #09090b, 0 0 0 4px ${themeColor}` : `inset 0 0 0 1.5px ${themeColor}66`,
        fontSize: size * 0.5,
      }}
      title={name}
    >
      {showImage ? (
        <img
          src={avatarUrl!}
          alt={name}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : avatar ? (
        <span aria-hidden>{avatar}</span>
      ) : (
        <span className="font-semibold" style={{ color: themeColor, fontSize: size * 0.4 }}>
          {name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

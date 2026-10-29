import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Env } from "../types";

type AccessEnv = { Bindings: Env; Variables: { adminEmail: string } };

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, jwks);
  }
  return jwks;
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Cloudflare Access が付与する JWT (Cf-Access-Jwt-Assertion) を検証する。
 * Access のポリシーがエッジで先に効くが、Worker 側でも署名・aud・iss を確認する (多層防御)。
 * 設定が欠けている場合は常に拒否する (fail-closed)。
 */
export const requireAccess = createMiddleware<AccessEnv>(async (c, next) => {
  if (c.env.ACCESS_DISABLED === "true" && isLocalHost(new URL(c.req.url).hostname)) {
    c.set("adminEmail", "dev@localhost");
    return next();
  }

  const teamDomain = c.env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const audience = c.env.ACCESS_AUD;
  if (!teamDomain || !audience) {
    return c.json({ error: "管理者認証 (Cloudflare Access) が未設定です" }, 503);
  }

  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) {
    return c.json({ error: "認証が必要です" }, 401);
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience,
    });
    c.set("adminEmail", typeof payload.email === "string" ? payload.email : String(payload.sub ?? ""));
  } catch {
    return c.json({ error: "認証に失敗しました" }, 403);
  }

  return next();
});

export const JWT_COOKIE = "bb_at";
export const REFRESH_COOKIE = "bb_rt";
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 min
/// Parity with legacy Django sessions: 30-day sliding.
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface AccessTokenClaims {
  sub: string;
  email: string;
  activeOrgId?: string | null;
}

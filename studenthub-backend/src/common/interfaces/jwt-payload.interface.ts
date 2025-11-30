export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string; // userId
  tokenId: string; // уникальный ID refresh token
  iat?: number;
  exp?: number;
}


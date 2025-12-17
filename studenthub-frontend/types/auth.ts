export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  role: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
  twoFactorCode?: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface TwoFactorResponse {
  requiresTwoFactor: boolean;
  temporaryToken: string;
  userId: string;
}

export interface VerifyEmailData {
  email: string;
  code: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}



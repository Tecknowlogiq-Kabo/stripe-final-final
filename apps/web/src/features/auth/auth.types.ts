export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

export interface AuthInput {
  email: string;
  password: string;
}

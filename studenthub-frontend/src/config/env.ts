export const ENV = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  apiTimeoutMs: Number(process.env.NEXT_PUBLIC_API_TIMEOUT ?? "10000"),
};

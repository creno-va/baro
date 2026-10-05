/// <reference path="../.astro/types.d.ts" />
/// <reference path="../worker-configuration.d.ts" />
/// <reference types="astro/client" />

interface Env {
  PUBLIC_BETA_ENABLED: string;
  RELEASE_SHA: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  NAVER_CLIENT_ID: string;
  NAVER_CLIENT_SECRET: string;
  KAKAO_CLIENT_ID: string;
  KAKAO_CLIENT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  CASE_DATA_KEY_V1: string;
  LAW_API_OC: string;
  AI_GATEWAY_ID: string;
}

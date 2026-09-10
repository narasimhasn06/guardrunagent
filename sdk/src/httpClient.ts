import type { GuardrunAgentConfig } from "./config";

async function request(
  config: GuardrunAgentConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${config.endpoint}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      // Matches backend/app/auth.py's verify_api_key header name choice.
      "X-API-Key": config.apiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function postJson(config: GuardrunAgentConfig, path: string, body: unknown): Promise<Response> {
  return request(config, "POST", path, body);
}

export function getJson(config: GuardrunAgentConfig, path: string): Promise<Response> {
  return request(config, "GET", path);
}

import { authedFetch } from "@/api/utils";

export interface MailboConfigResponse {
  enabled: boolean;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
}

export function fetchMailboConfig(siteId: number) {
  return authedFetch<MailboConfigResponse>(`/mailbo/config/${siteId}`);
}

export function updateMailboConfig(
  siteId: number,
  body: { apiKey?: string; enabled: boolean; baseUrl?: string }
) {
  return authedFetch<{ success: boolean }>(`/mailbo/config/${siteId}`, undefined, {
    method: "PUT",
    data: body,
  });
}

export function testMailboConfig(siteId: number) {
  return authedFetch<{ ok: boolean; error?: string }>(`/mailbo/config/${siteId}/test`, undefined, {
    method: "POST",
  });
}

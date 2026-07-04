import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getUserHasAdminAccessToSite } from "../../lib/auth-utils.js";
import { getConfig, saveConfig } from "./config.js";
import { testConnection } from "./mailboClient.js";

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 6) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-3)}`;
}

async function getMailboConfig(req: FastifyRequest<{ Params: { siteId: string } }>, reply: FastifyReply) {
  const siteId = Number(req.params.siteId);
  if (!Number.isInteger(siteId) || siteId <= 0) return reply.status(400).send({ error: "Invalid site ID" });
  if (!(await getUserHasAdminAccessToSite(req, siteId))) return reply.status(403).send({ error: "Forbidden" });

  const config = await getConfig(siteId);
  return reply.send({
    enabled: config?.enabled ?? false,
    baseUrl: config?.baseUrl ?? "https://mailbo.io/api/v1",
    hasApiKey: !!config?.apiKey,
    apiKeyMasked: config?.apiKey ? maskKey(config.apiKey) : "",
  });
}

async function updateMailboConfig(
  req: FastifyRequest<{ Params: { siteId: string }; Body: { apiKey?: string; enabled?: boolean; baseUrl?: string } }>,
  reply: FastifyReply
) {
  const siteId = Number(req.params.siteId);
  if (!Number.isInteger(siteId) || siteId <= 0) return reply.status(400).send({ error: "Invalid site ID" });
  if (!(await getUserHasAdminAccessToSite(req, siteId))) return reply.status(403).send({ error: "Forbidden" });

  const { apiKey, enabled, baseUrl } = req.body || {};
  // apiKey undefined = leave unchanged; empty string is a valid "clear".
  await saveConfig(siteId, {
    apiKey: apiKey === undefined ? undefined : apiKey.trim(),
    enabled: !!enabled,
    baseUrl: baseUrl?.trim() || undefined,
  });
  return reply.send({ success: true });
}

async function testMailboConfig(req: FastifyRequest<{ Params: { siteId: string } }>, reply: FastifyReply) {
  const siteId = Number(req.params.siteId);
  if (!(await getUserHasAdminAccessToSite(req, siteId))) return reply.status(403).send({ error: "Forbidden" });
  const config = await getConfig(siteId);
  if (!config?.apiKey) return reply.send({ ok: false, error: "No API key saved" });
  const result = await testConnection(config.baseUrl, config.apiKey);
  return reply.send(result);
}

export default async function mailboRoutes(fastify: FastifyInstance) {
  fastify.get("/mailbo/config/:siteId", getMailboConfig);
  fastify.put("/mailbo/config/:siteId", updateMailboConfig);
  fastify.post("/mailbo/config/:siteId/test", testMailboConfig);
}

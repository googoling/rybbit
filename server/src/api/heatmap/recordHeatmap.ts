import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { logger } from "../../lib/logger/logger.js";
import { siteConfig } from "../../lib/siteConfig.js";
import { decideSiteExclusion } from "../../services/sites/siteExclusionDecision.js";
import { isBotUA } from "../../services/tracker/botBlocking/uaBots/index.js";
import { sessionsService } from "../../services/sessions/sessionsService.js";
import { heatmapQueue } from "../../services/tracker/heatmapQueue.js";
import { usageService } from "../../services/usageService.js";
import { RecordHeatmapRequest } from "../../types/heatmap.js";
import { getIpAddress } from "../../utils.js";

// Cap per request to bound memory/insert cost; clients batch in small flushes.
const MAX_EVENTS_PER_REQUEST = 200;

const recordHeatmapSchema = z.object({
  userId: z.string(),
  metadata: z.object({
    hostname: z.string(),
    language: z.string().optional(),
  }),
  events: z
    .array(
      z.object({
        type: z.enum(["click", "scroll", "rage", "dead", "move", "error"]),
        pathname: z.string().max(2048),
        x_percent: z.number().min(0).max(100),
        y_absolute: z.number().min(0),
        viewport_width: z.number().int().min(0).max(65535),
        viewport_height: z.number().int().min(0).max(65535),
        page_width: z.number().int().min(0).max(65535),
        page_height: z.number().int().min(0),
        scroll_depth: z.number().int().min(0).max(100),
        element_selector: z.string().max(1024).optional(),
        element_text: z.string().max(100).optional(),
        timestamp: z.number(),
      })
    )
    .max(MAX_EVENTS_PER_REQUEST),
});

export async function recordHeatmap(
  request: FastifyRequest<{
    Params: { siteId: string };
    Body: RecordHeatmapRequest;
  }>,
  reply: FastifyReply
) {
  try {
    const siteConfiguration = await siteConfig.getConfig(request.params.siteId);

    if (!siteConfiguration?.enableHeatmaps) {
      return reply.status(200).send({ success: true, message: "Heatmaps not enabled" });
    }

    const siteId = siteConfiguration.siteId;

    if (usageService.isSiteOverLimit(siteId)) {
      logger.info(`[Heatmap] Skipping event for site ${siteId} - over monthly limit`);
      return reply.status(200).send({ success: true, message: "Site over monthly limit, event not tracked" });
    }

    const body = recordHeatmapSchema.parse(request.body) as RecordHeatmapRequest;

    const userAgent = request.headers["user-agent"] || "";
    if (siteConfiguration.blockBots && isBotUA(userAgent)) {
      return reply.status(200).send({ success: true, message: "Heatmap not recorded - bot detected" });
    }

    const requestIP = getIpAddress(request);

    const exclusionDecision = await decideSiteExclusion(siteConfiguration, {
      ipAddress: requestIP,
      hostname: body.metadata.hostname,
      userAgent,
    });

    if (exclusionDecision.excluded) {
      return reply
        .status(200)
        .send({ success: true, message: `Heatmap not recorded - ${exclusionDecision.label} excluded` });
    }

    const identifiedUserId = body.userId ? body.userId.trim() : "";
    const { sessionId } = await sessionsService.updateSession({ userId: body.userId, siteId });

    for (const event of body.events) {
      await heatmapQueue.add({
        ...event,
        siteId,
        sessionId,
        userId: body.userId,
        identifiedUserId,
        hostname: body.metadata.hostname,
        userAgent,
        ipAddress: requestIP,
        storeIp: siteConfiguration.trackIp,
      });
    }

    return reply.send({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: error.errors });
    }
    logger.error(error as Error, "Error recording heatmap");
    return reply.status(500).send({ error });
  }
}

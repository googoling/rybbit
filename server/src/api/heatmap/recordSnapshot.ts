import { FastifyReply, FastifyRequest } from "fastify";
import { UAParser as userAgentParser } from "ua-parser-js";
import { z } from "zod";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { logger } from "../../lib/logger/logger.js";
import { siteConfig } from "../../lib/siteConfig.js";
import { getDeviceType } from "../../utils.js";
import { RecordHeatmapSnapshotRequest } from "../../types/heatmap.js";

// The serialized rrweb snapshot can be sizable; reject anything pathological rather
// than store a multi-MB blob (the backdrop must stay fast to fetch and render).
const MAX_SNAPSHOT_BYTES = 9_000_000; // stays under the 10MB Fastify bodyLimit

const recordSnapshotSchema = z.object({
  pathname: z.string().max(2048),
  page_width: z.number().int().min(0).max(65535),
  page_height: z.number().int().min(0),
  viewport_width: z.number().int().min(0).max(65535),
  viewport_height: z.number().int().min(0).max(65535),
  events: z
    .array(
      z.object({
        type: z.union([z.number(), z.string()]),
        data: z.any(),
        timestamp: z.number(),
      })
    )
    .min(1)
    .max(50),
});

export async function recordHeatmapSnapshot(
  request: FastifyRequest<{
    Params: { siteId: string };
    Body: RecordHeatmapSnapshotRequest;
  }>,
  reply: FastifyReply
) {
  try {
    const siteConfiguration = await siteConfig.getConfig(request.params.siteId);

    if (!siteConfiguration?.enableHeatmaps) {
      return reply.status(200).send({ success: true, message: "Heatmaps not enabled" });
    }

    const siteId = siteConfiguration.siteId;

    // Diagnostic beacon from the capture script (tells us where capture stops). No data stored.
    const rawBody = request.body as any;
    if (rawBody && typeof rawBody.diag === "string") {
      logger.info(`[HeatmapSnapshot][diag] site=${siteId} stage=${rawBody.diag} path=${rawBody.pathname || ""}`);
      return reply.status(200).send({ success: true });
    }

    const body = recordSnapshotSchema.parse(request.body);

    const snapshot = JSON.stringify(body.events);
    if (snapshot.length > MAX_SNAPSHOT_BYTES) {
      logger.info(
        `[HeatmapSnapshot] site=${siteId} path=${body.pathname} bytes=${snapshot.length} events=${body.events.length} SKIPPED-too-large`
      );
      return reply.status(200).send({ success: true, message: "Snapshot too large, skipped" });
    }

    const ua = userAgentParser(request.headers["user-agent"] || "");
    const deviceType = getDeviceType(body.viewport_width, body.viewport_height, ua);
    logger.info(
      `[HeatmapSnapshot] site=${siteId} path=${body.pathname} bytes=${snapshot.length} events=${body.events.length} device=${deviceType} STORED`
    );

    // ReplacingMergeTree(captured_at) keeps the latest snapshot per (site, path, device).
    await clickhouse.insert({
      table: "heatmap_snapshots",
      values: [
        {
          site_id: siteId,
          pathname: body.pathname,
          device_type: deviceType,
          page_width: body.page_width,
          page_height: body.page_height,
          viewport_width: body.viewport_width,
          viewport_height: body.viewport_height,
          snapshot,
        },
      ],
      format: "JSONEachRow",
    });

    return reply.send({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: error.errors });
    }
    logger.error(error as Error, "Error recording heatmap snapshot");
    return reply.status(500).send({ error: "Failed to record snapshot" });
  }
}

import { DateTime } from "luxon";
import { UAParser as userAgentParser } from "ua-parser-js";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { getLocation } from "../../db/geolocation/geolocation.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { getDeviceType } from "../../utils.js";
import { HeatmapQueueEvent } from "../../types/heatmap.js";

class HeatmapQueue {
  private queue: HeatmapQueueEvent[] = [];
  private batchSize = 5000;
  private interval = 1000;
  private processing = false;
  private logger = createServiceLogger("heatmap-queue");

  constructor() {
    setInterval(() => this.processQueue(), this.interval);
  }

  async add(event: HeatmapQueueEvent) {
    this.queue.push(event);
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const batch = this.queue.splice(0, this.batchSize);
    const ips = [...new Set(batch.map(ev => ev.ipAddress))];

    const geoData = await getLocation(ips);

    const processedEvents = batch.map(ev => {
      const dataForIp = geoData?.[ev.ipAddress];

      const countryCode = dataForIp?.countryIso || "";
      const regionCode = dataForIp?.region || "";
      const city = dataForIp?.city || "";

      const ua = userAgentParser(ev.userAgent);

      return {
        site_id: ev.siteId,
        timestamp: DateTime.fromMillis(ev.timestamp).toFormat("yyyy-MM-dd HH:mm:ss"),
        session_id: ev.sessionId,
        user_id: ev.userId,
        identified_user_id: ev.identifiedUserId || "",
        event_type: ev.type,
        pathname: ev.pathname || "",
        hostname: ev.hostname || "",
        x_percent: ev.x_percent,
        y_absolute: ev.y_absolute,
        viewport_width: ev.viewport_width,
        viewport_height: ev.viewport_height,
        page_width: ev.page_width,
        page_height: ev.page_height,
        scroll_depth: ev.scroll_depth,
        element_selector: ev.element_selector || "",
        element_text: ev.element_text || "",
        device_type: getDeviceType(ev.viewport_width, ev.viewport_height, ua),
        browser: ua.browser.name || "",
        operating_system: ua.os.name || "",
        country: countryCode,
        region: countryCode && regionCode ? countryCode + "-" + regionCode : "",
        city: city || "",
        ip: ev.storeIp ? ev.ipAddress : null,
      };
    });

    try {
      await clickhouse.insert({
        table: "heatmap_events",
        values: processedEvents,
        format: "JSONEachRow",
      });
    } catch (error) {
      this.logger.error(error, "Error processing heatmap queue");
    } finally {
      this.processing = false;
    }
  }
}

export const heatmapQueue = new HeatmapQueue();

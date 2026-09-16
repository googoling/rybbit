import { IS_CLOUD, LITE_DASHBOARD } from "../../lib/const.js";
import { initializeCloudTables } from "./schema/cloud.js";
import { initializeCoreTables } from "./schema/core.js";
import { initializeHeatmapTables } from "./schema/heatmaps.js";
import { initializeLiteDashboardMVs } from "./schema/liteDashboard.js";
import { provisionQueryUser } from "./queryUser.js";

export { clickhouse, clickhouseQuery } from "./client.js";

export const initializeClickhouse = async () => {
  await initializeCoreTables();

  await initializeHeatmapTables(); // CUSTOM

  if (IS_CLOUD) {
    await initializeCloudTables();
  }

  if (LITE_DASHBOARD) {
    await initializeLiteDashboardMVs();
  }

  await provisionQueryUser();
};

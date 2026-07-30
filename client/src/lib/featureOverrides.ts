import { IS_CLOUD } from "./const";

// Force-enable dashboard features Rybbit hides behind IS_CLOUD so they show on self-host.
// Lives in its own file so it survives upstream pulls. Default ON; set
// NEXT_PUBLIC_FORCE_ALL_FEATURES="false" to restore the stock IS_CLOUD gating.
const FORCE_ALL_FEATURES = process.env.NEXT_PUBLIC_FORCE_ALL_FEATURES !== "false";

// Upstream v2.8.0 reinstated the Query + Dashboards nav behind `!IS_CLOUD`, which shows them on
// self-host. We keep them hidden; set NEXT_PUBLIC_SHOW_QUERY_DASHBOARDS="true" to take upstream's.
const SHOW_QUERY_DASHBOARDS = process.env.NEXT_PUBLIC_SHOW_QUERY_DASHBOARDS === "true";

export const featureEnabled = {
  pages: IS_CLOUD || FORCE_ALL_FEATURES,
  performance: IS_CLOUD || FORCE_ALL_FEATURES,
  searchConsole: IS_CLOUD || FORCE_ALL_FEATURES,
  bots: IS_CLOUD || FORCE_ALL_FEATURES,
  queryAndDashboards: SHOW_QUERY_DASHBOARDS,
};

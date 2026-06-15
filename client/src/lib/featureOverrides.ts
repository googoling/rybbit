import { IS_CLOUD } from "./const";

// Force-enable dashboard features Rybbit hides behind IS_CLOUD so they show on self-host.
// Lives in its own file so it survives upstream pulls. Default ON; set
// NEXT_PUBLIC_FORCE_ALL_FEATURES="false" to restore the stock IS_CLOUD gating.
const FORCE_ALL_FEATURES = process.env.NEXT_PUBLIC_FORCE_ALL_FEATURES !== "false";

export const featureEnabled = {
  pages: IS_CLOUD || FORCE_ALL_FEATURES,
  performance: IS_CLOUD || FORCE_ALL_FEATURES,
  searchConsole: IS_CLOUD || FORCE_ALL_FEATURES,
  bots: IS_CLOUD || FORCE_ALL_FEATURES,
};

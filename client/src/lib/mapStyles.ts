// This fork provisions `MAPBOX_TOKEN` as a MapTiler API key (see .env.example), not a real
// Mapbox account token — MapTiler is free-tier, Mapbox's own hosted styles are not. MapTiler's
// hosted styles are Mapbox GL JS compatible (same style spec, own tile/glyph/sprite URLs), so
// every mapbox-gl `style` option here is a MapTiler style.json URL instead of a `mapbox://`
// style URI, which only resolves against a real Mapbox account.
// Labels for these live in MapStyleSelector.tsx as a literal switch, not here — next-intl's
// extraction needs a statically analyzable `t("...")` call, so a label can't be looked up
// dynamically from this list.
export const MAP_STYLE_IDS = ["streets-v2", "hybrid", "outdoor-v2", "bright-v2", "darkmatter", "satellite", "basic-v2", "toner-v2"];

export const DEFAULT_MAP_STYLE_ID = "streets-v2";
export const DARK_MAP_STYLE_ID = "darkmatter";
export const LIGHT_MAP_STYLE_ID = "bright-v2";

export function buildMapStyleUrl(styleId: string, mapTilerKey: string): string {
  return `https://api.maptiler.com/maps/${styleId}/style.json?key=${mapTilerKey}`;
}

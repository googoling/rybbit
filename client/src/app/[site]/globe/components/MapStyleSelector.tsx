import { Palette } from "lucide-react";
import { useExtracted } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import { MAP_STYLE_IDS } from "../../../../lib/mapStyles";
import { useGlobeStore } from "../globeStore";

export default function MapStyleSelector() {
  const { mapStyle, setMapStyle, setTimelineStyle } = useGlobeStore();
  const t = useExtracted();

  const getStyleName = (id: string): string => {
    switch (id) {
      case "streets-v2": return t("Standard");
      case "hybrid": return t("Standard Satellite");
      case "outdoor-v2": return t("Outdoors");
      case "bright-v2": return t("Light");
      case "darkmatter": return t("Dark");
      case "satellite": return t("Satellite");
      case "basic-v2": return t("Navigation Day");
      case "toner-v2": return t("Navigation Night");
      default: return t("Style");
    }
  };

  const handleStyleChange = (styleId: string) => {
    setMapStyle(styleId);
    // Also update timelineStyle so it persists when switching views
    setTimelineStyle(styleId);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="text-xs font-medium rounded-lg bg-neutral-900/70 text-neutral-200 backdrop-blur-sm px-1.5 md:px-2.5 py-1.5 border border-neutral-800/50 hover:bg-neutral-800 hover:text-white transition-all inline-flex items-center gap-1.5"
        unstyled
      >
        <Palette size={14} />
        <span className="hidden md:inline">{getStyleName(mapStyle)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {MAP_STYLE_IDS.map(id => (
          <DropdownMenuItem
            key={id}
            onClick={() => handleStyleChange(id)}
            className={mapStyle === id ? "bg-neutral-100 dark:bg-neutral-800" : ""}
          >
            {getStyleName(id)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

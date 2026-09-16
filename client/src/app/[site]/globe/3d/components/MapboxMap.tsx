import { useExtracted } from "next-intl";
import { RefObject } from "react";
import { NothingFound } from "../../../../../components/NothingFound";
import { useConfigs } from "../../../../../lib/configs";

export const MapboxMap = ({ mapContainer }: { mapContainer: RefObject<HTMLDivElement | null> }) => {
  const t = useExtracted();
  const { configs, isLoading } = useConfigs();

  return (
    <>
      {configs?.mapboxToken ? (
        <div
          ref={mapContainer}
          className="w-full h-full [&_.mapboxgl-ctrl-bottom-left]:hidden! [&_.mapboxgl-ctrl-logo]:hidden!"
        />
      ) : isLoading ? null : (
        <div className="w-full h-full flex items-center justify-center">
          <NothingFound
            title={t("Mapbox access token not found")}
            description={
              <p className="text-sm max-w-[600px] text-center">
                {t("Please set the MAPBOX_TOKEN environment variable and rebuild all containers. To get a free API key, please visit")}{" "}
                <a
                  href="https://cloud.maptiler.com/account/keys/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  MapTiler
                </a>{" "}
                {t("and create an account.")}
              </p>
            }
          />
        </div>
      )}
    </>
  );
};

ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "enableHeatmaps" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "heatmapSampleRate" integer DEFAULT 100;
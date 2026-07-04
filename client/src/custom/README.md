# Client custom modules

Every custom (non-upstream) frontend feature lives here in its own folder so upstream merges
never conflict with it. See `/FORK_MAINTENANCE.md` for the full policy.

## How to add a feature

1. Create `client/src/custom/<feature>/` with your components, hooks, and API clients.
2. Wire it into an upstream page with the smallest possible hook — one import + one JSX
   insertion — each tagged so it survives merges:
   ```tsx
   import { FeaturePanel } from "@/custom/<feature>/FeaturePanel"; // CUSTOM
   // ...
   <FeaturePanel /> {/* CUSTOM */}
   ```

Rule: prefer new files over editing upstream files. If you must edit an upstream file, keep the
diff tiny, give it its own commit, and record it in `/CUSTOMIZATIONS.md`.

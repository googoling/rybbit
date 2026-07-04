# Server custom modules

Every custom (non-upstream) backend feature lives here in its own folder so upstream merges
never conflict with it. See `/FORK_MAINTENANCE.md` for the full policy.

## How to add a feature

1. Create `server/src/custom/<feature>/` with your routes, services, and queries.
2. Export one Fastify route plugin:
   ```ts
   // server/src/custom/<feature>/routes.ts
   import { FastifyInstance } from "fastify";
   export default async function <feature>Routes(fastify: FastifyInstance) {
     fastify.get("/<feature>/thing", handler);
   }
   ```
3. Register it with ONE line in `server/src/index.ts`, inside the `apiRoutes` plugin, tagged so
   it survives merges:
   ```ts
   await fastify.register(<feature>Routes); // CUSTOM
   ```

Rule: prefer new files over editing upstream files. If you must edit an upstream file, keep the
diff tiny, give it its own commit, and record it in `/CUSTOMIZATIONS.md`.

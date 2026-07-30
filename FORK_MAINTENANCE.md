# Fork Maintenance Guide (READ BEFORE UPDATING FROM UPSTREAM)

This repo is a **customized fork** of open-source Rybbit (`github.com/rybbit-io/rybbit`).
Our own remote is `origin` = `github.com/googoling/rybbit.git`, working branch **`my-main`**.
We have added many custom features on top of upstream. This file is the source of truth for
keeping those features safe when upstream ships a new release.

> Claude: read this file top-to-bottom before doing ANY upstream merge, `update.sh`-like
> operation, or new-feature work. The rules here override generic instincts.
>
> **This file is the RULES. For an actual upstream update, execute `UPGRADE_PLAYBOOK.md`
> step by step** — it encodes the full procedure plus `./verify-fork-intact.sh`, the sweep that
> mechanically proves no customization was lost in conflict resolution. Never merge by feel.

---

## Rule 0 — NEVER run `update.sh`

`update.sh` does `git stash && git pull && docker compose pull`. It:
- stashes (i.e. hides) uncommitted work, and
- swaps the running containers to **upstream's prebuilt images**, erasing every custom feature.

We deploy with **`./deploy.sh`**, which builds images **from our own source**. That is the only
correct deploy path. If asked to "update Rybbit," follow the merge workflow below — do not run `update.sh`.

---

## Rule 0b — NEVER click GitHub's "Sync fork" button

On `github.com/googoling/rybbit` the banner reads *"This branch is N commits ahead of and M commits
behind rybbit-io/rybbit:master"* with a **Sync fork** button. Both are misleading:

- **"M commits behind" is normal and expected.** GitHub compares against upstream's *moving default
  branch* (`master`), which contains unreleased dev work. We deliberately track **release tags**, so
  we will *always* show as "behind" master. Being behind `master` is not a problem to fix.
- **"Sync fork" merges upstream `master` straight into `my-main`** with no conflict review, no build,
  no test — pulling unreleased code and potentially clobbering our customizations. It is the web-UI
  equivalent of `update.sh`.

GitHub provides no way to disable this button, so the rule is simply: **don't press it.** To update,
use the release-tag merge workflow in Rule 1 below.

### If you click it by mistake — it IS recoverable, don't panic

Clicking Sync fork **does not touch production** (`deploy.sh` builds from your *local* source, not
from GitHub) and **does not change your local clone** until you `git pull`. It only adds a merge
commit to `origin/my-main` on GitHub.

We keep a `deployed/*` tag marking each known-good, shipped state (tags are never moved by Sync
fork). Latest: **`deployed/v2.7.0`** = `e51f1f75`.

```bash
git fetch origin --tags
git log --oneline -3 deployed/v2.7.0        # confirm this is the state you want

# Option A (local clone still clean — the usual case): just overwrite GitHub.
git push --force-with-lease origin my-main

# Option B (you already pulled the bad merge): reset local, then push.
git checkout my-main
git reset --hard deployed/v2.7.0            # or: git reset --hard ORIG_HEAD
git push --force-with-lease origin my-main
```

`git reflog` also records every state your local branch has been in, so even without the tag the
pre-merge commit is recoverable. **After shipping any future release, move the anchor forward:**
`git tag -a deployed/vX.Y.Z -m "known-good, deployed" && git push origin deployed/vX.Y.Z`.

---

## Rule 1 — How to pull an official upstream update (safe workflow)

```bash
# One-time setup (check first: `git remote -v`)
git remote add upstream https://github.com/rybbit-io/rybbit.git

# Each time we want a new upstream release:
git fetch upstream --tags
git checkout my-main
git pull origin my-main                      # make sure local my-main is current
git checkout -b update/vX.Y.Z                # throwaway integration branch
git merge vX.Y.Z                             # merge the RELEASE TAG, not upstream/main

#   → resolve conflicts. They cluster in files we edited in place.
#     Use CUSTOMIZATIONS.md as the map of what to protect.

cd server && npm run build                   # backend must compile (tsc)
cd ../client && npm run build                # client must compile (next build)
#   → smoke-test locally (see checklist below), THEN:

git checkout my-main
git merge --no-ff update/vX.Y.Z
git push origin my-main
./deploy.sh                                  # build + roll OUR merged source
```

Key points:
- **Merge release tags** (`vX.Y.Z`), never the moving `upstream/main`. One deliberate, reviewed release at a time.
- **Integration branch** (`update/vX.Y.Z`) so `my-main` never ends up half-merged.
- **`--no-ff`** so the merge is one reviewable commit on `my-main`.

### Post-merge database caution (HARD)
Upstream updates sometimes change the schema. Our standing rule is **never run DB migrations
automatically**. After any merge:
1. `git diff my-main..update/vX.Y.Z -- server/drizzle/` — inspect new Drizzle migrations.
2. Check ClickHouse table changes.
3. Apply migrations only as a **manual, reviewed, backed-up** step. Never let a deploy run them silently.

### Smoke-test checklist after a merge
- App loads, login works.
- A dashboard renders real data (main / sessions / users).
- Our custom features still work: **Heatmaps** (Click tab pills + overlay opacity), **Goals**
  (converted sessions show real name/email via traits enrichment), sidebar nav (Query/Dashboards hidden), tagging.
- `server` starts with no ClickHouse/Postgres errors in logs.

---

## Rule 2 — New features are ALWAYS modules (add, don't edit in place)

The amount of pain in every future merge is decided by *how* we add features now.
**Editing the middle of an upstream file risks a conflict forever. New files never conflict.**

So: **every new feature is a self-contained module in a `custom/` folder**, wired into upstream
with the smallest possible hook (ideally ONE line).

### Server modules → `server/src/custom/<feature>/`
- Put routes, services, and queries for the feature in its own folder.
- Export a single Fastify route plugin: `export default async function <feature>Routes(fastify) { ... }`.
- Register it with ONE line in `server/src/index.ts` inside the `apiRoutes` plugin:
  ```ts
  await fastify.register(myFeatureRoutes);   // CUSTOM
  ```
- Tag every custom hook line with a trailing `// CUSTOM` comment so it is grep-able and obvious during conflict resolution.

### Client modules → `client/src/custom/<feature>/`
- Components, hooks, and API clients for the feature live here.
- Import into an upstream page with a single import + single JSX insertion, both tagged `// CUSTOM`.

### Don't force existing/large features into `custom/`
Some features (e.g. **Heatmaps**) need deep integration — DB schema, the tracking script, site
config, CORS, nav — so they can never be a pure drop-in module. Their own code already lives in
dedicated directories upstream doesn't use (conflict-proof); moving those gains nothing and risks
breaking a working feature. For these, **leave the code where it is and document the shared
integration points in `CUSTOMIZATIONS.md`** (Heatmaps is already mapped there). The `custom/`
convention is for NEW, additive features going forward — not a mandate to relocate what works.

### When a feature genuinely must edit an upstream file
Sometimes you must (e.g. enrich an existing endpoint, like the Goals traits fix). Then:
- Keep the edit **minimal** — a few lines, ideally calling into a `custom/` helper.
- Make it its **own small, well-labeled commit** (e.g. `Goals: enrich converted sessions with traits`).
- Add the file to **CUSTOMIZATIONS.md** so the next merge knows to protect it.

---

## Rule 3 — Keep the divergence map current

`CUSTOMIZATIONS.md` (repo root) lists every upstream file we have modified in place and why.
Update it whenever you edit an upstream file. It is the merge conflict map — without it, each
update is archaeology.

---

## Rule 4 — Deploy

- `./deploy.sh [tag]` (default tag `heatmap`) — rsyncs source to ssh host `faridul`, builds
  client+backend Docker images there, rolls only backend+client (DB + caddy untouched), health-checks.
- Rollback: on the server restore a `docker-compose.override.yml.bak-*` then
  `docker compose up -d --no-deps backend client`.
- GitHub push and server deploy are **separate** explicit steps. Commit only when asked.

### After each deploy: preserve the outgoing images (they are your rollback)

`deploy.sh` always rebuilds the **same** tag (`heatmap`), which **untags the previous release's
images and leaves them "dangling."** They look like garbage but they are the last-known-good build —
so a routine `docker image prune` / `docker system prune` would silently destroy your fastest
rollback path. Instead, tag them:

```bash
docker images -f dangling=true          # the outgoing release
docker tag <backend-id> ghcr.io/rybbit-io/rybbit-backend:pre-vX.Y.Z
docker tag <client-id>  ghcr.io/rybbit-io/rybbit-client:pre-vX.Y.Z
# roll back by pointing docker-compose.override.yml at :pre-vX.Y.Z, then
#   docker compose up -d --no-deps backend client
```

Currently tagged: **`:pre-v270`** (the v2.6.1 images, i.e. the state before the v2.7.0 upgrade).

Disk hygiene on the server: Docker **build cache** is safe to reclaim (`docker builder prune -af` —
a full deploy leaves several GB). **Never prune volumes** — those are the Postgres + ClickHouse data.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Deploy current source | `./deploy.sh` |
| Pull an upstream release | **`UPGRADE_PLAYBOOK.md`**, start to finish |
| Prove nothing was lost in a merge | `./verify-fork-intact.sh <old-tag> my-main` |
| Add a new feature | New module in `server/src/custom/` or `client/src/custom/` + 1-line hook |
| Edit an upstream file | Minimal diff, own commit, add to `CUSTOMIZATIONS.md` |
| Update Rybbit "the easy way" | ❌ Do NOT run `update.sh` |

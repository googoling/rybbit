# Upstream Upgrade Playbook (follow this EXACTLY — it is how we never lose a customization)

`FORK_MAINTENANCE.md` = the rules. `CUSTOMIZATIONS.md` = the map. **This file = the procedure.**

Read all three before an upgrade. The one thing that must never happen is a customization
silently disappearing into a conflict resolution. Step 5 is the mechanical guarantee against that
— do not skip it, and do not replace it with "I read the diffs carefully."

---

## 0. Preflight

```bash
cd "/Volumes/Data/Dropbox/Works/AI Box Project/decor-ai/rybbit"
git status --short                 # must be clean (untracked AGENTS.md / decorai/ are fine)
git fetch upstream --tags
git tag -l 'v*' --sort=-v:refname | head -5
export OLD=v2.8.0 NEW=v2.9.0       # <-- set these; every later step uses them
```

Record the pre-merge tip — it is the reference for the loss sweep and the rollback:

```bash
git log --oneline -1 my-main
```

Scope the release before touching anything:

```bash
git rev-list --count $OLD..$NEW
git diff --stat $OLD..$NEW | tail -3
git diff --name-status $OLD..$NEW -- server/drizzle/          # new migrations?
git diff --name-status $OLD..$NEW -- server/src/db/clickhouse/ # schema refactor?
# Which of OUR files does this release touch? (the conflict surface)
git diff --stat $OLD..$NEW -- $(git diff --name-only $OLD my-main | grep -v client/messages)
```

---

## 1. Merge on a throwaway branch

```bash
git checkout my-main && git pull origin my-main
git checkout -b update/$NEW
git merge $NEW                      # the RELEASE TAG. never upstream/master.
git diff --name-only --diff-filter=U # the conflict list
```

---

## 2. Resolve — rules that have paid off

- **Prefer relocation over re-insertion.** When upstream splits a file we edited, move our block
  into its *own new module* and leave a one-line `// CUSTOM` call. This is how
  `clickhouse.ts` went from ~90 conflicted lines to 1 (v2.8.0 → `schema/heatmaps.ts`).
- **Tag every hook `// CUSTOM`** so the next merge can grep for them.
- **Before resolving a big file, diff base-vs-ours** to learn what our customization actually was:
  `git show :1:<file> > /tmp/base; git show :2:<file> > /tmp/ours; diff /tmp/base /tmp/ours`
  (`:1:`=merge base, `:2:`=ours/my-main, `:3:`=theirs/upstream).
- **Adopt upstream's new API rather than restoring the old one.** v2.8.0 deleted
  `siteConfig.isIPExcluded`; `recordHeatmap` moved to `decideSiteExclusion()` instead of
  resurrecting dead helpers.
- **Keep behavior as-deployed** unless asked. When upstream flips a default that reverses one of
  our decisions, route it through `client/src/lib/featureOverrides.ts` with an env escape hatch
  rather than silently accepting the new behavior.
- **Make our added interface fields OPTIONAL** (`foo?: T`). Required fields break every upstream
  test that builds an object literal of that type, forever.

### Translation catalogs (`client/messages/*.json`)
12 sorted flat key→string files; conflicts are adjacent-insertion noise. Never hand-merge. Do a
3-way key union per file: start from *theirs*, add keys that are in *ours* but in neither base nor
theirs, re-sort with default `.sort()`, write with 2-space indent + trailing newline. Result must
be **purely additive vs upstream** — verify:

```bash
diff <(git show $NEW:client/messages/en.json) client/messages/en.json | grep -c '^<'   # MUST be 0
diff <(git show $NEW:client/messages/en.json) client/messages/en.json | grep -c '^>'   # our key count
```

### Drizzle migrations — renumber when upstream collides
Upstream has collided with our heatmap migration twice (`0009`→`0010`→`0014`). Recipe:

```bash
git checkout --theirs server/drizzle/meta/00NN_snapshot.json          # upstream's colliding snapshot
git show $NEW:server/drizzle/meta/_journal.json > server/drizzle/meta/_journal.json
rm server/drizzle/00NN_add_heatmaps.sql
cd server && npm run db:generate      # OFFLINE - diffs schema.ts vs newest snapshot
```
`db:generate` must emit **only** our two `sites` columns — that is also proof `schema.ts` merged
correctly. Then rename to `00MM_add_heatmaps.sql`, re-add `IF NOT EXISTS` to both statements, and
`sed -i '' 's/"00MM_<generated_name>"/"00MM_add_heatmaps"/' server/drizzle/meta/_journal.json`.

### Built artifacts — never hand-merge
`server/public/script.js` / `script-full.js` are build output. Take theirs, then regenerate in
step 4: `git checkout --theirs server/public/script*.js`.

---

## 3. No markers left

```bash
grep -rln '<<<<<<< ' client/src server/src server/drizzle client/messages ; echo "^ must be empty"
git diff --name-only --diff-filter=U ; echo "^ must be empty"
```

---

## 4. Build (in this order — `shared` first, it is a workspace dep)

```bash
cd shared  && npm install && npm run build
cd ../server && npm install && npx tsc --noEmit && npm run build   # build regenerates script*.js
cd ../client && npm install && npx tsc --noEmit                    # ignore .next/types/* errors
```

**Client build needs `@rybbit/shared` materialized** — npm installs it as a `file:` symlink that
escapes `client/`, which Turbopack refuses to follow. Do exactly what `client/Dockerfile` does:

```bash
cd client
rm -rf node_modules/@rybbit/shared && mkdir -p node_modules/@rybbit/shared
cp -r ../shared/package.json ../shared/dist node_modules/@rybbit/shared/
npm run build
```

> Do **NOT** "fix" this with `turbopack.root` / `outputFileTracingRoot` in `next.config.ts`. That
> re-homes `output: "standalone"` to `.next/standalone/client/server.js` while the Dockerfile
> runner copies `.next/standalone` expecting `server.js` at the root — the container won't boot.
> The Docker build already handles this; only local builds need the copy.

A local client build rewrites all 12 `client/messages/*.json` in a non-alphabetical order via
next-intl extraction. Upstream commits them sorted, so discard that churn:
`git checkout -- client/messages/`.

---

## 5. ⚠️ THE LOSS SWEEP — the step that makes this reliable

```bash
./verify-fork-intact.sh $OLD my-main      # run from the update/$NEW branch, BEFORE step 7a
```

It replays every line our fork added on top of `$OLD` and asserts each still exists.

> **Timing matters.** The second argument must be the **pre-merge** ref. Run this while still on
> `update/$NEW`, before merging into `my-main`. Once `my-main` contains the merge, `$OLD..my-main`
> also includes all of upstream's new work, the signal is swamped, and the check stops being
> meaningful. If you already merged, pass the pre-merge commit explicitly instead of `my-main`.

- `OK` — byte-for-byte intact.
- `CHECK` — **must be individually explained.** A CHECK is fine only if it is a deliberate
  relocation or adaptation, and you have *shown* the code in its new home. Find it with
  `grep -rn '<distinctive string>' server/src client/src`, then diff old vs new to confirm
  equivalent logic (for SQL/DDL, diff the extracted block and expect IDENTICAL).
- Never sign off with an unexplained CHECK. Never assume; print the evidence.

Record each explained CHECK in the merge commit message.

---

## 6. Tests, with a baseline

```bash
cd server && npx vitest run
```

Upstream sometimes ships broken tests. **Do not attribute a failure to our merge without proving
it** — build a pristine worktree of the new tag and compare:

```bash
git worktree add /tmp/base-$NEW $NEW
cd /tmp/base-$NEW/shared && npm install && npm run build
cd ../server && npm install && npx vitest run <suspect.test.ts>
# same failure there  -> pre-existing upstream breakage, leave it, note it
# passes there        -> WE broke it, fix it
git worktree remove /tmp/base-$NEW --force
```

Do **not** symlink `node_modules` into the worktree — Turbopack rejects a `node_modules` symlink
that points outside the project root and you'll get a bogus result.

Known ours-to-fix: `server/src/lib/auth-utils.test.ts` hand-writes the `sites` CREATE TABLE in
pglite and needs our two heatmap columns, or 27 tests fail.

---

## 7. Ship — in this exact order

> **The deploy DOES apply Postgres migrations.** `server/docker-entrypoint.sh` runs
> `npm run db:migrate` on every backend start. There is no separate manual migration step to gate,
> so "reviewed + backed up" has to happen *before* `deploy.sh`. Review them in step 0
> (`git diff --name-status $OLD..$NEW -- server/drizzle/`) and back up in 7c. Every upstream
> migration so far has been idempotent (`IF NOT EXISTS` / `DO $$ … WHEN duplicate_object`); if one
> ever isn't, that is a stop-and-think moment.

**7a — merge and push** (do this *after* step 5's sweep, which must run while `my-main` is still
the pre-merge ref):

```bash
git checkout my-main && git merge --no-ff update/$NEW && git push origin my-main
```

**7b — tag the OUTGOING images as the rollback, before building over them.** `deploy.sh` reuses
the `heatmap` tag, so the previous release becomes dangling the moment you build. Tag it *first* —
hunting dangling IDs afterwards is guesswork, and a stray `docker image prune` destroys them.

```bash
ssh faridul 'docker images --format "{{.Repository}}:{{.Tag}} {{.ID}}" | grep -E "rybbit-(backend|client):heatmap"'
ssh faridul 'docker tag <backend-id> ghcr.io/rybbit-io/rybbit-backend:pre-v280
             docker tag <client-id>  ghcr.io/rybbit-io/rybbit-client:pre-v280'
```

**7c — back up Postgres** (migrations run on the next backend start):

```bash
ssh faridul 'mkdir -p /home/faridul/backups && cd /home/faridul/rybbit && docker compose exec -T postgres \
  pg_dump -U frog -d analytics --clean --if-exists | gzip \
  > /home/faridul/backups/analytics-pre-vXYZ-$(date +%Y%m%d-%H%M%S).sql.gz'
```

**7d — deploy** (builds OUR source on the server; never `update.sh`):

```bash
./deploy.sh
```

**7e — verify** (see step 8) **then** set the anchor:

```bash
git tag -a deployed/$NEW -m "known-good, deployed" && git push origin deployed/$NEW
```

**7f — reclaim build cache** (safe; a deploy leaves several GB). **Never `docker image prune`**
(kills the `pre-v*` rollbacks) and **never prune volumes** (that is Postgres + ClickHouse data):

```bash
ssh faridul 'docker builder prune -af && df -h / | tail -1'
```

Finally, update `CUSTOMIZATIONS.md` with any new conflict point, and bump the anchor + image tag
references in `FORK_MAINTENANCE.md`.

### What a deploy does NOT do
`deploy.sh` rsyncs to `rybbit-hm-build/`, builds there, and only rewrites the live stack's
`docker-compose.override.yml`. It **never replaces `STACK_DIR/docker-compose.yml`**, so upstream's
image bumps for **clickhouse / postgres / redis are not applied** (v2.8.0 proposed ClickHouse
25.4.2 → 26.3.17.4 and Redis 7 → 8.6.4; the v2.8.0 backend runs fine against the older ones).
That is deliberate — a ClickHouse major upgrade over 1M+ rows is its own operation with its own
backup, not a side effect of shipping code.

---

## 8. Post-deploy verification — run the script, don't eyeball it

```bash
./verify-deploy.sh
```

26 checks: public endpoints, container health, migration errors + applied count, **our** heatmap
columns, **our** ClickHouse tables and row counts, **every** custom route (a `404` means a route
was lost in the merge — `403`/`401` is correct when unauthenticated), the three tracking-script
customizations in the served bundle, live ingestion, and rollback images. Exits non-zero on
failure and prints the rollback command.

**A green health check is not verification.** `deploy.sh`'s own check only proves the client
returns 200 — it cannot tell you a heatmap route vanished or the tracking script lost our
delay-JS fallbacks. Step 8's last two groups are the ones that matter: *are our customizations
actually in the shipped artifact*, and *is real traffic flowing through the new build*.

Still browser-only (do these by hand once): login, a dashboard rendering real data, **Heatmaps**
Click tab pills + overlay opacity, **Goals** converted sessions showing name/email, **Mailbo**
settings tab.

### Rollback
```bash
ssh faridul 'cd /home/faridul/rybbit && sed -i "s/:heatmap/:pre-v280/" docker-compose.override.yml \
  && docker compose up -d --no-deps backend client'
```
Postgres restore (only if a migration actually broke something):
`zcat <backup>.sql.gz | docker compose exec -T postgres psql -U frog -d analytics`

---

## Post-merge checklist

Merge:
- [ ] no conflict markers; no unmerged paths
- [ ] `shared` → `server` → `client` all build; `tsc` clean both sides
- [ ] `./verify-fork-intact.sh $OLD my-main` **on the `update/` branch** — every CHECK explained in writing
- [ ] messages purely additive vs upstream (0 removals); build churn discarded
- [ ] drizzle: our migration renumbered, `IF NOT EXISTS` re-added, journal tag fixed
- [ ] tests: failures reproduced on a pristine worktree or fixed
- [ ] new upstream `IS_CLOUD` gates reviewed:
      `git diff $OLD..$NEW -- client/src | grep '^+.*IS_CLOUD'`
- [ ] `CUSTOMIZATIONS.md` updated

Ship (order matters):
- [ ] 7a merge `--no-ff` into `my-main` + push
- [ ] 7b tag outgoing images `:pre-vXYZ` **before** building over them
- [ ] 7c `pg_dump` backup **before** deploy (the deploy runs migrations)
- [ ] 7d `./deploy.sh`
- [ ] 8  `./verify-deploy.sh` → all green
- [ ] 7e tag + push `deployed/$NEW`; bump the anchor and image tags in `FORK_MAINTENANCE.md`
- [ ] 7f `docker builder prune -af` only — never `image prune`, never volumes
- [ ] browser pass: login, dashboard, Heatmaps Click tab, Goals traits, Mailbo tab

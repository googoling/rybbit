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
./verify-fork-intact.sh $OLD my-main
```

It replays every line our fork added on top of `$OLD` and asserts each still exists.

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

## 7. Ship

Smoke-test a running stack first: login; a dashboard with real data; **Heatmaps** (Click pills +
overlay opacity); **Goals** (converted sessions show name/email via traits); **Mailbo** settings
tab; sidebar nav; server logs free of ClickHouse/Postgres errors.

```bash
git checkout my-main && git merge --no-ff update/$NEW && git push origin my-main
```

Apply upstream's new Drizzle migrations **manually, reviewed, backed up** — never let a deploy run
them. Then:

```bash
./deploy.sh                                   # builds OUR source. never update.sh
git tag -a deployed/$NEW -m "known-good, deployed" && git push origin deployed/$NEW
# preserve the outgoing images as the rollback (deploy.sh reuses the `heatmap` tag):
docker images -f dangling=true
docker tag <backend-id> ghcr.io/rybbit-io/rybbit-backend:pre-${NEW//./}
docker tag <client-id>  ghcr.io/rybbit-io/rybbit-client:pre-${NEW//./}
```

Finally, update `CUSTOMIZATIONS.md` with any new conflict point this release created.

---

## Post-merge checklist

- [ ] no conflict markers; no unmerged paths
- [ ] `shared` → `server` → `client` all build; `tsc` clean both sides
- [ ] `./verify-fork-intact.sh $OLD my-main` — every CHECK explained in writing
- [ ] messages purely additive vs upstream (0 removals); build churn discarded
- [ ] drizzle: our migration renumbered, `IF NOT EXISTS` re-added, journal tag fixed
- [ ] tests: failures reproduced on a pristine worktree or fixed
- [ ] new upstream `IS_CLOUD` gates reviewed:
      `git diff $OLD..$NEW -- client/src | grep '^+.*IS_CLOUD'`
- [ ] `CUSTOMIZATIONS.md` updated
- [ ] smoke test passed → merge to `my-main`, deploy, tag `deployed/$NEW`, tag old images

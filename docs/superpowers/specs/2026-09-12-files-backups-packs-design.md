# Minecraft Server Panel — Phase 2 (Files, Backups, Packs) Design

Date: 2026-09-12
Status: approved for planning
Supersedes nothing. Builds on `2026-07-25-mc-panel-phase1-design.md`.

## Purpose

Phase 1 delivered the core loop: log in, create a server, run it, watch its
console and metrics. Phase 2 delivers the data plane — the ability to see and
change a server's files, to snapshot and restore its state, and to create a
server from a modpack instead of a bare loader.

All three features operate on the same per-server directory tree, so they
share one path-safety boundary rather than three.

## Scope

### In scope

- **File manager** — browse, edit text files, upload, download, delete,
  rename, mkdir, filename search, bulk multi-select operations, zip extract
  and compress.
- **Backups** — two kinds (world snapshot, full snapshot), three triggers
  (panel button, in-game chat, per-server interval schedule), keep-N
  retention, restore, download.
- **Pack install at server creation** — from a pasted URL or an uploaded
  file; Modrinth `.mrpack`, CurseForge pack zip, and complete server-pack
  zips (the usual GitHub-release shape).

### Out of scope

- Installing or changing a pack on an existing server. Packs apply at
  creation only.
- Off-host backup targets (S3, rsync). Local disk only.
- In-game `!restore` and in-game backup listing. Chat gets exactly one
  command.
- Automatic pre-risk snapshots before destructive panel actions. Restore
  gets its own undo (see Restore), but nothing else auto-snapshots.
- Fabric in the manual create wizard. Fabric is enabled only as a
  pack-declared loader (see Pack install); a Fabric version fetcher stays
  Phase 3.

## On-disk layout

```
<MC_DATA_ROOT>/
  _staging/<token>.zip        # uploaded packs awaiting a create, swept after 1h
  <serverId>/
    data/                     # bind-mounted to /data in the container
    backups/                  # host only — the container cannot see it
    staging/                  # pack work area during create, cleared after
```

Backups are a **sibling** of `data/`, never inside it:

- A full backup tars `data/`; backups living inside it would be tarred into
  the next backup, compounding.
- A full restore replaces `data/` wholesale, which would destroy the very
  backups it restores from.
- Anything running in the container — a mod, a plugin, itzg's own `/data`
  handling — can write and delete inside the mount. A backup must outlive
  the thing it protects.

Two consequences, both handled in this phase:

- **Disk visibility.** `Backup.sizeBytes` is stored per row, so the total is
  a SQL sum, not a tree walk. The metrics gateway emits `backupsMb` next to
  the existing `diskMb` so the two are distinguishable.
- **Cleanup.** `ServersService.deleteServer` currently removes the container
  and the DB row and never touches the filesystem — `<MC_DATA_ROOT>/<id>/data`
  leaks on every delete today. It now removes `<MC_DATA_ROOT>/<id>` entirely,
  taking `data/` and `backups/` together. Prisma `onDelete: Cascade` drops the
  backup rows.

The panel process runs as uid 1000 and the itzg container's default user is
uid 1000, so all file access is direct host-side `fs`. No `docker exec`, no
privilege escalation.

## Data model

```prisma
model Backup {
  id        String   @id @default(cuid())
  serverId  String
  kind      String   // "world" | "full"
  trigger   String   // "manual" | "chat" | "schedule"
  label     String?  // player-supplied name from !backup <name>
  path      String   // <MC_DATA_ROOT>/<id>/backups/<file>.tar.zst
  sizeBytes BigInt
  createdAt DateTime @default(now())
  server    Server   @relation(fields: [serverId], references: [id], onDelete: Cascade)
}

model BackupSchedule {
  serverId      String  @id
  worldEveryMin Int?    // null = off
  fullEveryMin  Int?    // null = off
  keepWorld     Int     @default(12)
  keepFull      Int     @default(5)
  skipWhenEmpty Boolean @default(true)
  chatEnabled   Boolean @default(true)
  server        Server  @relation(fields: [serverId], references: [id], onDelete: Cascade)
}
```

`Server` gains the two back-relations. Interval floor is 5 minutes (below
that, tar duration approaches the interval). `keepWorld` / `keepFull` are
clamped to 1–20 in the DTO and re-checked in the service. One migration.

Pack installs add no table — they resolve into the existing
`Server.loader` / `version` / `loaderVersion` fields and report progress over
a socket.

## Architecture

Three new backend modules. Layering follows the binding repo rule
(controller → service → resource access); `ServerFsService` plays the role
`DockerService` plays for Docker: the single owner of real paths.

```
backend/src/files/
  path.ts                  # pure: relative -> absolute resolve + traversal guard
  server-fs.service.ts     # list/stat/readText/writeText/mkdir/rename/remove/search
  archive.service.ts       # zip extract + zip create (sole importer of archive libs)
  files.service.ts         # caps, conflict checks, bulk-op results
  files.controller.ts
  dto/

backend/src/backups/
  archive-paths.ts         # pure: world dirs from level-name; full-backup excludes
  chat-command.ts          # pure: log line -> {player, cmd, arg} | null; `list` output parser
  backup.repository.ts     # sole Prisma consumer for Backup + BackupSchedule
  backup.service.ts        # create/list/delete/restore, single-flight lock, retention
  backup-schedule.service.ts
  chat-trigger.service.ts
  backups.controller.ts
  dto/

backend/src/packs/
  pack-format.ts           # pure: classify / stripRoot / mineLoader / isLauncherArtifact
  pack-downloader.ts       # streaming fetch: size cap, timeout, redirect limit, hash verify
  pack-installer.ts        # sequences the above; writes into data/
  packs.controller.ts      # staging upload endpoint
  packs.gateway.ts         # /packs socket room: install progress
  dto/
```

### Path safety

`path.ts` is the security core and stays pure so it can be tested
adversarially. `resolve(root, rel)` runs `path.resolve(root, rel)` then
requires `resolved === root || resolved.startsWith(root + sep)`. It rejects
`..` traversal, absolute inputs, and null bytes.

Symlink escape is blocked separately in `ServerFsService`: `realpath` the
nearest existing ancestor and re-check the prefix, so a symlink inside
`data/` pointing at `/etc` never becomes readable. Zip extraction re-runs
every archive entry name through the same guard before writing (zip slip),
with entry-count and total-uncompressed-size caps against zip bombs.

## File manager

All paths in the API are relative to `data/`. All routes are behind
`JwtAuthGuard`.

| Method | Route                                 | Notes                                                         |
| ------ | ------------------------------------- | ------------------------------------------------------------- |
| GET    | `/servers/:id/files?path=`            | entries: name, type, sizeBytes, mtimeMs                       |
| GET    | `/servers/:id/files/content?path=`    | text only; 2 MB cap; binary sniff → 415                       |
| PUT    | `/servers/:id/files/content`          | `{path, content, mtimeMs}`; mismatch → 409; atomic tmp+rename |
| POST   | `/servers/:id/files/dir`              | mkdir -p inside root                                          |
| POST   | `/servers/:id/files/rename`           | both sides guarded                                            |
| POST   | `/servers/:id/files/delete`           | `{paths[]}` → per-path result; refuses the root               |
| POST   | `/servers/:id/files/upload`           | multipart, streamed to tmp then renamed; size cap from env    |
| GET    | `/servers/:id/files/download?path=`   | file streams as-is; directory streams as zip                  |
| POST   | `/servers/:id/files/extract`          | `{path, dest}`; zip / tar.gz; guarded per entry               |
| POST   | `/servers/:id/files/compress`         | `{paths[], dest}` → zip                                       |
| GET    | `/servers/:id/files/search?q=&limit=` | name substring; capped depth and result count                 |

Archive libraries: `yauzl` (streaming zip read) and `archiver` (zip write) —
both CommonJS, compatible with the stack pins. `tar --zstd` is spawned only
by the backup engine.

Editing while the server runs is allowed — that is the point of the feature.
Minecraft caches most config at boot, so edits take effect on restart; the UI
says so. Deleting world files while running is allowed but warned, since the
server holds them open.

## Backups

### Create (one code path, three triggers)

1. Acquire the per-server single-flight lock. Schedule, chat, and button
   cannot overlap; a second caller gets 409 / "backup already running".
2. If the container is running: RCON `save-off` → `save-all flush` → settle.
   `save-on` runs in a `finally` block, always, even when tar fails. Leaving
   a server with saves disabled is the one unacceptable outcome.
3. `tar --zstd -cf <out> -C <dataDir> <paths>`:
   - **world** — `level-name` from `server.properties` (default `world`),
     plus `<name>_nether` and `<name>_the_end` when they exist. Modded
     dimensions live inside `world/dimensions/` and come along.
   - **full** — all of `data/` minus `logs/`, `cache/`, `crash-reports/`,
     `libraries/`, `versions/`, and root-level `*.jar`. `mods/`, `plugins/`
     and `config/` are kept; excluding all jars would gut a modded backup.
4. `stat` the archive → insert the row with `sizeBytes`.
5. Prune to keep-N for that kind, deleting file and row together.

### Restore (panel only)

The server must be stopped; the service stops it and remembers whether to
restart afterwards.

- **full** — `data/` is renamed to `data.restoring-<ts>`, a fresh `data/` is
  created and the archive extracted into it. The old directory is kept until
  success, giving restore an undo without a second snapshot. Any failure
  rolls the rename back.
- **world** — only the world directories are replaced in place; the rest of
  `data/` is untouched.

### In-game trigger

Chat gets exactly one command: `!backup [name]`, which takes a **world**
snapshot. Full backups and listing are panel-only.

Rationale for doing this without a mod: a single jar cannot cover all
versions and loaders. Vanilla has no mod API at all; Forge, NeoForge, Fabric
and Paper are four incompatible APIs (NeoForge split from Forge at 1.20.2);
and mappings change per MC version, so one jar spanning many versions means
recompiles or reflection. A real `/backup` slash command would mean
maintaining N jars forever. Reading chat off the log stream and replying over
RCON works on every version and loader, vanilla included, with nothing to
install.

Mechanics:

- `LogStreamService` today holds **one** sink per server (the console
  gateway's). It becomes multi-sink: a ref-counted `Set` of listeners, stream
  torn down when the last one leaves. The console gateway becomes one
  listener of two; its observable behavior does not change.
- The chat watcher subscribes for every server with `chatEnabled`,
  independent of whether a browser is connected.
- Parser handles the loader variants: `[Server thread/INFO]` and
  `[Async Chat Thread - #N/INFO]`, the optional `[Not Secure]` prefix
  (1.19+), and `<player> message`. The player name comes from the log line,
  so chat content cannot spoof it.
- Permission: `data/ops.json` is re-read per command. Non-ops get a refusal.
- Reply via RCON `tellraw <player>`.
- Rate limit per player per server (default one per 5 minutes) so chat cannot
  fill the disk.

### Schedule

Per-server intervals in minutes, not cron — which means no new dependency; a
`setInterval` per server in `backup-schedule.service.ts` is sufficient at
minute granularity. Intervals are (re)registered at boot and whenever a
schedule is saved. Manual and chat backups ignore the schedule but share
retention.

`skipWhenEmpty` uses a two-part rule, because a naive "0 players → skip"
loses the last session: players farm for hours, log off, the next tick sees an
empty server, and nothing is ever snapshotted. Instead, a per-server
`playersSeenSinceLastBackup` flag is set when a tick's RCON `list` reports
more than zero players or the log watcher sees a `joined the game` line, and
cleared when a backup completes. Empty with the flag set → back up anyway.
Empty with the flag clear → skip. Idle servers cost nothing and the last
session always survives.

Player count comes from RCON `list` (`There are 3 of a max of 20 players
online:`), which is identical on vanilla, Paper, Forge and NeoForge.

### Endpoints

`GET|POST /servers/:id/backups`, `DELETE /servers/:id/backups/:backupId`,
`POST /servers/:id/backups/:backupId/restore`,
`GET /servers/:id/backups/:backupId/download`,
`GET|PUT /servers/:id/backups/schedule`.

## Pack install (creation only)

The wizard has two sources of truth for loader and version: manual selects
(Phase 1 behavior, unchanged) or a pack, which decides for itself.

### Transport

A multipart file cannot ride inside the JSON create request, so uploads are
two-step:

- `POST /packs/staging` (multipart) streams to
  `<MC_DATA_ROOT>/_staging/<token>.zip` and returns `{token}`. Tokens expire
  and are swept after 1 hour.
- `CreateServerDto` gains `pack?: { url: string } | { token: string }`. The
  URL case skips the pre-step.

### Create sequence (pack branch of `ServersService.createServer`)

1. The DB row is created first, as today — its id is what gives the staging
   and data paths. Status `installing`.
2. The row returns **immediately**; the install continues in the background.
   A 2 GB pack takes minutes, so the create request cannot block. Progress
   and the terminal result stream over a `/packs` socket room (same handshake
   auth as console and metrics), and `Server.status` settles on `running` or
   `failed` so a page reload recovers the truth.
3. Fetch and classify. Classification reads **zip entry names, not the file
   extension**, so mislabeled downloads self-correct.
4. Resolve loader and MC version, download mods, extract.
5. `docker create` with `toItzgEnv(resolved)` → start → status `running`.
   Staging cleared.
6. Any failure runs the existing `rollback()` plus removal of
   `<MC_DATA_ROOT>/<id>`. No half-built server survives, and the name and
   port free up for an immediate retry.

### The three pack shapes

| Shape              | Detected by                                 | Contains                                               | Action                                                          |
| ------------------ | ------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| Modrinth `.mrpack` | `modrinth.index.json`                       | manifest + `overrides/`; mods are **references**       | download mods (direct URLs, sha512 verified), extract overrides |
| CurseForge pack    | `manifest.json` with `minecraft.modLoaders` | manifest + `overrides/`; mods are project/file **ids** | resolve ids via the CF API, then as above                       |
| Server pack        | populated `mods/`, no manifest              | complete tree, plus loader bootstrap junk              | extract, minus launcher artifacts                               |

Loader and version resolution per shape:

- **mrpack** — `dependencies` gives the MC version and the exact loader
  version. Fully automatic.
- **CurseForge** — `minecraft.version` plus `modLoaders[].id` (e.g.
  `forge-47.2.0`). Requires `CURSEFORGE_API_KEY` (new optional env var);
  absent → the install fails with a clear message. Mods whose authors opted
  out of third-party distribution **cannot** be downloaded: the install
  completes and reports the exact list, which the user drops into `mods/`
  with the file manager.
- **Server pack** — mined from the bootstrap files (below), with the wizard's
  manual selection as the fallback.

### Server-pack handling

_Root offset._ GitHub zips commonly wrap everything in one top-level
directory (`MyPack-1.20.1/mods/...`). If the zip has exactly one top-level
entry and it is a directory holding recognizable server content, strip that
level; otherwise extract at the root.

_Launcher-artifact denylist._ Forge and NeoForge server packs from 1.17 on
ship their own bootstrap, which fights itzg (itzg installs the loader and
owns the start command). Filtered out: `*installer*.jar`, root-level `*.jar`
(`server.jar`, `minecraft_server.*.jar`), `libraries/`, `versions/`,
`run.sh`, `run.bat`, `start.sh`, `start.bat`, `start.command`,
`user_jvm_args.txt`, `*.service`. Everything else extracts as-is: `mods/`,
`config/`, `defaultconfigs/`, `kubejs/`, `scripts/`, `server.properties`,
`ops.json`, an included `world/`.

_Mine before discarding._ Those same artifacts encode the loader version,
which turns a server pack from "the user must know their loader" into
auto-detection:

- `libraries/net/neoforged/neoforge/<ver>/` → NeoForge `<ver>`
- `libraries/net/minecraftforge/forge/<mc>-<ver>/` → Forge, plus the MC version
- `run.sh` / `user_jvm_args.txt` reference the same paths
- `libraries/net/fabricmc/fabric-loader/<ver>/` → Fabric
- a root `fabric-server-launch.jar` or `paper-<mc>-<build>.jar` → loader and build

If mining finds loader and MC version, they are used and pre-filled in the
wizard. If not, the form requires a manual loader and version before create.

Detection is a pure function over the entry-name list, which makes it cheap
to table-test against real pack layouts. `pack-format.ts` exposes
`classify(entries)`, `stripRoot(entries)`, `mineLoader(entries)` and
`isLauncherArtifact(path)`; the installer only sequences them.

### Fabric

Most `.mrpack` files on Modrinth are Fabric, while `LOADERS` today is
vanilla / paper / forge / neoforge. `provisioning.ts` gains `fabric`
(`TYPE=FABRIC`, `FABRIC_LOADER_VERSION`) so pack-declared Fabric installs
work. The manual wizard dropdown is unchanged until Phase 3 adds a Fabric
version fetcher. Without this, Fabric packs would have to be rejected.

## Frontend

Three new modules in the established layered shape (public `index.ts`,
private internals):

```
frontend/src/modules/files/     api.ts hooks.ts components/{FilesTab,FileTable,Breadcrumb,FileEditor,UploadButton,SearchBox}
frontend/src/modules/backups/   api.ts hooks.ts components/{BackupsTab,BackupList,ScheduleForm,RestoreDialog}
frontend/src/modules/packs/     api.ts hooks.ts socket.ts components/{PackSourceStep,InstallProgress}
```

The server detail page gains two tabs; `TabKey` becomes
`'console' | 'metrics' | 'files' | 'backups' | 'settings'`. That is the only
change to the page.

New `@ui` primitives, kept free of feature knowledge: `Checkbox`, `Progress`,
and `ConfirmDialog` composed on the existing `Modal`.

**Files tab.** Breadcrumb plus entry list (name, size, modified), row actions
(open, download, rename, delete), a toolbar (upload, new folder, search,
extract/compress on a selection), and checkbox multi-select with a bulk
action bar. Opening a text file swaps the list for `FileEditor`: a monospace
`<textarea>`, not Monaco — a 2 MB cap and config-file editing do not justify
the bundle. The editor keeps the `mtimeMs` from the GET and sends it on PUT; a
409 surfaces "changed on disk — reload or overwrite". Unsaved changes prompt
on navigation.

**Backups tab.** List grouped by kind with size, age and a trigger badge
(`manual` / `chat` / `schedule`); actions download, delete, restore. Restore
goes through `ConfirmDialog`, stating plainly that it stops the server and
which replacement it performs (whole `data/` versus world directories only).
`ScheduleForm` offers, per kind, a number input with a minutes/hours select
and an off toggle, plus `keepWorld` / `keepFull` inputs clamped 1–20
client-side (re-validated server-side), a `skipWhenEmpty` checkbox, and a
chat-trigger checkbox with a one-line note that `!backup` is op-only.

**Create wizard.** `CreateWizard` gains a source toggle: **Manual** (today's
selects, unchanged) or **Pack** (URL input, or a file picker that POSTs to
`/packs/staging` with upload progress). Submit sends `pack: {url}` or
`pack: {token}`. Create returns `status: 'installing'`, the wizard routes to
the detail page, and `InstallProgress` subscribes to the `/packs` room —
reusing the `modules/metrics/socket.ts` pattern — showing the stage, per-mod
progress, and the blocked-mod list on completion. A reload falls back to
`Server.status`, so socket state is never the only source of truth.

`CreateWizard` importing `@/modules/packs` follows the existing precedent of
it importing `@/modules/versions`; no boundary change is needed.

## Error handling

- Path guard rejections → 400, with the offending path echoed but never the
  resolved absolute path.
- Text read of a binary file → 415, pointing at the download route.
- Concurrent edit → 409 with the on-disk `mtimeMs`.
- Concurrent backup → 409 "backup already running".
- Restore failure → the `data.restoring-<ts>` rename rolls back and the
  server returns to its prior run state.
- Pack install failure → full server rollback (container, row, data root),
  reported over the socket and reflected in `status: 'failed'`.
- `save-on` is guaranteed by `finally` on every backup path.
- CurseForge without an API key, or with distribution-blocked mods → the
  install reports precisely which mods need manual placement.

## Testing

- `files/path.ts` gets the adversarial table: `../`, encoded traversal,
  absolute paths, null bytes, symlink escape, unicode look-alike dots.
- `ServerFsService` and the archive service run against a real tmpdir, not
  mocks — permissions, symlinks and zip slip are only real on a real fs.
- `backups/archive-paths.ts` and `chat-command.ts` are pure table tests, fed
  real log lines and `list` output from each loader.
- `backup.service` is unit-tested with stubbed archive and RCON to assert the
  `save-on`-in-`finally` guarantee, the single-flight lock, retention math,
  and the `skipWhenEmpty` flag rule.
- Restore is tested against a real tmpdir with a real tar archive.
- `packs/pack-format.ts` is table-tested against captured entry lists from
  real mrpack, CurseForge and GitHub server-pack layouts.
- `pack-installer` is tested with a stubbed downloader; `pack-downloader`
  against a local HTTP fixture for caps, timeouts and hash mismatch.
- Frontend: Jest component tests per new component, matching the density of
  `CreateWizard.test.tsx`. Playwright e2e extended with route mocks for the
  files and backups endpoints — browse → edit → save, and create backup →
  restore-confirm.

## Security

- Every filesystem path passes the pure guard, then a realpath prefix check.
- Archive extraction re-guards each entry, with entry-count and
  uncompressed-size caps.
- Upload size caps come from env; uploads stream to a temp file and are
  renamed, never buffered whole in memory.
- Pack downloads have a size cap, a timeout, a redirect limit, and — for
  mrpack — mandatory sha512 verification.
- In-game commands are authorized against `ops.json` at command time and
  rate-limited per player. Chat can create a world backup and nothing else.
- Backups live outside the container mount, so nothing running inside the
  server can read or delete them.
- `CURSEFORGE_API_KEY` is optional, read from env only, and never returned by
  any endpoint.

## Implementation order

Three plans, each shipping something usable on its own:

1. **File manager** — `files/` module, path guard, REST, Files tab. Also the
   `deleteServer` data-root cleanup, since it is the same path handling.
2. **Backups** — schema migration, `backups/` module, the `LogStreamService`
   multi-sink refactor, chat trigger, interval scheduler, Backups tab,
   `backupsMb` in metrics.
3. **Pack install** — `packs/` module, `CreateServerDto` extension, the
   create-flow background install and `/packs` gateway, Fabric in
   `provisioning.ts`, wizard pack step.

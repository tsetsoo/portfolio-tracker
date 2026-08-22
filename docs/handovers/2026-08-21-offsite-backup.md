# Handover — off-device backup for the portfolio database

Written 2026-08-21. Nothing has been built yet; this is the brief.

> **Actioned 2026-08-22.** The on-device half is built, deployed and running:
> `portfolio-backup.timer` takes a verified, rotated daily copy. The encrypted
> off-device push is built and tested end to end but is **not enabled**, because
> it needs a storage account and an encryption key. The owner picked *encrypted
> push to cloud* and confirmed 14 daily + 12 monthly retention.
>
> One correction to the text below: it says the live data directory held **13**
> ad-hoc copies. It held **12** — eleven `portfolio.pre-*.db` plus one
> `portfolio.db.bak-*`. All twelve are now in `backups/archive/`, and
> `/opt/portfolio/data/` contains nothing but `portfolio.db` and `backups/`.
> Nothing was missed.
>
> Live documentation is now **[docs/runbooks/offsite-backup.md](../runbooks/offsite-backup.md)** —
> read that, not this. This file is kept as the record of why.

## The problem

The portfolio database has **no off-device backup and no backup automation**.

Verified on the Pi on 2026-08-21:

```
systemctl list-timers   → portfolio-update, portfolio-snapshot, todo-update only
sudo crontab -l         → empty
crontab -l (pi)         → empty
lsblk                   → / on mmcblk0 (SD card, 59.6G) on a Pi 3 running 24/7
```

`/opt/portfolio/data/` does hold 13 ad-hoc copies (`portfolio.pre-btc-cleanup-…`,
`portfolio.pre-reimport.…`, etc.), but they sit **next to the live database on the
same SD card**. That is version history, not a backup — one card failure takes the
original and all 13 together. Newest is 2026-08-11.

The only off-device copy that exists is a manual pull on the developer's Mac at
`data/backups/portfolio-pi-20260816-214116.db` (gitignored), already days stale.

## Why it matters more than it did last week

`portfolio-snapshot.timer` now records a net-worth snapshot daily. Snapshot writes
are **first-write-wins per date and cannot be backfilled** (`ensureTodaySnapshot`
uses `INSERT OR IGNORE`), so a lost database means permanently lost history — the
same argument that justified adding the timer applies to losing the file.

Holdings and lots can be rebuilt from broker CSVs. Daily history cannot.

Database is ~397KB. This is cheap to solve.

## Environment facts you will need

These were expensive to establish. Trust them rather than re-deriving.

**Host**
- Raspbian Buster (archived), armv7, glibc 2.28, `libstdc++ GLIBCXX_3.4.25`.
- Host Node is 18.20.8 and **cannot be upgraded** — node 20+ armv7 needs
  `GLIBCXX_3.4.26`, and side-loading Bullseye's libstdc++ fails because that needs
  `GLIBC_2.29`. See `deploy/pi/install-node.sh`.
- **`sqlite3` CLI is NOT installed.** Do not plan around it.
- 45G free on `/`.
- This is a home server: homebridge, nginx, docker, pihole, uwsgi, todo,
  tailscaled. Do not disturb them. Do not run a dist-upgrade.
- `tailscaled` is the only remote access path — anything that risks it risks
  locking you out. Reach it at `100.118.255.23`; the `raspberrypi` hostname
  resolves for ssh but has been unreliable for `curl` from the Mac.

**App runtime**
- Runs in a container named `portfolio-app`, image `node:22-bullseye`, started by
  `/opt/portfolio/run-container.sh` which reads the tag from the release's
  `NODE_IMAGE` file. bullseye not bookworm on purpose: Docker is 20.10.5, which
  predates the `clone3` seccomp fix, so glibc >= 2.34 images fail to start.
- Container runs `--user 1000:1000` (pi) with `/opt/portfolio/data` mounted at
  `/data`, so the DB is `/data/portfolio.db` inside, owned by pi outside.

**Deploy pipeline**
- Push to `main` → GitHub Actions armv7 build under QEMU (~20 min) → `pi-latest`
  release → `portfolio-update.timer` (every 2 min) → atomic symlink flip, health
  check (`HEALTH_TIMEOUT=180`), automatic rollback on failure.
- `paths-ignore` covers `docs/**`, `**/*.md`, `.gitignore` — doc-only commits do
  not rebuild. Use `workflow_dispatch` to force one.
- `bootstrap.sh` is **not** re-run automatically. New systemd units must be
  `scp`'d and `install`'d by hand as well as added to `bootstrap.sh`.

## Proposed approach

1. **Consistent copy, not `cp`.** Copying a live SQLite file can capture a torn
   write. Use the driver's backup API through the running container:
   ```
   docker exec portfolio-app node -e "
     const D=require('/app/node_modules/better-sqlite3');
     const db=new D('/data/portfolio.db',{readonly:true});
     db.backup('/data/backups/portfolio-<stamp>.db').then(()=>db.close());"
   ```
   Confirmed against the installed better-sqlite3 **12.11.1**: `db.backup(path)`
   exists and returns a **Promise**; round-tripped a real copy of the live
   database and the result passed `integrity_check` with all 20 holdings intact.
   Verify every copy that way before treating it as good.
2. **`portfolio-backup.{service,timer}`** modelled on the existing
   `portfolio-snapshot` pair in `deploy/pi/`. Daily, offset from 00:12 so it runs
   *after* the snapshot lands.
3. **Rotate** — keep N daily copies, prune the rest, same shape as
   `KEEP_RELEASES` in `portfolio-update.sh`.
4. **Get it off the device.** A local rotated copy still dies with the card. Needs
   a real destination — see open questions.
5. **Tidy the 13 loose `pre-*.db` files** into the rotated directory rather than
   leaving them beside the live DB.

## Open questions for the owner

Do not guess these.

- **Where off-device?** The Mac over Tailscale is nearest to hand but is not
  always on, so a Pi-side push will fail intermittently and a Mac-side pull only
  runs when the Mac is awake. Another always-on tailnet host or a cloud bucket is
  more reliable.
- **Cloud means credentials on the Pi, and this is financial data.** If the answer
  is cloud, it should be encrypted at rest before it leaves the device, and the
  key must not live only on the Pi.
- **Retention?** Suggest 14 daily + a monthly, but confirm.
- **Should the timer fail loudly?** Recommend yes — a silent backup failure is
  worse than none, and `portfolio-snapshot.service` already sets the precedent of
  returning non-zero so it surfaces in `journalctl`.

## How to verify

- Run the unit manually first: `sudo systemctl start portfolio-backup.service`,
  then check `journalctl -u portfolio-backup` and `systemctl show -p Result`.
- Confirm the copy opens and passes `integrity_check`, and that row counts match
  the live DB (`holdings`, `lots`, `snapshots`, `import_batches`).
- Confirm the off-device copy actually arrived — the failure mode to guard is a
  backup that reports success while writing nowhere.
- Confirm rotation prunes, by running it more times than the retention count.
- Confirm the app kept serving throughout (`curl -fsS http://127.0.0.1:8081/`).

## Do not

- Do not `cp` the live database as the primary mechanism.
- Do not touch `.claude/worktrees/price-alerts` — as of 2026-08-21 it was locked
  by a live session with 10 unmerged commits.
- Do not dist-upgrade the host to get a newer sqlite/Node. See install-node.sh.

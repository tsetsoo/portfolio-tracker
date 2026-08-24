# Runbook — backing up the portfolio database

## What runs now

| Unit | When | What it does |
|---|---|---|
| `portfolio-backup.timer` | daily 00:30 | Consistent copy of `portfolio.db`, verified, rotated. **Live.** |
| `portfolio-backup-offsite.timer` | daily 00:45 | Encrypts the newest copy and pushes it off the device. **Needs setup — see below.** |

Backups live in `/opt/portfolio/data/backups/`:

```
daily/     14 most recent           portfolio-2026-08-22-003020.db
monthly/   12 most recent           first backup of each month (hardlinked from daily/)
archive/   the 12 old ad-hoc pre-*.db copies, swept out of the live data dir
```

The copy is made with better-sqlite3's backup API **inside the app container**,
not `cp` — copying a live SQLite file can capture a torn write. The container is
the only sqlite on the box: the `sqlite3` CLI is not installed and the host Node
is pinned at 18, so it cannot load the container's native module.

Every copy is opened, `integrity_check`ed and row-counted before it is allowed
to count. Both units let a non-zero exit stand, so failures show up in
`journalctl` rather than passing silently.

## Setting up the offsite push

The push is deliberately **not** enabled by default: it needs a storage account
and an encryption key, and an unconfigured unit failing every night just teaches
you to ignore the journal.

### The key model, before you start

The backup is encrypted **before it leaves the Pi**, with an asymmetric key:

- the **public** key lives on the Pi and can only encrypt;
- the **private** key never touches the Pi, so a compromise of the Pi — or of
  the storage provider — leaks nothing.

`portfolio-backup-offsite.sh` refuses to run if it finds the private key on the
host, because that would quietly void the whole design.

> **Losing the private key loses every backup.** Nothing on the Pi can decrypt
> them. Escrow it somewhere durable that is not the Pi and not solely the Mac —
> a password manager entry is the obvious home, ideally plus a printed or
> offline copy.

### 1. Generate the backup keypair (on the Mac, not the Pi)

```bash
gpg --quick-generate-key "Portfolio Backup <you@example.com>" default default never
FPR=$(gpg --list-keys --with-colons "Portfolio Backup" | awk -F: '/^fpr/{print $10; exit}')
echo "$FPR"
```

Use a passphrase you will not lose. Then back the private key up **before**
relying on it:

```bash
gpg --export-secret-keys --armor "$FPR" > ~/portfolio-backup-private.asc
# put the contents in your password manager, then:
rm ~/portfolio-backup-private.asc
```

### 2. Put the public half on the Pi

```bash
gpg --export --armor "$FPR" > /tmp/pub.asc
scp /tmp/pub.asc pi@100.118.255.23:/tmp/pub.asc
ssh pi@100.118.255.23 'gpg --import /tmp/pub.asc && rm /tmp/pub.asc'
```

Confirm the Pi has the public key and *not* the private one:

```bash
ssh pi@100.118.255.23 'gpg --list-keys "Portfolio Backup"; gpg --list-secret-keys "Portfolio Backup" || echo "no secret key — correct"'
```

### 3. Configure the storage remote

`rclone` is already installed at `/opt/portfolio/bin/rclone`. It is
provider-agnostic — Backblaze B2, S3, Cloudflare R2, Google Drive and so on are
all just a config entry. B2 is the cheap obvious pick for ~400KB a night.

`/opt/portfolio` is root-owned, and the config will hold provider credentials
and must be readable by the service, which runs as `pi`. So create it as `pi`
with `0600` *first*, then let rclone populate it:

```bash
ssh pi@100.118.255.23 'sudo install -o pi -g pi -m 0600 /dev/null /opt/portfolio/rclone.conf'
```

`rclone config` is interactive, so run it yourself (`-t` for a TTY):

```bash
ssh -t pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.conf config'
```

Check the ownership survived — root-owned here means the nightly push fails on
an opaque rclone permission error:

```bash
ssh pi@100.118.255.23 'ls -l /opt/portfolio/rclone.conf'   # want: -rw------- pi pi
```

Create a remote (call it `offsite`), then make the bucket/path and check it:

```bash
ssh pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.conf mkdir offsite:your-bucket/portfolio'
ssh pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.conf lsd offsite:'
```

### 4. Write the config file

On the Pi, as root:

```bash
sudo tee /etc/portfolio-backup-offsite.env >/dev/null <<EOF
OFFSITE_REMOTE="offsite:your-bucket/portfolio"
GPG_RECIPIENT="<the fingerprint from step 1>"
OFFSITE_KEEP=30
OFFSITE_KEEP_MONTHLY=12
EOF
sudo chmod 0644 /etc/portfolio-backup-offsite.env
```

### 5. Run it once by hand, then enable the timer

```bash
sudo systemctl start portfolio-backup-offsite.service
journalctl -u portfolio-backup-offsite -n 20 --no-pager
sudo systemctl enable --now portfolio-backup-offsite.timer
```

A good run looks like:

```
offsite: newest local backup portfolio-2026-08-24-003137.db is 10h old
offsite: pushed daily portfolio-2026-08-24-003137.db.gpg (421888 -> 61942 bytes, sha256 e6cf5646f5b04b59…)
offsite: daily: 3 kept
offsite: pushed monthly portfolio-2026-08-23-094534.db.gpg (413696 -> 61941 bytes, sha256 03ab2d05ba308d9d…)
offsite: monthly: 1 kept
offsite: ok — offsite:your-bucket/portfolio
```

The remote mirrors the Pi — `daily/` and `monthly/` under `$OFFSITE_REMOTE`.
The monthlies go off-device too: keeping them only as hardlinks on the SD card
whose failure this whole feature exists to survive would defeat the reason for
having them. Only monthlies not already at the far end are uploaded, so after
the first run this is one extra listing a night and a real upload about once a
month.

The age line exists because `MAX_AGE_HOURS` deliberately tolerates one missed
local backup. Without it, re-pushing yesterday's file under a name that already
exists looks identical to a fresh push — the object is overwritten, the count
does not grow, and the run still ends in `ok`.

The push does not trust rclone's exit code: it lists the object at the far end,
compares the size, then reads the bytes back and compares a sha256. The failure
it exists to catch is an upload that reports success while writing nowhere.

## Restoring

Run the drill from the Mac, where the private key lives — the Pi cannot do this:

```bash
OFFSITE_REMOTE="offsite:your-bucket/portfolio" ./deploy/restore-offsite.sh
```

It fetches the newest `daily/` object, decrypts it, and refuses anything that is
not a SQLite database passing `integrity_check`. A bare filename is looked for
in both tiers; to go further back, name a monthly explicitly:

```bash
OFFSITE_REMOTE="offsite:your-bucket/portfolio" \
  ./deploy/restore-offsite.sh monthly/portfolio-2026-07-01-003012.db.gpg
``` It prints row counts and the latest
snapshot date so you can see at a glance how current the copy is.

**Do this occasionally, not just in an emergency.** A backup nobody has ever
restored is a hypothesis. It also needs `rclone` on the Mac (`brew install
rclone`); to skip that, pass a local `.gpg` path instead.

To actually put a restored file back:

```bash
ssh pi@100.118.255.23 'sudo systemctl stop portfolio'
scp data/restore/portfolio-<stamp>.db pi@100.118.255.23:/tmp/restored.db
# The pre-restore copy is named portfolio.pre-* on purpose: that is the pattern
# the backup script's sweep recognises, so it gets filed into backups/archive/
# on the next run instead of sitting next to the live database forever.
ssh pi@100.118.255.23 'cp /opt/portfolio/data/portfolio.db \
       "/opt/portfolio/data/portfolio.pre-restore-$(date +%Y%m%dT%H%M%S).db" \
  && mv /tmp/restored.db /opt/portfolio/data/portfolio.db \
  && chown pi:pi /opt/portfolio/data/portfolio.db \
  && sudo systemctl start portfolio'
```

Keep the file you replaced. Holdings and lots can be rebuilt from broker CSVs;
daily snapshot history cannot — `ensureTodaySnapshot` is first-write-wins per
date and does not backfill.

## Checking on it

```bash
systemctl list-timers 'portfolio-*' --no-pager
journalctl -u portfolio-backup --since "7 days ago" --no-pager
journalctl -u portfolio-backup-offsite --since "7 days ago" --no-pager
ls -lt /opt/portfolio/data/backups/daily/ | head
```

The offsite unit also fails if the newest local backup is more than 25 hours old
(`MAX_AGE_HOURS`), so a broken local backup surfaces from this side too instead
of the same stale file being pushed every night under a green light.

## Deploying changes to these units

`bootstrap.sh` is **not** re-run by the deploy pipeline, and `deploy/**` is not
in the release tarball. Changes to any of these scripts or units have to be
copied over by hand:

```bash
scp deploy/pi/portfolio-backup.sh deploy/pi/portfolio-backup-offsite.sh pi@100.118.255.23:/tmp/
ssh pi@100.118.255.23 'sudo install -o root -g root -m 0755 /tmp/portfolio-backup.sh /opt/portfolio/portfolio-backup.sh
                       sudo install -o root -g root -m 0755 /tmp/portfolio-backup-offsite.sh /opt/portfolio/portfolio-backup-offsite.sh'
# unit files, if changed — install every one you copied, or daemon-reload runs
# against files that never changed and the edit silently does nothing:
scp deploy/pi/portfolio-backup*.{service,timer} pi@100.118.255.23:/tmp/
ssh pi@100.118.255.23 'for u in portfolio-backup.service portfolio-backup.timer \
                                portfolio-backup-offsite.service portfolio-backup-offsite.timer; do
                         sudo install -m 0644 "/tmp/$u" "/etc/systemd/system/$u"
                       done
                       sudo systemctl daemon-reload'
```

After changing a `.timer`, `daemon-reload` alone does not re-arm it — restart it:

```bash
ssh pi@100.118.255.23 'sudo systemctl restart portfolio-backup.timer'
```

## Known wart

rclone v1.75.0 on armv7 prints ~18 `internal error: no overview data found for
<provider>` lines at ERROR level on every invocation. They are cosmetic, from a
missing docs table in that build. `portfolio-backup-offsite.sh` filters exactly
that string so the noise cannot bury a real failure; everything else on stderr
is preserved.

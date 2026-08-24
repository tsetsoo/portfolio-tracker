# Runbook — backing up the portfolio database

`portfolio-backup.timer` runs daily at 00:30, after the snapshot has landed. It
makes a consistent copy, verifies it, keeps 14 locally, and — once configured —
encrypts it and uploads it, keeping 365 remotely.

```
/opt/portfolio/data/backups/portfolio-2026-08-24-003137.db   14 most recent
/opt/portfolio/data/backups/archive/                         old ad-hoc pre-*.db copies
```

Without a bucket configured it still takes the local copy every night. That is
better than nothing, but a copy on the same SD card as the original is not a
backup — finish the setup below.

## Why it is not just `rsync`

The app writes to the database on every dashboard load, and in rollback-journal
mode SQLite modifies the file in place during a transaction, so a raw copy taken
mid-write is a corrupt database. The copy goes through SQLite's backup API via
`python3` — stdlib, nothing to install — and is then opened and
`integrity_check`ed before it counts. Everything after that is a plain file
copy.

Note the host's SQLite is 3.27 (Buster) while the app's is newer. It reads
today's schema fine; if the schema ever adopts something newer (generated
columns, STRICT tables) this would fail loudly at verification rather than
silently produce a bad copy.

## Setting up the off-device upload

The data is encrypted before it leaves, to a **public** key — so the Pi cannot
read its own backups, and a compromise of the Pi or the bucket leaks nothing.

> **Losing the private key loses the backups.** Nothing on the Pi can decrypt
> them. Keep it in your password manager.

### 1. Make the backup keypair (on your Mac, not the Pi)

```bash
gpg --quick-generate-key "Portfolio Backup <you@example.com>" default default never
FPR=$(gpg --list-keys --with-colons "Portfolio Backup" | awk -F: '/^fpr/{print $10; exit}')
gpg --export-secret-keys --armor "$FPR" > ~/portfolio-backup-private.asc
# paste that into your password manager, then:
rm ~/portfolio-backup-private.asc
```

### 2. Give the Pi the public half only

```bash
gpg --export --armor "$FPR" > /tmp/pub.asc
scp /tmp/pub.asc pi@100.118.255.23:/tmp/pub.asc
ssh pi@100.118.255.23 'gpg --import /tmp/pub.asc && rm /tmp/pub.asc'
# confirm it has no secret key — the script refuses to run if it does
ssh pi@100.118.255.23 'gpg --list-secret-keys "Portfolio Backup" || echo "no secret key — correct"'
```

### 3. Point rclone at a bucket

`rclone` is already at `/opt/portfolio/bin/rclone`. Create the config as `pi`
first — `/opt/portfolio` is root-owned and the service runs as `pi`:

```bash
ssh pi@100.118.255.23 'sudo install -o pi -g pi -m 0600 /dev/null /opt/portfolio/rclone.conf'
ssh -t pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.conf config'
```

Pick `s3` and give it an access key with write access to one bucket. Then:

```bash
ssh pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.conf lsd s3:'
```

#### Google Drive instead of S3

Works the same — `REMOTE` is just an rclone path, so nothing in the script
changes. But Drive uses OAuth, and the Pi has no browser, so authorise on the
Mac and carry the token over:

```bash
brew install rclone          # also needed for the restore drill below
rclone authorize "drive"     # opens a browser, prints a token blob
```

Then on the Pi run `rclone config`, choose `drive`, accept the default scope,
and when it asks **"Use auto config?" answer `n`** — that is the headless path —
then paste the token from the Mac. Check it:

```bash
ssh pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.conf lsd drive:'
```

Set `REMOTE="drive:portfolio-backups"` in step 4. Three Drive-specific things
S3 does not do:

- **The token is refreshed in place**, so `/opt/portfolio/rclone.conf` has to
  stay writable by `pi` (it is, if you created it as in step 3). Make it
  root-owned and Drive backups break in a way S3 credentials would not.
- **Tokens can be revoked** — a password change or long inactivity — and then
  backups fail nightly until you re-authorise. S3 access keys do not expire.
- **Pruned files go to Drive's trash** and still count against quota for 30
  days. At ~60KB a copy this is a rounding error; add
  `--drive-use-trash=false` to the prune if it ever matters.

rclone's built-in Drive client ID is shared and rate-limited. At one 60KB upload
a night that is fine; if you ever see quota errors, create your own OAuth client
ID (rclone's docs cover it).

### 4. Write the config and run it

```bash
sudo tee /etc/portfolio-backup.env >/dev/null <<'EOF'
REMOTE="s3:your-bucket/portfolio"
GPG_RECIPIENT="<the fingerprint from step 1>"
EOF
sudo systemctl start portfolio-backup.service
journalctl -u portfolio-backup -n 10 --no-pager
```

A good run:

```
backup: verified — 11 snapshots, newest 2026-08-24
backup: uploaded portfolio-2026-08-24-003137.db.gpg (62457 bytes)
backup: ok — 14 local, 37 remote
```

At ~60KB a night, a year in S3 is about 20MB and costs pennies.

## Restoring

From your Mac, where the private key lives — the Pi cannot do this:

```bash
REMOTE="s3:your-bucket/portfolio" ./deploy/restore-offsite.sh
```

It fetches the newest, decrypts it, and refuses anything that is not a database
passing `integrity_check`. Pass a filename to get an older one, or a local
`.gpg` path to skip rclone entirely.

**Do this occasionally, not just in an emergency.** A backup nobody has restored
is a hypothesis.

To put a restored file back:

```bash
ssh pi@100.118.255.23 'sudo systemctl stop portfolio'
scp data/restore/portfolio-<stamp>.db pi@100.118.255.23:/tmp/restored.db
ssh pi@100.118.255.23 'cp /opt/portfolio/data/portfolio.db \
       "/opt/portfolio/data/portfolio.pre-restore-$(date +%Y%m%dT%H%M%S).db" \
  && mv /tmp/restored.db /opt/portfolio/data/portfolio.db \
  && chown pi:pi /opt/portfolio/data/portfolio.db && chmod 600 /opt/portfolio/data/portfolio.db \
  && sudo systemctl start portfolio'
```

Keep the file you replace. Holdings and lots can be rebuilt from broker CSVs;
daily snapshot history cannot — `ensureTodaySnapshot` is first-write-wins per
date and does not backfill.

## Checking on it

```bash
systemctl list-timers 'portfolio-*' --no-pager
journalctl -u portfolio-backup --since "7 days ago" --no-pager
```

Failures are non-zero exits, so they show up as failed units. Nothing alerts
you, though — you have to look, or wire up an `OnFailure=`.

## Deploying changes

`bootstrap.sh` is not re-run by the deploy pipeline and `deploy/` is not in the
release tarball, so these are copied by hand:

```bash
scp deploy/pi/portfolio-backup.sh pi@100.118.255.23:/tmp/
ssh pi@100.118.255.23 'sudo install -o root -g root -m 0755 /tmp/portfolio-backup.sh /opt/portfolio/portfolio-backup.sh'
# unit or timer changed:
scp deploy/pi/portfolio-backup.{service,timer} pi@100.118.255.23:/tmp/
ssh pi@100.118.255.23 'sudo install -m 0644 /tmp/portfolio-backup.service /etc/systemd/system/ \
  && sudo install -m 0644 /tmp/portfolio-backup.timer /etc/systemd/system/ \
  && sudo systemctl daemon-reload && sudo systemctl restart portfolio-backup.timer'
```

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

`rclone` is already at `/opt/portfolio/bin/rclone`. Its config lives in
`/opt/portfolio/rclone.d/`, a directory `pi` owns — **not** directly in
`/opt/portfolio`, which is root-owned. rclone saves config by writing a temp
file beside it and renaming, so a pi-writable file in a root-owned directory is
not enough; you get `permission denied ... failed to create temp file`. This
matters beyond setup: Drive refreshes its OAuth token and writes it back, so
getting this wrong breaks the backup every night, not just once.

```bash
ssh pi@100.118.255.23 'sudo install -d -o pi -g pi -m 0700 /opt/portfolio/rclone.d'
ssh -t pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.d/rclone.conf config'
```

Pick `s3` and give it an access key with write access to one bucket. Then:

```bash
ssh pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.d/rclone.conf lsd s3:'
```

#### Google Drive instead of S3

Works the same — `REMOTE` is just an rclone path, so nothing in the script
changes. But Drive uses OAuth, and the Pi has no browser, so authorise on the
Mac and carry the token over:

```bash
brew install rclone          # also needed for the restore drill below
rclone authorize "drive" --drive-scope=drive.file
```

`drive.file` matters: it limits the token to files rclone itself created, so
these credentials cannot read the rest of your Drive. Verify afterwards with
`rclone lsd drive:` from the Mac — run against your Drive *root*, it should list
only the backups folder.

Then create the remote on the Pi with that token. Note the explicit binary path
(rclone is not on `pi`'s `PATH`) and `--config` (without it rclone writes to
`~/.config/rclone/`, which the backup never reads):

```bash
ssh pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.d/rclone.conf \
  config create drive drive scope=drive.file token='"'"'<PASTE THE TOKEN JSON>'"'"' --non-interactive'
```

Check it:

```bash
ssh pi@100.118.255.23 '/opt/portfolio/bin/rclone --config /opt/portfolio/rclone.d/rclone.conf lsd drive:'
```

Set `REMOTE="drive:portfolio-backups"` in step 4. Three Drive-specific things
S3 does not do:

- **The token is refreshed in place**, so `/opt/portfolio/rclone.d/` has to
  stay writable by `pi` (it is, if you created it as in step 3). Make it
  root-owned and Drive backups break in a way S3 credentials would not.
- **Tokens can be revoked** — a password change or long inactivity — and then
  backups fail nightly until you re-authorise. S3 access keys do not expire.
- **Pruned files go to Drive's trash** and still count against quota for 30
  days. At ~60KB a copy this is a rounding error; add
  `--drive-use-trash=false` to the prune if it ever matters.

> **Deadline: make your own OAuth client ID during 2026.** rclone warns on every
> Drive run that its shared client ID "is being retired and will stop working
> during 2026". When it goes, uploads fail and the backup stops. Creating your
> own is a few minutes in the Google Cloud console —
> <https://rclone.org/drive/#making-your-own-client-id> — then re-run
> `rclone authorize "drive" --drive-scope=drive.file` with
> `--drive-client-id`/`--drive-client-secret` and replace the token.

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

Failures are non-zero exits, so they show up as failed units — **and they send a
Telegram message.** `portfolio-backup.service` and `portfolio-snapshot.service`
both carry `OnFailure=portfolio-alert@%n.service`, which posts the unit name,
its result and the last dozen journal lines through the same bot the alerts
feature uses (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` in
`/opt/portfolio/portfolio.env`). No new credential.

Any other unit can opt in the same way. The notifier is best-effort and always
exits 0 — it runs *because* something already failed, so it must never compound
it; if the token is missing it says so in the journal and gives up.

To test it end to end, make the unit fail on purpose and check your phone:

```bash
ssh pi@100.118.255.23 'sudo cp /etc/portfolio-backup.env /tmp/env.bak
  echo "KEEP_REMOTE=0" | sudo tee -a /etc/portfolio-backup.env >/dev/null
  sudo systemctl start portfolio-backup.service || true
  sleep 5; sudo journalctl -u "portfolio-alert@portfolio-backup.service.service" -n 3 --no-pager --output=cat
  sudo cp /tmp/env.bak /etc/portfolio-backup.env && sudo rm /tmp/env.bak
  sudo systemctl reset-failed portfolio-backup.service'
```

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

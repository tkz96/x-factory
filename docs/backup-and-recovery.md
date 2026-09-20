# SQLite Database & Artifact Backup and Disaster Recovery Procedure (XFM-72)

This document establishes the operational backup and disaster recovery protocols for `tkz96/x-factory`.

---

## 1. Overview & SQLite WAL Mode Mechanics

X-Factory uses SQLite with **Write-Ahead Logging (`PRAGMA journal_mode=WAL;`)**. In WAL mode:
- Reader connections do not block writer connections, and writers do not block readers.
- Commits are appended to a auxiliary `-wal` file rather than written directly to the main `.db` file.
- **CRITICAL WARNING**: Never use raw file copy utilities (`cp`, `rsync`, `scp`) on a live SQLite WAL database. Copying an active `.db` file without copying `-wal` and `-shm` simultaneously while writes occur results in a torn snapshot and permanent database corruption.

---

## 2. Backup Methods

### 2.1 Live Atomic Database Snapshot (`VACUUM INTO`)
The primary backup mechanism in X-Factory utilizes SQLite's native `VACUUM INTO ?` command, implemented in `src/db/backup.ts`:
- Flushes the active WAL journal.
- Produces a self-contained, vacuumed, defragmented SQLite database file.
- Guarantees transactional consistency without locking the running API or worker processes.
- Executes automated `PRAGMA integrity_check;` validation immediately after backup creation.

### 2.2 Artifacts Filesystem Backup
In addition to the database, run artifacts (worktree diffs, test logs, inspection dumps) stored under `~/.x-factory/artifacts/` are packaged into timestamped tarballs (`tar -czf`).

---

## 3. Automated Backup Execution

### Running via CLI
To perform an on-demand or automated backup:
```bash
bun scripts/backup.ts
```
To specify a custom backup directory:
```bash
BACKUP_DIR=/mnt/secure-backups bun scripts/backup.ts
```

### Scheduling Backups (Cron / Systemd Timer)
Run daily or hourly via cron:
```cron
# Backup X-Factory every 6 hours
0 */6 * * * cd /Users/talhazuberi/x-factory && BACKUP_DIR=/var/backups/x-factory bun scripts/backup.ts >> /var/log/x-factory-backup.log 2>&1
```

---

## 4. Disaster Recovery & Restoration Procedure

To restore from a backup:

### Step 1: Stop Application & Worker Processes
```bash
kill -TERM $(pgrep -f "bun.*server.ts")
kill -TERM $(pgrep -f "bun.*worker.ts")
```

### Step 2: Verify Backup File Integrity
Before restoring, verify the integrity of your backup file:
```bash
bun -e "
import { createDatabase } from './src/db/connection.js';
const db = createDatabase({ path: '/path/to/backup.db', readonly: true });
console.log(db.query('PRAGMA integrity_check;').get());
db.close();
"
```
Output must be `{ integrity_check: "ok" }`.

### Step 3: Restore Database File
Use the built-in `restoreDatabase` utility or replace the live database:
```bash
bun -e "
import { restoreDatabase } from './src/db/backup.js';
import { getDbPath } from './src/paths.js';
await restoreDatabase('/path/to/backup.db', getDbPath());
console.log('Restoration complete.');
"
```

### Step 4: Restore Artifacts Directory
```bash
tar -xzf /path/to/x-factory-artifacts-<timestamp>.tar.gz -C ~/.x-factory/
```

### Step 5: Start Service & Verify Readiness
```bash
# Start server
bun run src/server.ts &

# Verify readiness probe returns HTTP 200
curl -i http://localhost:3777/api/ready
```

---

## 5. Recovery Objectives

- **RPO (Recovery Point Objective)**: Maximum 6 hours (with default cron schedule) or configurable down to 15 minutes.
- **RTO (Recovery Time Objective)**: Under 60 seconds (verified via `restoreDatabase`).

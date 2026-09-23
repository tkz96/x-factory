# How to Back Up and Restore the Database

This guide describes how to back up and restore the SQLite database and run artifacts.
Follow these steps to generate consistent snapshots and recover from data loss.

## Overview of Write-Ahead Logging Backups

X-Factory uses SQLite in Write-Ahead Logging (WAL) mode.
Do not use standard copy utilities such as `cp` or `rsync` on active database files.
Raw file copies on active WAL files cause database corruption.
Use the built-in backup script to generate consistent snapshots with `VACUUM INTO`.

## How to Create an On-Demand Backup

1. Open your terminal.
2. Navigate to the project root directory.
3. Run the backup script:

```bash
bun scripts/backup.ts
```

To specify a custom backup directory, set the `BACKUP_DIR` variable:

```bash
BACKUP_DIR=/mnt/secure-backups bun scripts/backup.ts
```

4. Confirm that the script outputs a success confirmation:

```text
Database backup complete: .../backup-<timestamp>.db
Artifacts archive complete: .../artifacts-<timestamp>.tar.gz
```

## How to Schedule Automated Backups

Configure a cron schedule to execute automated backups.
Open your crontab editor:

```bash
crontab -e
```

Add this line to execute a backup every six hours:

```cron
0 */6 * * * cd /Users/talhazuberi/x-factory && BACKUP_DIR=/var/backups/x-factory bun scripts/backup.ts >> /var/log/x-factory-backup.log 2>&1
```

Save and close the editor.

## How to Restore from a Backup

Follow these steps to restore the database and run artifacts after a disaster.

### Step 1: Stop All Running Processes

Stop the API server and worker processes before you replace database files:

```bash
kill -TERM $(pgrep -f "bun.*server.ts")
kill -TERM $(pgrep -f "bun.*worker.ts")
```

### Step 2: Verify Backup File Integrity

Check the integrity of your backup file before restoration:

```bash
bun -e "
import { createDatabase } from './src/db/connection.js';
const db = createDatabase({ path: '/path/to/backup.db', readonly: true });
console.log(db.query('PRAGMA integrity_check;').get());
db.close();
"
```

Verify that the command outputs `{ integrity_check: "ok" }`.
Do not proceed if the integrity check fails.

### Step 3: Restore the Database File

Run the database restoration utility:

```bash
bun -e "
import { restoreDatabase } from './src/db/backup.js';
import { getDbPath } from './src/paths.js';
await restoreDatabase('/path/to/backup.db', getDbPath());
console.log('Restoration complete.');
"
```

### Step 4: Restore the Artifacts Directory

Extract the compressed artifact archive to the application data directory:

```bash
tar -xzf /path/to/x-factory-artifacts-<timestamp>.tar.gz -C ~/.x-factory/
```

### Step 5: Start Services and Verify Readiness

1. Start the API server:

```bash
bun run src/server.ts &
```

2. Send a request to the readiness endpoint:

```bash
curl -i http://localhost:3777/api/ready
```

3. Confirm that the endpoint returns HTTP status `200 OK`.
4. Start the background worker:

```bash
bun run src/worker.ts &
```

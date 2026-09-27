# Apex Codex Core

A local-first Node.js command engine for private decision journaling, asynchronous delegation, capacity reviews, hash-chain verification, and local backups. It uses only Node.js built-in modules and makes no network requests.

## Quick setup

Requires Node.js 20 or newer.

```sh
npm install
npm run start
```

With no arguments, the CLI displays the available commands. The included `sovereign.config.json` keeps the event ledger, backups, and summaries in this project directory.

Initialize the local ledger and verify that the workspace is ready with the one-command deployment check:

```sh
npm run deploy
```

## Core workflows

Record a decision. Capacity and focus check-ins are optional, private, and never used to block an action:

```sh
npm run start -- decision add --title "Choose launch scope" --choice "Ship the core workflow" --rationale "Protect the release date" --priority strategic --capacity 3 --focus 4
npm run start -- decision list
npm run verify
```

Delegate asynchronously, then review the current commitments and weighted load:

```sh
npm run start -- delegate add --title "Review launch copy" --owner "Operations" --due 2026-10-02 --priority standard --notes "Return edits asynchronously"
npm run start -- delegate list
npm run start -- delegate complete --id <delegation-id>
```

Generate the current week's local Markdown report and create a manual backup when needed:

```sh
npm run summary
npm run backup
```

Every decision and delegation event is appended to `data/events.jsonl` with a SHA-256 hash linked to the previous event. `npm run verify` checks the chain before records are changed. When enabled, a local snapshot is created after each write, with retention controlled by `backups.keepLatest`.

## Configuration

Edit `sovereign.config.json` to set:

- `storage`: local event ledger path.
- `priorityMatrix`: positive weights used to calculate delegation load.
- `capacityCheckIns`: optional 1–5 capacity scale. Values are recorded only when explicitly supplied.
- `backups`: local snapshot location, automatic-on-write behavior, and retention.
- `weeklySummary`: local report path and scheduler guidance.

To automate weekly report generation, schedule `npm run summary` with Windows Task Scheduler, cron, or your operating system's equivalent. The CLI itself does not run as a background service. For example, run it weekly from this project directory so its configuration and output paths resolve correctly.

## Privacy and integrity boundaries

Records are stored locally and are not transmitted by this tool. Protect the machine and any backup media that contain the files. The hash chain detects edits, deletions, and reordering that break the links; it cannot detect tail truncation unless you compare it with a separately protected checkpoint. It is not a signature and cannot prove who created an entry. Someone able to rewrite the whole ledger can also recompute its hashes. Keep copies in a separately protected location if you need stronger recovery guarantees.

This starter is an operational journaling tool, not legal, clinical, or emergency guidance. Capacity and focus fields are optional self-reflection inputs, not diagnoses or performance scores.

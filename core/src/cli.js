import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const genesisHash = "0".repeat(64);

function withinRoot(relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error(`${label} must be a non-empty path`);
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must resolve to a path inside the project directory`);
  }
  return resolved;
}

async function readConfig() {
  const configPath = withinRoot("sovereign.config.json", "Configuration file");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (!config.storage?.ledgerFile || !config.priorityMatrix || !config.backups || !config.weeklySummary) {
    throw new Error("sovereign.config.json is missing required storage, priorityMatrix, backups, or weeklySummary settings");
  }
  if (!config.capacityCheckIns?.scale || !Number.isInteger(config.capacityCheckIns.scale.minimum) ||
      !Number.isInteger(config.capacityCheckIns.scale.maximum) ||
      config.capacityCheckIns.scale.minimum >= config.capacityCheckIns.scale.maximum) {
    throw new Error("capacityCheckIns.scale must define integer minimum and maximum values");
  }
  if (!Number.isInteger(config.backups.keepLatest) || config.backups.keepLatest < 1) {
    throw new Error("backups.keepLatest must be a positive integer");
  }
  return config;
}

function parseOptions(tokens) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--") || !token.slice(2)) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    if (options[key] !== undefined) throw new Error(`--${key} may only be provided once`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function required(options, key) {
  const value = options[key]?.trim();
  if (!value) throw new Error(`Missing required option: --${key}`);
  return value;
}

function priorityWeight(config, priority = "standard") {
  const weight = config.priorityMatrix[priority];
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error(`Unknown priority "${priority}". Choose: ${Object.keys(config.priorityMatrix).join(", ")}`);
  }
  return weight;
}

async function readLedger(config) {
  const directory = withinRoot(config.storage.directory ?? "./data", "storage.directory");
  const ledgerPath = withinRoot(path.join(config.storage.directory ?? "./data", config.storage.ledgerFile), "Ledger file");
  let content;
  try {
    content = await fs.readFile(ledgerPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { directory, ledgerPath, events: [] };
    throw error;
  }
  const events = [];
  let previousHash = genesisHash;
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Ledger line ${index + 1} is not valid JSON`);
    }
    const { hash, ...record } = event;
    const expectedHash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
    if (record.prevHash !== previousHash || hash !== expectedHash) {
      throw new Error(`Ledger verification failed at line ${index + 1}; do not append to a modified ledger`);
    }
    events.push(event);
    previousHash = hash;
  }
  return { directory, ledgerPath, events };
}

async function backup(config, ledgerPath) {
  if (!config.backups.enabled) return;
  const backupDirectory = withinRoot(config.backups.directory, "backups.directory");
  await fs.mkdir(backupDirectory, { recursive: true });
  const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
  const snapshots = entries
    .filter((entry) => entry.isDirectory() && /^snapshot-\d{8}T\d{9}Z$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const snapshot = path.join(backupDirectory, `snapshot-${stamp}`);
  await fs.mkdir(snapshot);
  try {
    await fs.copyFile(ledgerPath, path.join(snapshot, path.basename(ledgerPath)));
    for (const oldSnapshot of snapshots.slice(config.backups.keepLatest - 1)) {
      await fs.rm(path.join(backupDirectory, oldSnapshot), { recursive: true, force: false });
    }
  } catch (error) {
    await fs.rm(snapshot, { recursive: true, force: true });
    throw error;
  }
  console.log(`Local backup created: ${path.relative(root, snapshot)}`);
}

async function appendEvent(config, ledger, type, payload) {
  const previousHash = ledger.events.at(-1)?.hash ?? genesisHash;
  const record = { id: randomUUID(), type, createdAt: new Date().toISOString(), payload, prevHash: previousHash };
  const hash = createHash("sha256").update(JSON.stringify(record)).digest("hex").toString();
  await fs.mkdir(ledger.directory, { recursive: true });
  await fs.appendFile(ledger.ledgerPath, `${JSON.stringify({ ...record, hash })}\n`, { encoding: "utf8", flag: "a" });
  ledger.events.push({ ...record, hash });
  console.log(`Recorded ${type}: ${record.id}`);
  if (config.backups.enabled && config.backups.onWrite) await backup(config, ledger.ledgerPath);
}

function currentDelegations(events) {
  const delegations = new Map();
  for (const event of events) {
    if (event.type === "delegation.created") delegations.set(event.payload.id, event.payload);
    if (event.type === "delegation.completed") {
      const existing = delegations.get(event.payload.id);
      if (existing) delegations.set(event.payload.id, { ...existing, status: "completed", completedAt: event.createdAt });
    }
  }
  return [...delegations.values()];
}

function usage() {
  console.log(`Apex Codex Core — local executive command engine

Commands:
  npm run start -- decision add --title "..." --choice "..." --rationale "..." [--priority strategic] [--capacity 1-5] [--focus 1-5]
  npm run start -- decision list
  npm run start -- delegate add --title "..." --owner "..." --due YYYY-MM-DD [--priority standard] [--notes "..."]
  npm run start -- delegate list
  npm run start -- delegate complete --id <delegation-id>
  npm run start -- summary
  npm run start -- verify
  npm run start -- backup

All records remain in the configured local data directory. No network service is used.`);
}

async function writeWeeklySummary(config, events) {
  if (!config.weeklySummary.enabled) throw new Error("Weekly summaries are disabled in sovereign.config.json");
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const weekEvents = events.filter((event) => new Date(event.createdAt) >= start);
  const decisions = weekEvents.filter((event) => event.type === "decision.created");
  const delegations = currentDelegations(events);
  const openDelegations = delegations.filter((item) => item.status !== "completed");
  const capacityValues = decisions.map((event) => event.payload.capacity).filter(Number.isFinite);
  const focusValues = decisions.map((event) => event.payload.focus).filter(Number.isFinite);
  const average = (values) => values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : "not recorded";
  const lines = [
    `# Apex Weekly Summary — Week of ${start.toISOString().slice(0, 10)}`,
    "",
    `Generated: ${now.toISOString()}`,
    "",
    "## Decision ledger",
    `- Decisions recorded this week: ${decisions.length}`,
    `- Average optional capacity check-in: ${average(capacityValues)}`,
    `- Average optional focus check-in: ${average(focusValues)}`,
    "",
    "## Executive capacity",
    `- Open delegations: ${openDelegations.length}`,
    `- Weighted open load: ${openDelegations.reduce((sum, item) => sum + item.weight, 0)}`,
    "",
    "### Open commitments",
    ...(openDelegations.length
      ? openDelegations.map((item) => `- [${item.priority}] ${item.title} — owner: ${item.owner}; due: ${item.due}; load: ${item.weight}`)
      : ["- None"]),
    "",
    "## Decisions captured this week",
    ...(decisions.length
      ? decisions.map((event) => `- **${event.payload.title}** (${event.payload.priority}): ${event.payload.choice}`)
      : ["- None"]),
    ""
  ];
  const outputDirectory = withinRoot(config.weeklySummary.outputDirectory, "weeklySummary.outputDirectory");
  const outputPath = withinRoot(path.join(config.weeklySummary.outputDirectory, config.weeklySummary.fileName), "Weekly summary file");
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(outputPath, lines.join("\n"), "utf8");
  console.log(`Weekly summary written: ${path.relative(root, outputPath)}`);
}

async function main(args) {
  if (args.length === 0 || args[0] === "help") {
    usage();
    return;
  }
  const config = await readConfig();
  const ledger = await readLedger(config);
  const [resource, action, ...tokens] = args;

  if (resource === "verify" && !action) {
    console.log(`Verified ${ledger.events.length} ledger event(s); hash chain is intact.`);
    return;
  }
  if (resource === "deploy" && !action) {
    await fs.mkdir(ledger.directory, { recursive: true });
    const handle = await fs.open(ledger.ledgerPath, "a");
    await handle.close();
    console.log(`Apex Codex Core is ready. Local ledger: ${path.relative(root, ledger.ledgerPath)}`);
    return;
  }
  if (resource === "backup" && !action) {
    if (await fs.stat(ledger.ledgerPath).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error))) {
      await backup(config, ledger.ledgerPath);
    } else {
      console.log("Nothing to back up yet; the local ledger has not been created.");
    }
    return;
  }
  if (resource === "summary" && !action) {
    await writeWeeklySummary(config, ledger.events);
    return;
  }
  if (resource === "decision" && action === "add") {
    const options = parseOptions(tokens);
    const priority = options.priority ?? "strategic";
    const payload = {
      title: required(options, "title"),
      choice: required(options, "choice"),
      rationale: required(options, "rationale"),
      priority,
      weight: priorityWeight(config, priority)
    };
    for (const key of ["capacity", "focus"]) {
      if (options[key] !== undefined) {
        const value = Number(options[key]);
        const { minimum, maximum } = config.capacityCheckIns.scale;
        if (!config.capacityCheckIns.enabled) throw new Error("Capacity and focus check-ins are disabled in sovereign.config.json");
        if (!Number.isInteger(value) || value < minimum || value > maximum) {
          throw new Error(`--${key} must be an integer from ${minimum} to ${maximum}`);
        }
        payload[key] = value;
      }
    }
    if (config.capacityCheckIns.enabled && config.capacityCheckIns.required &&
        (payload.capacity === undefined || payload.focus === undefined)) {
      throw new Error("Capacity and focus values are required by sovereign.config.json");
    }
    await appendEvent(config, ledger, "decision.created", payload);
    return;
  }
  if (resource === "decision" && action === "list" && tokens.length === 0) {
    const decisions = ledger.events.filter((event) => event.type === "decision.created");
    for (const event of decisions) console.log(`${event.createdAt} [${event.payload.priority}] ${event.payload.title}: ${event.payload.choice}`);
    if (!decisions.length) console.log("No decisions recorded yet.");
    return;
  }
  if (resource === "delegate" && action === "add") {
    const options = parseOptions(tokens);
    const priority = options.priority ?? "standard";
    const due = required(options, "due");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`))) {
      throw new Error("--due must be a valid YYYY-MM-DD date");
    }
    const payload = {
      id: randomUUID(),
      title: required(options, "title"),
      owner: required(options, "owner"),
      due,
      priority,
      weight: priorityWeight(config, priority),
      notes: options.notes ?? "",
      status: "open"
    };
    await appendEvent(config, ledger, "delegation.created", payload);
    return;
  }
  if (resource === "delegate" && action === "list" && tokens.length === 0) {
    const delegations = currentDelegations(ledger.events);
    for (const item of delegations) {
      console.log(`${item.id} [${item.status}] [${item.priority}] ${item.title} — ${item.owner}; due ${item.due}; load ${item.weight}`);
    }
    if (!delegations.length) console.log("No delegations recorded yet.");
    return;
  }
  if (resource === "delegate" && action === "complete") {
    const options = parseOptions(tokens);
    const id = required(options, "id");
    const delegation = currentDelegations(ledger.events).find((item) => item.id === id);
    if (!delegation) throw new Error(`No delegation found with id ${id}`);
    if (delegation.status === "completed") throw new Error(`Delegation ${id} is already completed`);
    await appendEvent(config, ledger, "delegation.completed", { id });
    return;
  }
  usage();
  throw new Error(`Unknown command: ${args.join(" ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Apex Codex: ${error.message}`);
    process.exitCode = 1;
  });
}

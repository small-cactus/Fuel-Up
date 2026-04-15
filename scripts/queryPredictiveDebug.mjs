#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const DEFAULT_SIMULATOR_ID = 'booted';
const DEFAULT_BUNDLE_ID = 'com.anthonyh.fuelup';
const DEFAULT_QUERY = 'all';
const DEFAULT_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 500;
const REQUEST_FILE_NAME = 'predictive-debug-query-request.json';
const REPORT_FILE_NAME = 'predictive-debug-query.json';

function parseArgs(argv) {
  const parsed = {
    simulatorId: DEFAULT_SIMULATOR_ID,
    bundleId: DEFAULT_BUNDLE_ID,
    query: DEFAULT_QUERY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    token: `cli-${Date.now()}`,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = argv[index + 1];

    if ((argument === '--simulator' || argument === '--sim') && nextValue) {
      parsed.simulatorId = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--bundle' && nextValue) {
      parsed.bundleId = nextValue;
      index += 1;
      continue;
    }

    if ((argument === '--query' || argument === '--kind') && nextValue) {
      parsed.query = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--token' && nextValue) {
      parsed.token = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--timeout' && nextValue) {
      const timeoutMs = Number(nextValue);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        parsed.timeoutMs = timeoutMs;
      }
      index += 1;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
  }

  return parsed;
}

function getAppContainer(simulatorId, bundleId) {
  const resolvedSimulatorId = simulatorId === DEFAULT_SIMULATOR_ID
    ? getBootedSimulatorId()
    : simulatorId;
  return execFileSync(
    'xcrun',
    ['simctl', 'get_app_container', resolvedSimulatorId, bundleId, 'data'],
    { encoding: 'utf8' }
  ).trim();
}

function getBootedSimulatorId() {
  const rawDevices = execFileSync(
    'xcrun',
    ['simctl', 'list', 'devices', 'booted', '-j'],
    { encoding: 'utf8' }
  );
  const parsedDevices = JSON.parse(rawDevices);
  const runtimeGroups = Object.values(parsedDevices?.devices || {});
  for (const group of runtimeGroups) {
    if (!Array.isArray(group)) {
      continue;
    }

    const bootedDevice = group.find(device => device?.state === 'Booted' && device?.isAvailable !== false);
    if (bootedDevice?.udid) {
      return bootedDevice.udid;
    }
  }

  throw new Error('No booted simulator found.');
}

async function waitForMatchingReport(reportFilePath, token, timeoutMs) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const report = JSON.parse(await fs.readFile(reportFilePath, 'utf8'));
      if (report?.token === token) {
        return report;
      }
    } catch (error) {
      // Ignore read races until the report is written.
    }

    await new Promise(resolve => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }

  throw new Error(`Timed out waiting for predictive debug report token "${token}".`);
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: node scripts/queryPredictiveDebug.mjs [options]',
      '',
      'Options:',
      '  --query, --kind <all|driving|backend|permissions|tasks|location>',
      `  --simulator, --sim <id>    Simulator id (default: ${DEFAULT_SIMULATOR_ID})`,
      `  --bundle <id>              Bundle id (default: ${DEFAULT_BUNDLE_ID})`,
      '  --token <value>            Request token override',
      `  --timeout <ms>             Wait timeout (default: ${DEFAULT_TIMEOUT_MS})`,
      '  --help                     Show this message',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const appContainer = getAppContainer(args.simulatorId, args.bundleId);
  const documentsPath = path.join(appContainer, 'Documents');
  const requestFilePath = path.join(documentsPath, REQUEST_FILE_NAME);
  const reportFilePath = path.join(documentsPath, REPORT_FILE_NAME);

  const requestPayload = {
    token: args.token,
    query: args.query,
  };

  await fs.writeFile(requestFilePath, JSON.stringify(requestPayload), 'utf8');
  const report = await waitForMatchingReport(reportFilePath, args.token, args.timeoutMs);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});

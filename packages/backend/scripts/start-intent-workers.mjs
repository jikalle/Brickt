import { spawn } from 'child_process';

const workers = [
  {
    name: 'property-worker',
    script: 'scripts/process-property-intents.mjs',
    env: { PROPERTY_INTENT_CONTINUOUS: 'true' },
  },
  {
    name: 'profit-worker',
    script: 'scripts/process-profit-intents.mjs',
    env: { PROFIT_INTENT_CONTINUOUS: 'true' },
  },
  {
    name: 'platform-fee-worker',
    script: 'scripts/process-platform-fee-intents.mjs',
    env: { PLATFORM_FEE_INTENT_CONTINUOUS: 'true' },
  },
  {
    name: 'indexer-worker',
    script: 'scripts/process-indexer-sync.mjs',
    env: { INDEXER_CONTINUOUS: 'true' },
  },
];

const children = [];
let shuttingDown = false;

const stopAll = (signal = 'SIGTERM') => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
};

for (const worker of workers) {
  const child = spawn('node', [worker.script], {
    stdio: 'inherit',
    env: { ...process.env, ...worker.env },
  });
  children.push(child);
  console.log(`[workers] started ${worker.name} pid=${child.pid}`);

  child.on('exit', (code, signal) => {
    console.log(`[workers] ${worker.name} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (!shuttingDown) {
      console.error(`[workers] ${worker.name} exited unexpectedly; stopping all workers`);
      stopAll('SIGTERM');
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));

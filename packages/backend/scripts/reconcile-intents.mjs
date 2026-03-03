import { spawn } from 'child_process';

const tasks = [
  {
    name: 'property',
    script: 'scripts/reconcile-property-intents.mjs',
  },
  {
    name: 'profit',
    script: 'scripts/reconcile-profit-intents.mjs',
  },
  {
    name: 'platform-fee',
    script: 'scripts/reconcile-platform-fee-intents.mjs',
  },
];

const runTask = (task) =>
  new Promise((resolve, reject) => {
    const child = spawn('node', [task.script], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(
        new Error(
          `[reconcile] ${task.name} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`
        )
      );
    });
  });

for (const task of tasks) {
  console.log(`[reconcile] starting ${task.name}`);
  await runTask(task);
}

console.log('[reconcile] all intent reconciliations completed');


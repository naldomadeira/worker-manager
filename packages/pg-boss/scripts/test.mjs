import { spawnSync } from 'node:child_process';

const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 22 || (major === 22 && minor < 12)) {
  console.warn(
    `Skipping @worker-manager/pg-boss: pg-boss needs Node >= 22.12, this is ${process.versions.node}.`
  );
  process.exit(0);
}

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --experimental-vm-modules`.trim(),
};

for (const config of ['jest.config.latest.js', 'jest.config.floor.js']) {
  const run = spawnSync('jest', ['--config', config, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env,
    shell: true,
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(__dirname, '../.env.test'),
  quiet: true,
});

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function runPrisma(args) {
  const result = spawnSync(command, ['prisma', ...args], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runPrisma(['db', 'push']);

// Prisma 7 moved seed config to prisma.config.ts — run directly via ts-node
const tsNode = process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node';
const seedResult = spawnSync(tsNode, ['prisma/seeds/index.ts'], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  encoding: 'utf-8',
  shell: process.platform === 'win32',
});

if (seedResult.stdout) process.stdout.write(seedResult.stdout);
if (seedResult.stderr) process.stderr.write(seedResult.stderr);
if (seedResult.error) { console.error(seedResult.error); process.exit(1); }
if (seedResult.status !== 0) process.exit(seedResult.status ?? 1);

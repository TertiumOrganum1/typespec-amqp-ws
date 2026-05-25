#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const REGISTRY_PUBLIC = 'https://registry.npmjs.org/';
const REGISTRY_INTERNAL = 'http://npm.komtex/';

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function shCapture(cmd) {
  return execSync(cmd, { encoding: 'utf-8' });
}

sh('npm run clean');
sh('npm run build');
sh('npm test');

console.log('\n=== pack: full tarball (Verdaccio) ===');
const internalFilename = JSON.parse(shCapture('npm pack --json'))[0].filename;

const originalPkg = readFileSync('package.json', 'utf-8');

try {
  console.log('\n=== strip repository/homepage/bugs for public tarball ===');
  sh('npm pkg delete repository homepage bugs');

  console.log('\n=== pack: stripped tarball (npmjs) ===');
  const publicFilename = JSON.parse(shCapture('npm pack --json'))[0].filename;

  console.log('\n=== publish: npmjs (stripped) ===');
  sh(`npm publish ${publicFilename} --ignore-scripts --registry=${REGISTRY_PUBLIC}`);

  console.log('\n=== publish: Verdaccio (full) ===');
  sh(`npm publish ${internalFilename} --ignore-scripts --registry=${REGISTRY_INTERNAL}`);

  unlinkSync(publicFilename);
  unlinkSync(internalFilename);
} finally {
  writeFileSync('package.json', originalPkg);
}

console.log('\nDone. Published to both registries.');

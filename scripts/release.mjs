#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, renameSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';

const REGISTRY_PUBLIC = 'https://registry.npmjs.org/';
const REGISTRY_INTERNAL = 'http://npm.komtex/';

const PUBLIC_REPO_HTTPS = 'https://github.com/TertiumOrganum1/typespec-amqp-ws';
const PUBLIC_REPO_GIT = 'git+https://github.com/TertiumOrganum1/typespec-amqp-ws.git';
const PUBLIC_BLOB_BASE = `${PUBLIC_REPO_HTTPS}/blob/master`;
const PUBLIC_TREE_BASE = `${PUBLIC_REPO_HTTPS}/tree/master`;

const INTERNAL_REPO_HTTPS = 'https://gitlab.sirena2000.ru/dcs_services/dcs_utils/typespec_amqp_ws';
const INTERNAL_REPO_GIT = 'git+https://gitlab.sirena2000.ru/dcs_services/dcs_utils/typespec_amqp_ws.git';
const INTERNAL_BLOB_BASE = `${INTERNAL_REPO_HTTPS}/-/blob/master`;
const INTERNAL_TREE_BASE = `${INTERNAL_REPO_HTTPS}/-/tree/master`;

const MARKDOWN_FILES = [
  'README.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/usage.md',
];

const args = process.argv.slice(2);
const onlyPublic = args.includes('--public');
const onlyInternal = args.includes('--internal');
const dryRun = args.includes('--dry-run');
const publishPublic = !onlyInternal;
const publishInternal = !onlyPublic;

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function shCapture(cmd) {
  return execSync(cmd, { encoding: 'utf-8' });
}

function rewriteRepoFields({ repoGit, repoHttps, issuesPath }) {
  sh(`npm pkg set repository.type=git`);
  sh(`npm pkg set repository.url=${repoGit}`);
  sh(`npm pkg set homepage=${repoHttps}#readme`);
  sh(`npm pkg set bugs.url=${repoHttps}${issuesPath}`);
}

function packWithSuffix(suffix) {
  const original = JSON.parse(shCapture('npm pack --json'))[0].filename;
  const renamed = original.replace(/\.tgz$/, `-${suffix}.tgz`);
  renameSync(original, renamed);
  return renamed;
}

function rewriteRelativeMarkdownLinks({ blobBase, treeBase }) {
  const cwd = process.cwd();
  for (const file of MARKDOWN_FILES) {
    if (!existsSync(file)) continue;
    const fileDir = dirname(file);
    const original = readFileSync(file, 'utf-8');
    const transformed = original.replace(
      /(\[[^\]]*\])\(([^)]+)\)/g,
      (match, label, href) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return match; // http:, mailto:, etc.
        if (href.startsWith('#') || href.startsWith('//') || href.startsWith('/')) return match;
        const hashIdx = href.indexOf('#');
        const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
        const anchor = hashIdx >= 0 ? href.slice(hashIdx) : '';
        if (!pathPart) return match;
        const abs = resolve(cwd, fileDir, pathPart);
        const rel = relative(cwd, abs).split(sep).join('/');
        const isDir = existsSync(abs) && statSync(abs).isDirectory();
        const base = isDir ? treeBase : blobBase;
        return `${label}(${base}/${rel}${anchor})`;
      }
    );
    if (transformed !== original) {
      writeFileSync(file, transformed);
    }
  }
}

function snapshotMarkdown() {
  const snapshot = {};
  for (const f of MARKDOWN_FILES) {
    if (existsSync(f)) snapshot[f] = readFileSync(f, 'utf-8');
  }
  return snapshot;
}

function restoreMarkdown(snapshot) {
  for (const [f, content] of Object.entries(snapshot)) {
    writeFileSync(f, content);
  }
}

sh('npm run clean');
sh('npm run build');
sh('npm test');

const originalPkg = readFileSync('package.json', 'utf-8');
const originalMd = snapshotMarkdown();
let internalFilename = null;
let publicFilename = null;

try {
  if (publishInternal) {
    console.log('\n=== rewrite package.json and markdown links → gitlab ===');
    rewriteRepoFields({
      repoGit: INTERNAL_REPO_GIT,
      repoHttps: INTERNAL_REPO_HTTPS,
      issuesPath: '/-/issues',
    });
    rewriteRelativeMarkdownLinks({ blobBase: INTERNAL_BLOB_BASE, treeBase: INTERNAL_TREE_BASE });
    console.log('\n=== pack: tarball (Verdaccio, gitlab links) ===');
    internalFilename = packWithSuffix('internal');
    writeFileSync('package.json', originalPkg);
    restoreMarkdown(originalMd);
  }

  if (publishPublic) {
    console.log('\n=== rewrite package.json and markdown links → github ===');
    rewriteRepoFields({
      repoGit: PUBLIC_REPO_GIT,
      repoHttps: PUBLIC_REPO_HTTPS,
      issuesPath: '/issues',
    });
    rewriteRelativeMarkdownLinks({ blobBase: PUBLIC_BLOB_BASE, treeBase: PUBLIC_TREE_BASE });
    console.log('\n=== pack: tarball (npmjs, github links) ===');
    publicFilename = packWithSuffix('public');
  }

  if (dryRun) {
    console.log('\n=== dry-run: skip publish ===');
    if (internalFilename) console.log(`  internal tarball: ${internalFilename}`);
    if (publicFilename) console.log(`  public tarball:   ${publicFilename}`);
  } else {
    if (publishPublic) {
      console.log('\n=== publish: npmjs (github links) ===');
      sh(`npm publish ${publicFilename} --ignore-scripts --registry=${REGISTRY_PUBLIC}`);
    }
    if (publishInternal) {
      console.log('\n=== publish: Verdaccio (gitlab links) ===');
      sh(`npm publish ${internalFilename} --ignore-scripts --registry=${REGISTRY_INTERNAL}`);
    }
    if (publicFilename) unlinkSync(publicFilename);
    if (internalFilename) unlinkSync(internalFilename);
  }
} finally {
  writeFileSync('package.json', originalPkg);
  restoreMarkdown(originalMd);
}

console.log('\nDone.');

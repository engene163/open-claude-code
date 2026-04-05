#!/usr/bin/env node
/**
 * decompile-and-diff.mjs — Full rudevolution decompilation + structural diff
 *
 * Runs the complete decompiler pipeline on two Claude Code versions:
 * 1. Fetches both versions from npm
 * 2. Runs MinCut graph partitioning + name inference
 * 3. Generates witness chains (SHA3-256)
 * 4. Produces a structural diff: new/removed/changed modules, functions, exports
 *
 * Usage:
 *   node scripts/decompile-and-diff.mjs <new-version> <previous-version>
 *
 * Output: JSON to stdout with diff summary
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load rudevolution decompiler
const decompilerPath = path.join(__dirname, '..', 'rudevolution', 'npm', 'src', 'decompiler');

// Patch: fix scoped package URL encoding in npm-fetch before loading decompiler
const npmFetchPath = path.join(decompilerPath, 'npm-fetch.js');
const npmFetchSrc = require('fs').readFileSync(npmFetchPath, 'utf8');
if (npmFetchSrc.includes("replace('%40', '@')") && !npmFetchSrc.includes("replace('%2F', '/')")) {
  const patched = npmFetchSrc.replace(
    /encodeURIComponent\(packageName\)\.replace\('%40', '@'\)/g,
    "encodeURIComponent(packageName).replace('%40', '@').replace('%2F', '/')"
  );
  require('fs').writeFileSync(npmFetchPath, patched);
  console.error('Patched npm-fetch.js: fixed scoped package URL encoding');
}

const { decompilePackage } = require(decompilerPath);

const PACKAGE = '@anthropic-ai/claude-code';
const newVersion = process.argv[2];
const prevVersion = process.argv[3];

if (!newVersion || !prevVersion) {
  console.error('Usage: node decompile-and-diff.mjs <new-version> <previous-version>');
  process.exit(2);
}

async function decompile(version) {
  console.error(`Decompiling ${PACKAGE}@${version}...`);
  const start = Date.now();
  try {
    const result = await decompilePackage(PACKAGE, version, {
      format: 'json',
      witness: true,
      validate: true,
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  Done in ${elapsed}s — ${result.modules?.length || 0} modules, ${result.metrics?.totalDeclarations || '?'} declarations`);
    return result;
  } catch (err) {
    console.error(`  Failed: ${err.message}`);
    return null;
  }
}

function extractSignature(result) {
  if (!result || !result.modules) return { modules: [], exports: [], functions: 0, classes: 0 };

  const modules = result.modules.map(m => ({
    name: m.name || m.id || 'unknown',
    functions: m.functions?.length || 0,
    classes: m.classes?.length || 0,
    exports: m.exports || [],
    size: m.source?.length || 0,
  }));

  const allExports = modules.flatMap(m => m.exports);
  const totalFunctions = modules.reduce((s, m) => s + m.functions, 0);
  const totalClasses = modules.reduce((s, m) => s + m.classes, 0);

  return { modules, exports: allExports, functions: totalFunctions, classes: totalClasses };
}

function computeDiff(prevSig, newSig) {
  const prevModNames = new Set(prevSig.modules.map(m => m.name));
  const newModNames = new Set(newSig.modules.map(m => m.name));

  const addedModules = newSig.modules.filter(m => !prevModNames.has(m.name));
  const removedModules = prevSig.modules.filter(m => !newModNames.has(m.name));

  const prevExports = new Set(prevSig.exports);
  const newExports = new Set(newSig.exports);
  const addedExports = [...newExports].filter(e => !prevExports.has(e));
  const removedExports = [...prevExports].filter(e => !newExports.has(e));

  // Size changes for shared modules
  const changedModules = [];
  for (const nm of newSig.modules) {
    const pm = prevSig.modules.find(m => m.name === nm.name);
    if (pm) {
      const sizeDelta = nm.size - pm.size;
      const funcDelta = nm.functions - pm.functions;
      if (Math.abs(sizeDelta) > 100 || funcDelta !== 0) {
        changedModules.push({
          name: nm.name,
          sizeDelta,
          funcDelta,
          classDelta: nm.classes - pm.classes,
        });
      }
    }
  }

  return {
    summary: {
      prevModules: prevSig.modules.length,
      newModules: newSig.modules.length,
      prevFunctions: prevSig.functions,
      newFunctions: newSig.functions,
      prevClasses: prevSig.classes,
      newClasses: newSig.classes,
      addedModuleCount: addedModules.length,
      removedModuleCount: removedModules.length,
      changedModuleCount: changedModules.length,
      addedExportCount: addedExports.length,
      removedExportCount: removedExports.length,
    },
    addedModules: addedModules.map(m => ({ name: m.name, functions: m.functions, classes: m.classes })),
    removedModules: removedModules.map(m => ({ name: m.name, functions: m.functions })),
    changedModules: changedModules.slice(0, 30),
    addedExports: addedExports.slice(0, 50),
    removedExports: removedExports.slice(0, 50),
  };
}

async function main() {
  console.error(`\n=== rudevolution Deep Decompilation Diff ===`);
  console.error(`Previous: ${PACKAGE}@${prevVersion}`);
  console.error(`Current:  ${PACKAGE}@${newVersion}\n`);

  const [prevResult, newResult] = await Promise.all([
    decompile(prevVersion),
    decompile(newVersion),
  ]);

  if (!prevResult && !newResult) {
    console.error('Both decompilations failed. Outputting empty diff.');
    console.log(JSON.stringify({ error: 'decompilation_failed', summary: {} }));
    process.exit(1);
  }

  const prevSig = extractSignature(prevResult);
  const newSig = extractSignature(newResult);
  const diff = computeDiff(prevSig, newSig);

  // Add metrics
  diff.metrics = {
    previous: prevResult?.metrics || {},
    current: newResult?.metrics || {},
  };

  // Add witness info
  diff.witness = {
    previous: prevResult?.witness ? { valid: true, records: prevResult.witness.length || 0 } : null,
    current: newResult?.witness ? { valid: true, records: newResult.witness.length || 0 } : null,
  };

  console.log(JSON.stringify(diff, null, 2));
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

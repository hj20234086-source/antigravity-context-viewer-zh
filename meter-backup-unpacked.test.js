'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { builtinAsar } = require('./asar-engine');
const { install } = require('./install');

async function createMockHostWithUnpacked(dir, targetAsarName = 'app.asar') {
  const src = path.join(dir, `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(path.join(src, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(src, 'node_modules', 'chrome-devtools-mcp'), { recursive: true });

  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'antigravity', version: '2.32.1' }), 'utf8');
  fs.writeFileSync(
    path.join(src, 'dist', 'utils.js'),
    '"use strict";\nfunction setupNodeWrapper(env) {\n}\nfunction createWindow(url, storageManager, options) {\n  const opts = { titleBarStyle: \'hidden\' };\n    void win.loadURL(url);\n}\n',
    'utf8'
  );
  fs.writeFileSync(path.join(src, 'dist', 'preload.js'), 'const electron_1 = require("electron");\n', 'utf8');
  const licenseText = 'Apache License 2.0 - chrome-devtools-mcp test fixture\n';
  fs.writeFileSync(path.join(src, 'node_modules', 'chrome-devtools-mcp', 'LICENSE'), licenseText, 'utf8');

  const outAsar = path.join(dir, targetAsarName);
  await builtinAsar.createPackageWithOptions(src, outAsar, {
    unpackedPaths: new Set(['node_modules/chrome-devtools-mcp/LICENSE'])
  });
  fs.rmSync(src, { recursive: true, force: true });
  return { asarPath: outAsar, licenseText };
}

test('asar-engine: 读取 .bak 或外置备份时自动回退到同目录 app.asar.unpacked 或显式 unpackedDir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-asar-unpacked-fb-'));
  try {
    const { asarPath, licenseText } = await createMockHostWithUnpacked(tmpDir, 'app.asar');
    const bakSameDir = path.join(tmpDir, 'app.asar.bak');
    fs.copyFileSync(asarPath, bakSameDir);

    // 1. 同目录 app.asar.bak 旁无 app.asar.bak.unpacked，自动回退读取同目录 app.asar.unpacked
    assert.equal(fs.existsSync(bakSameDir + '.unpacked'), false);
    const readSameDir = builtinAsar.extractFile(bakSameDir, 'node_modules/chrome-devtools-mcp/LICENSE').toString('utf8');
    assert.equal(readSameDir, licenseText);

    // 2. 异目录备份（模拟 backups/app-xxx-base.asar）通过 explicit unpackedDir 回退读取
    const subDir = path.join(tmpDir, 'other-backups');
    fs.mkdirSync(subDir, { recursive: true });
    const remoteBak = path.join(subDir, 'app-2.32.1-base.asar');
    fs.copyFileSync(asarPath, remoteBak);

    const readViaOpt = builtinAsar.extractFile(remoteBak, 'node_modules/chrome-devtools-mcp/LICENSE', {
      unpackedDir: asarPath + '.unpacked'
    }).toString('utf8');
    assert.equal(readViaOpt, licenseText);

    const extDest = path.join(tmpDir, 'extracted-remote');
    builtinAsar.extractAll(remoteBak, extDest, { unpackedDir: asarPath + '.unpacked' });
    assert.equal(
      fs.readFileSync(path.join(extDest, 'node_modules', 'chrome-devtools-mcp', 'LICENSE'), 'utf8'),
      licenseText
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('install: 使用 --backup app.asar.bak 对含 unpacked 文件的宿主重打包时不报 ENOENT 并完整校验保留 unpacked', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-install-backup-unpacked-'));
  const prevAppData = process.env.APPDATA;
  const prevStateDir = process.env.AG_METER_STATE_DIR;
  const prevTestMode = process.env.AG_METER_TEST_MODE;

  const isoAppData = path.join(tmpDir, 'appdata');
  const isoStateDir = path.join(tmpDir, 'state');
  fs.mkdirSync(isoAppData, { recursive: true });
  process.env.APPDATA = isoAppData;
  process.env.AG_METER_STATE_DIR = isoStateDir;
  process.env.AG_METER_TEST_MODE = '1';

  try {
    const resDir = path.join(tmpDir, 'Resources');
    fs.mkdirSync(resDir, { recursive: true });
    const { asarPath: targetAsar, licenseText } = await createMockHostWithUnpacked(resDir, 'app.asar');
    const bakAsar = path.join(resDir, 'app.asar.bak');
    fs.copyFileSync(targetAsar, bakAsar);

    // 确认无 app.asar.bak.unpacked，仅有 app.asar.unpacked
    assert.equal(fs.existsSync(bakAsar + '.unpacked'), false);
    assert.equal(fs.existsSync(targetAsar + '.unpacked'), true);

    const manifest = await install({
      path: targetAsar,
      backup: bakAsar,
      modules: { chinese: { enabled: true } }
    });

    assert.equal(manifest.version, '2.32.1');
    assert.ok(manifest.originalFilesVerified >= 4, '应核验包括 unpacked LICENSE 在内的原文件');

    const installedLicenseStat = builtinAsar.statFile(targetAsar, 'node_modules/chrome-devtools-mcp/LICENSE');
    assert.equal(Boolean(installedLicenseStat.unpacked), true, '重打包后的 target ASAR 仍应保留 unpacked: true 标记');
    assert.equal(
      builtinAsar.extractFile(targetAsar, 'node_modules/chrome-devtools-mcp/LICENSE').toString('utf8'),
      licenseText
    );
    const preload = builtinAsar.extractFile(targetAsar, 'dist/preload.js').toString('utf8');
    assert.ok(preload.includes('Antigravity Chinese Localization'));
  } finally {
    if (prevAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prevAppData;
    if (prevStateDir === undefined) delete process.env.AG_METER_STATE_DIR;
    else process.env.AG_METER_STATE_DIR = prevStateDir;
    if (prevTestMode === undefined) delete process.env.AG_METER_TEST_MODE;
    else process.env.AG_METER_TEST_MODE = prevTestMode;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

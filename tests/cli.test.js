import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'dist-cli', 'qrcode2stl.js');
const iconPath = path.join(repoRoot, 'tests', 'fixtures', 'icon.svg');

const baseQrArgs = [
  cliPath,
  '--mode', 'qr',
  '--content-type', 'text',
  '--text', 'https://www.cortags.com/fm/0a',
  '--base-width', '60',
  '--error-correction', 'L',
  '--block-corner-radius', '0',
  '--icon-size', '20',
  '--icon-svg', iconPath,
];

const runCli = async (args, options = {}) => execFileAsync(
  process.execPath,
  args,
  {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 8,
    ...options,
  },
);

const withTempDir = async (fn) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qrcode2stl-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const readBinaryStlStats = async (filePath) => {
  const data = await readFile(filePath);
  assert.ok(data.length >= 84, `${filePath} should be a binary STL`);
  const triangleCount = data.readUInt32LE(80);
  const expectedLength = 84 + triangleCount * 50;
  assert.equal(data.length, expectedLength, `${filePath} should have a valid binary STL length`);

  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let offset = 84; offset < data.length; offset += 50) {
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const vertexOffset = offset + 12 + vertex * 12;
      const x = data.readFloatLE(vertexOffset);
      const y = data.readFloatLE(vertexOffset + 4);
      const z = data.readFloatLE(vertexOffset + 8);
      min.x = Math.min(min.x, x);
      min.y = Math.min(min.y, y);
      min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x);
      max.y = Math.max(max.y, y);
      max.z = Math.max(max.z, z);
    }
  }

  return {
    triangleCount,
    bytes: data.length,
    width: max.x - min.x,
    height: max.y - min.y,
    depth: max.z - min.z,
  };
};

test('requires an output directory', async () => {
  await assert.rejects(
    runCli([cliPath, '--mode', 'qr', '--content-type', 'text', '--text', 'hello']),
    /--output-dir is required/,
  );
});

test('auto filename includes option values and excludes text and paths', async () => withTempDir(async (outputDir) => {
  const { stdout } = await runCli([
    ...baseQrArgs,
    '--icon-margin', '1',
    '--output-dir', outputDir,
  ]);
  const files = await readdir(outputDir);
  const stlFile = files.find(file => file.endsWith('.stl'));

  assert.ok(stlFile, 'STL file should be written');
  assert.match(stlFile, /^cqr-\d+-qr-text-60-L-0-20-1\.stl$/);
  assert.ok(!stlFile.includes('cortags'), 'auto filename should not include text content');
  assert.ok(!stlFile.includes('fixtures'), 'auto filename should not include paths');
  assert.match(stdout, /Wrote 1 STL file/);
}));

test('explicit filename is honored', async () => withTempDir(async (outputDir) => {
  await runCli([
    ...baseQrArgs,
    '--icon-margin', '1',
    '--output-dir', outputDir,
    '--filename', 'explicit-name',
  ]);

  const files = await readdir(outputDir);
  assert.ok(files.includes('explicit-name.stl'));
  assert.ok(files.includes('explicit-name.png'));
}));

test('no-png skips QR preview generation', async () => withTempDir(async (outputDir) => {
  await runCli([
    ...baseQrArgs,
    '--icon-margin', '1',
    '--output-dir', outputDir,
    '--filename', 'no-png',
    '--no-png',
  ]);

  const files = await readdir(outputDir);
  assert.ok(files.includes('no-png.stl'));
  assert.ok(!files.includes('no-png.png'));
}));

test('icon margin changes STL output', async () => withTempDir(async (outputDir) => {
  await runCli([
    ...baseQrArgs,
    '--icon-margin', '0.1',
    '--output-dir', outputDir,
    '--filename', 'margin-01',
    '--no-png',
  ]);
  await runCli([
    ...baseQrArgs,
    '--icon-margin', '1',
    '--output-dir', outputDir,
    '--filename', 'margin-1',
    '--no-png',
  ]);

  const margin01 = await stat(path.join(outputDir, 'margin-01.stl'));
  const margin1 = await stat(path.join(outputDir, 'margin-1.stl'));
  assert.notEqual(margin01.size, margin1.size);
}));

test('block corner radius changes STL complexity', async () => withTempDir(async (outputDir) => {
  await runCli([
    ...baseQrArgs,
    '--block-corner-radius', '0',
    '--icon-margin', '1',
    '--output-dir', outputDir,
    '--filename', 'square',
    '--no-png',
  ]);
  await runCli([
    ...baseQrArgs,
    '--block-corner-radius', '1',
    '--icon-margin', '1',
    '--output-dir', outputDir,
    '--filename', 'rounded',
    '--no-png',
  ]);

  const square = await readBinaryStlStats(path.join(outputDir, 'square.stl'));
  const rounded = await readBinaryStlStats(path.join(outputDir, 'rounded.stl'));
  assert.ok(rounded.triangleCount > square.triangleCount);
}));

test('base width changes STL bounds', async () => withTempDir(async (outputDir) => {
  await runCli([
    ...baseQrArgs,
    '--base-width', '60',
    '--icon-margin', '1',
    '--output-dir', outputDir,
    '--filename', 'width-60',
    '--no-png',
  ]);
  await runCli([
    ...baseQrArgs,
    '--base-width', '80',
    '--icon-margin', '1',
    '--output-dir', outputDir,
    '--filename', 'width-80',
    '--no-png',
  ]);

  const width60 = await readBinaryStlStats(path.join(outputDir, 'width-60.stl'));
  const width80 = await readBinaryStlStats(path.join(outputDir, 'width-80.stl'));
  assert.ok(width80.width > width60.width);
  assert.ok(width80.height > width60.height);
}));

test('separate parts writes individual STL files', async () => withTempDir(async (outputDir) => {
  await runCli([
    ...baseQrArgs,
    '--icon-margin', '1',
    '--output-dir', outputDir,
    '--filename', 'parts',
    '--separate-parts',
    '--no-png',
  ]);

  const files = await readdir(outputDir);
  assert.ok(files.includes('parts-base.stl'));
  assert.ok(files.includes('parts-border.stl'));
  assert.ok(files.includes('parts-icon.stl'));
  assert.ok(files.includes('parts-qrcode.stl'));
  assert.ok(!files.includes('parts.stl'));
}));

test('invalid enum values fail clearly', async () => withTempDir(async (outputDir) => {
  await assert.rejects(
    runCli([
      cliPath,
      '--mode', 'qr',
      '--content-type', 'text',
      '--text', 'hello',
      '--error-correction', 'Z',
      '--output-dir', outputDir,
    ]),
    /--error-correction must be one of: L, M, Q, H/,
  );
}));

// Packs the agent skill in skills/worker-manager into docs/public/worker-manager-skill.zip, which
// the docs site then serves at /worker-manager/worker-manager-skill.zip. The archive holds a
// single `worker-manager/` folder, so unzipping it into any skills directory installs the skill.
//
// Written against node:zlib rather than the `zip` binary or an archiver package: it runs the same
// on every OS a contributor builds the docs on, adds no dependency, and the output is byte for byte
// reproducible (fixed timestamps, sorted entries), so rebuilding an unchanged skill changes nothing.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const websiteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = resolve(websiteDir, '..', 'skills', 'worker-manager');
const outFile = join(websiteDir, 'docs', 'public', 'worker-manager-skill.zip');
const ROOT = 'worker-manager';

// Dot entries (the Claude Code plugin manifest in .claude-plugin/) only matter to the plugin
// marketplace install, not to a skill folder.
function collect(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? [{ path, dir: true }, ...collect(path)] : [{ path, dir: false }];
    });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 1980-01-01 00:00, the earliest DOS date, for every entry.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const entries = [{ path: skillDir, dir: true }, ...collect(skillDir)].map(({ path, dir }) => {
  const rel = relative(skillDir, path).split(sep).join('/');
  const name = Buffer.from(rel ? `${ROOT}/${rel}${dir ? '/' : ''}` : `${ROOT}/`);
  const data = dir ? Buffer.alloc(0) : readFileSync(path);
  const compressed = dir ? data : deflateRawSync(data, { level: 9 });
  return { name, dir, data, compressed, crc: dir ? 0 : crc32(data) };
});

const locals = [];
const centrals = [];
let offset = 0;

for (const entry of entries) {
  const method = entry.dir ? 0 : 8;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(entry.crc, 14);
  local.writeUInt32LE(entry.compressed.length, 18);
  local.writeUInt32LE(entry.data.length, 22);
  local.writeUInt16LE(entry.name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, entry.name, entry.compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, so the modes below apply
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(entry.crc, 16);
  central.writeUInt32LE(entry.compressed.length, 20);
  central.writeUInt32LE(entry.data.length, 24);
  central.writeUInt16LE(entry.name.length, 28);
  // extra, comment, disk start, internal attributes: all zero
  const mode = entry.dir ? 0o40755 : 0o100644;
  central.writeUInt32LE(((mode << 16) | (entry.dir ? 0x10 : 0)) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, entry.name);

  offset += local.length + entry.name.length + entry.compressed.length;
}

const centralSize = centrals.reduce((size, part) => size + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]));

// oxlint-disable-next-line no-console
console.log(`[docs] Packed ${entries.length} skill entries into docs/public/worker-manager-skill.zip`);

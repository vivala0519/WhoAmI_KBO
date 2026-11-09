#!/usr/bin/env node
// Add one verified clue to the existing selected pool without rebuilding its schedule.
import { createHash } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const option = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1];
};
const sourcePath = option('--source');
const checkOnly = process.argv.includes('--check-only');
if (!sourcePath) {
  console.error('Usage: node scripts/enrich-throw-bat.mjs --source kbo_players_2026_all.json [--check-only]');
  process.exit(2);
}

const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, '') : '';
const validType = (value) => /^(?:우투|좌투|우언|좌언|양투)(?:우타|좌타|양타)$/.test(value);
async function atomicWrite(file, value) {
  const temporary = file + '.' + process.pid + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

try {
  const playerPath = path.join(root, 'src', 'players.json');
  const schedulePath = path.join(root, 'src', 'daily-schedule.json');
  const reportPath = path.join(root, 'data', 'throw-bat-enrichment-report.json');
  const [sourceBuffer, playerBuffer, scheduleBuffer] = await Promise.all([
    readFile(path.resolve(sourcePath)), readFile(playerPath), readFile(schedulePath),
  ]);
  const rows = JSON.parse(sourceBuffer.toString('utf8').replace(/^\uFEFF/, ''));
  const dataset = JSON.parse(playerBuffer.toString('utf8'));
  const schedule = JSON.parse(scheduleBuffer.toString('utf8'));
  if (!Array.isArray(rows)) throw new Error('Source JSON must be a player array.');
  if (!Array.isArray(dataset.players) || dataset.players.length !== 250) throw new Error('Expected the existing 250-player pool.');
  const sourceMap = new Map();
  for (const row of rows) {
    const id = String(row['고유id'] ?? '').trim();
    if (!/^\d+$/.test(id) || sourceMap.has(id)) throw new Error('Invalid or duplicate source player ID: ' + id);
    sourceMap.set(id, row);
  }
  const counts = {};
  const players = dataset.players.map((player) => {
    const row = sourceMap.get(player.id);
    if (!row) throw new Error('Missing selected player in source: ' + player.id);
    const fields = {
      name: '선수명', club: '소속구단', position: '포지션', number: '등번호',
      heightCm: '키_cm', birthYear: '출생연도', season: '연봉_연도',
      salaryOriginalAmount: '연봉_금액', salaryCurrency: '연봉_통화',
      salaryKRW: '연봉_원화환산', sourceUrl: '공식프로필_URL',
    };
    for (const [field, sourceField] of Object.entries(fields)) {
      if (String(player[field]) !== String(row[sourceField])) {
        throw new Error('Existing clue differs from source for ' + player.id + ': ' + field);
      }
    }
    if (player.salaryCurrency === 'USD' &&
      (Number(row['USD_KRW_적용환율']) !== player.fxRate || row['USD_KRW_환율기준일'] !== player.fxDate)) {
      throw new Error('Existing FX policy differs from source for ' + player.id);
    }
    const throwBat = normalize(row['투타유형']);
    if (!validType(throwBat)) throw new Error('Missing or invalid 투타유형 for ' + player.id + ': ' + JSON.stringify(row['투타유형']));
    if (player.throwBat !== undefined && player.throwBat !== throwBat) throw new Error('Existing throwBat snapshot differs for ' + player.id);
    counts[throwBat] = (counts[throwBat] || 0) + 1;
    return { ...player, throwBat };
  });
  const selectedIds = new Set(players.map((player) => player.id));
  if (selectedIds.size !== 250 || schedule.players.length !== 250 || new Set(schedule.players).size !== 250 ||
      schedule.players.some((id) => !selectedIds.has(id))) throw new Error('Existing schedule does not match the selected pool.');
  const suffix = '-throw-bat-v1';
  const enriched = { ...dataset, version: dataset.version.endsWith(suffix) ? dataset.version : dataset.version + suffix, players };
  const scheduleHash = hash(scheduleBuffer);
  const report = {
    sourceFile: { name: path.basename(sourcePath), sha256: hash(sourceBuffer), rows: rows.length },
    selectedPlayers: players.length,
    matchedPlayers: players.length,
    missingThrowBat: 0,
    throwBatCounts: counts,
    originalPlayerFieldsPreserved: true,
    selectedPlayerOrderPreserved: true,
    scheduleSha256: scheduleHash,
    scheduleUnchanged: true,
    datasetVersion: enriched.version,
  };
  if (hash(await readFile(schedulePath)) !== scheduleHash) throw new Error('Schedule changed concurrently; aborting.');
  if (!checkOnly) {
    if (JSON.stringify(enriched) !== JSON.stringify(dataset)) await atomicWrite(playerPath, enriched);
    await atomicWrite(reportPath, report);
    if (hash(await readFile(schedulePath)) !== scheduleHash) throw new Error('Schedule changed concurrently during enrichment.');
  }
  console.log((checkOnly ? 'Checked' : 'Enriched') + ' all ' + players.length + ' selected players; schedule unchanged (' + scheduleHash + ').');
  console.log(JSON.stringify(counts));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

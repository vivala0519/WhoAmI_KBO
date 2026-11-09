#!/usr/bin/env node
// Converts a separately licensed, manually reviewed 2026 snapshot into game data.
import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const clubAliases = new Map(Object.entries({
  LG: 'LG', 'LG 트윈스': 'LG', 'LG Twins': 'LG',
  KT: 'KT', 'KT 위즈': 'KT', 'KT Wiz': 'KT', 'kt wiz': 'KT',
  SSG: 'SSG', 'SSG 랜더스': 'SSG', 'SSG Landers': 'SSG',
  삼성: '삼성', '삼성 라이온즈': '삼성', 'Samsung Lions': '삼성',
  KIA: 'KIA', 'KIA 타이거즈': 'KIA', 'Kia Tigers': 'KIA', 'KIA Tigers': 'KIA',
  두산: '두산', '두산 베어스': '두산', 'Doosan Bears': '두산',
  롯데: '롯데', '롯데 자이언츠': '롯데', 'Lotte Giants': '롯데',
  NC: 'NC', 'NC 다이노스': 'NC', 'NC Dinos': 'NC',
  한화: '한화', '한화 이글스': '한화', 'Hanwha Eagles': '한화',
  키움: '키움', '키움 히어로즈': '키움', 'Kiwoom Heroes': '키움',
}));
const positionAliases = new Map(Object.entries({
  투수: '투수', Pitcher: '투수', 포수: '포수', Catcher: '포수',
  내야수: '내야수', Infielder: '내야수', 외야수: '외야수', Outfielder: '외야수',
}));
const salaryDefinition = '2026 base salary; signing bonus and incentives excluded';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}
const inputPath = option('--input');
const manifestPath = option('--manifest');
const checkOnly = process.argv.includes('--check-only');
const reportPath = option('--report');
if (!inputPath || !manifestPath) {
  console.error('Usage: node scripts/import-players.mjs --input roster.csv|json --manifest rights.json [--check-only] [--report report.json]');
  process.exit(2);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}
function string(value) { return typeof value === 'string' ? value.trim() : ''; }
function positiveNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
function integer(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
function parseCsv(source) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (!quoted && field !== '') throw new Error(`Unexpected quote at character ${i + 1}`);
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      record.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      record.push(field); field = '';
      if (record.some((cell) => cell !== '')) records.push(record);
      record = [];
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field');
  if (record.length || field !== '') { record.push(field); records.push(record); }
  const [header, ...rows] = records;
  if (!header || new Set(header).size !== header.length) throw new Error('CSV needs a non-duplicate header row');
  return rows.map((row, index) => {
    if (row.length !== header.length) throw new Error(`CSV row ${index + 2} has ${row.length} columns; expected ${header.length}`);
    return Object.fromEntries(header.map((key, column) => [key, row[column]]));
  });
}
async function loadRows(file) {
  const source = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  if (file.toLowerCase().endsWith('.csv')) return parseCsv(source);
  if (file.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(source);
    const rows = Array.isArray(parsed) ? parsed : parsed?.players;
    if (!Array.isArray(rows)) throw new Error('JSON must be an array or an object with players array');
    return rows;
  }
  throw new Error('Input must be .csv or .json');
}

function validateManifest(manifest, errors) {
  if (manifest?.season !== 2026) errors.push('Manifest season must be 2026');
  if (!validDate(manifest?.snapshotDate) || !manifest.snapshotDate.startsWith('2026-')) errors.push('Manifest snapshotDate must be a valid 2026 YYYY-MM-DD date');
  if (!validDate(manifest?.startDate)) errors.push('Manifest startDate must be a valid YYYY-MM-DD date');
  if (validDate(manifest?.startDate) && validDate(manifest?.snapshotDate) && manifest.startDate < manifest.snapshotDate) errors.push('startDate must be on or after snapshotDate');
  if (!/^https?:\/\/\S+$/.test(string(manifest?.sourceUrl))) errors.push('Manifest sourceUrl must be an HTTP(S) URL');
  if (!string(manifest?.permissionEvidence)) errors.push('Manifest permissionEvidence is required');
  for (const key of ['commercialUseAllowed', 'appRedistributionAllowed', 'transformationsAllowed']) {
    if (manifest?.[key] !== true) errors.push(`Manifest ${key} must be true based on reviewed permission`);
  }
  if (manifest?.salaryDefinition !== salaryDefinition) errors.push(`Manifest salaryDefinition must be: ${salaryDefinition}`);
  if (!validDate(manifest?.fxDate)) errors.push('Manifest fxDate must be a valid YYYY-MM-DD date');
  if (positiveNumber(manifest?.fxRate) === null) errors.push('Manifest fxRate must be a positive KRW per foreign currency unit number');
}

function validatePlayer(row, rowNumber, manifest, errors) {
  const prefix = `Row ${rowNumber}`;
  if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push(`${prefix}: player must be an object`); return null; }
  const id = string(row.id);
  const name = string(row.name);
  const latin = string(row.latin);
  const club = clubAliases.get(string(row.club));
  const position = positionAliases.get(string(row.position));
  const throwBat = string(row.throwBat).normalize('NFC').replace(/\s+/g, '');
  const birthYear = integer(row.birthYear);
  const number = row.number;
  const heightCm = integer(row.heightCm);
  const original = positiveNumber(row.salaryOriginalAmount);
  const currency = string(row.salaryCurrency).toUpperCase();
  const definition = string(row.salaryDefinition) || manifest.salaryDefinition;
  const fxRate = currency === 'KRW' ? 1 : positiveNumber(row.fxRate ?? manifest.fxRate);
  const fxDate = string(row.fxDate) || manifest.fxDate;
  const sourceUrl = string(row.sourceUrl) || manifest.sourceUrl;
  const snapshotDate = string(row.snapshotDate) || manifest.snapshotDate;

  if (!/^[A-Za-z0-9:_-]{1,64}$/.test(id)) errors.push(`${prefix}: id must be a stable nonempty string using letters, digits, colon, underscore or hyphen`);
  if (!name) errors.push(`${prefix}: name is missing`);
  if (!latin) errors.push(`${prefix}: latin (English search name) is missing`);
  if (!club) errors.push(`${prefix}: unknown club ${JSON.stringify(row.club)}`);
  if (!position) errors.push(`${prefix}: position must be one of 투수, 포수, 내야수, 외야수`);
  if (!/^(?:우투|좌투|우언|좌언|양투)(?:우타|좌타|양타)$/.test(throwBat)) errors.push(`${prefix}: throwBat must be a complete type such as 우투우타 or 좌투좌타`);
  if (birthYear === null || birthYear < 1940 || birthYear > 2012) errors.push(`${prefix}: invalid birthYear`);
  if (typeof number !== 'string' || !/^\d{1,3}$/.test(number)) errors.push(`${prefix}: number must be a 1-3 digit string such as "0", "00" or "02"`);
  if (heightCm === null || heightCm < 140 || heightCm > 220) errors.push(`${prefix}: heightCm must be 140-220`);
  if (original === null) errors.push(`${prefix}: salaryOriginalAmount must be positive`);
  if (!/^[A-Z]{3}$/.test(currency)) errors.push(`${prefix}: salaryCurrency must be a three-letter currency code`);
  if (definition !== salaryDefinition) errors.push(`${prefix}: salaryDefinition must exclude signing bonus and incentives`);
  if (fxRate === null) errors.push(`${prefix}: fxRate is missing or invalid`);
  if (!validDate(fxDate)) errors.push(`${prefix}: fxDate must be YYYY-MM-DD`);
  if (currency === 'KRW' && row.fxRate !== undefined && Number(row.fxRate) !== 1) errors.push(`${prefix}: KRW fxRate must be 1`);
  if (!/^https?:\/\/\S+$/.test(sourceUrl)) errors.push(`${prefix}: sourceUrl must be HTTP(S)`);
  if (snapshotDate !== manifest.snapshotDate) errors.push(`${prefix}: snapshotDate differs from manifest`);
  if (row.season !== undefined && Number(row.season) !== 2026) errors.push(`${prefix}: season differs from 2026`);

  const computedKRW = original !== null && fxRate !== null ? Math.round(original * fxRate) : null;
  const suppliedKRW = row.salaryKRW === undefined || row.salaryKRW === '' ? computedKRW : integer(row.salaryKRW);
  if (computedKRW === null || !Number.isSafeInteger(computedKRW) || computedKRW <= 0) errors.push(`${prefix}: converted salaryKRW is invalid`);
  if (suppliedKRW === null || suppliedKRW !== computedKRW) errors.push(`${prefix}: salaryKRW must equal rounded original amount × fxRate`);
  if (errors.some((error) => error.startsWith(`${prefix}:`))) return null;
  return {
    id, name, latin, club, position, throwBat, birthYear, number, heightCm,
    salaryKRW: computedKRW, salaryOriginalAmount: original, salaryCurrency: currency,
    salaryDefinition: definition, fxRate, fxDate, sourceUrl, snapshotDate, season: 2026,
  };
}

function scheduleOrder(players) {
  const digest = (id) => createHash('sha256').update(`whoami-kbo-2026-schedule-v1\0${id}`).digest('hex');
  return players.map(({ id }) => id).sort((a, b) => digest(a).localeCompare(digest(b)) || a.localeCompare(b));
}

async function readExisting(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function replacePair(firstPath, firstValue, secondPath, secondValue) {
  const originalFirst = await readFile(firstPath, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  const originalSecond = await readFile(secondPath, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  const tempFirst = `${firstPath}.${process.pid}.tmp`;
  const tempSecond = `${secondPath}.${process.pid}.tmp`;
  try {
    await mkdir(path.dirname(firstPath), { recursive: true });
    await writeFile(tempFirst, `${JSON.stringify(firstValue, null, 2)}\n`, 'utf8');
    await writeFile(tempSecond, `${JSON.stringify(secondValue, null, 2)}\n`, 'utf8');
    await rename(tempFirst, firstPath);
    try { await rename(tempSecond, secondPath); }
    catch (error) {
      if (originalFirst === null) await unlink(firstPath);
      else await writeFile(firstPath, originalFirst, 'utf8');
      throw error;
    }
  } finally {
    await Promise.allSettled([unlink(tempFirst), unlink(tempSecond)]);
    // Both original files are read before either destination is replaced.
    void originalSecond;
  }
}

try {
  const [rows, manifest] = await Promise.all([
    loadRows(path.resolve(inputPath)),
    readFile(path.resolve(manifestPath), 'utf8').then(JSON.parse),
  ]);
  const errors = [];
  validateManifest(manifest, errors);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error(errors.join('\n') || 'Manifest must be an object');
  if (rows.length === 0) errors.push('Input has no players');
  const players = rows.map((row, index) => validatePlayer(row, index + 1, manifest, errors)).filter(Boolean);
  const ids = new Set();
  const identities = new Set();
  for (const player of players) {
    if (ids.has(player.id)) errors.push(`Duplicate player id: ${player.id}`);
    ids.add(player.id);
    const identity = `${player.name}\0${player.club}\0${player.number}`;
    if (identities.has(identity)) errors.push(`Duplicate name/club/number: ${player.name} ${player.club} ${player.number}`);
    identities.add(identity);
  }

  const report = {
    checkedAt: new Date().toISOString(), sourceUrl: manifest.sourceUrl ?? null,
    permissionEvidence: manifest.permissionEvidence ?? null,
    snapshotDate: manifest.snapshotDate ?? null, inputRows: rows.length,
    validPlayers: players.length, excludedPlayers: rows.length - players.length,
    errors, warning: players.length < 200 || players.length > 250 ? 'PRD target pool is about 200-250 first-team players; review the selected count.' : null,
  };
  if (reportPath) {
    const file = path.resolve(reportPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (errors.length) throw new Error(`${errors.length} validation error(s):\n${errors.slice(0, 25).join('\n')}${errors.length > 25 ? '\n...' : ''}`);

  players.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const dataset = { version: `2026-${manifest.snapshotDate}`, season: 2026, snapshotDate: manifest.snapshotDate, demo: false, players };
  const schedule = { startDate: manifest.startDate, players: scheduleOrder(players) };
  if (schedule.players.length !== players.length || new Set(schedule.players).size !== players.length || schedule.players.some((id) => !ids.has(id))) {
    throw new Error('Generated schedule does not contain exactly one entry per validated player');
  }
  const playerPath = path.join(projectRoot, 'src', 'players.json');
  const schedulePath = path.join(projectRoot, 'src', 'daily-schedule.json');
  const [existingPlayers, existingSchedule] = await Promise.all([readExisting(playerPath), readExisting(schedulePath)]);
  if (existingPlayers && existingPlayers.demo === false) {
    if (JSON.stringify(existingPlayers) !== JSON.stringify(dataset) || JSON.stringify(existingSchedule) !== JSON.stringify(schedule)) {
      throw new Error('A real snapshot already exists. Refusing to change a published data snapshot or answer order. Review and version a migration manually.');
    }
    console.log('Identical real snapshot already installed; no files changed.');
  } else if (checkOnly) {
    console.log(`Validated ${players.length} players; no game files changed (--check-only).`);
  } else {
    await replacePair(playerPath, dataset, schedulePath, schedule);
    console.log(`Imported ${players.length} players from ${manifest.snapshotDate}; fixed schedule starts ${manifest.startDate}.`);
  }
  if (report.warning) console.warn(report.warning);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

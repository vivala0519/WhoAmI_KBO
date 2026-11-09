#!/usr/bin/env node
// Build a local, unreleased top-250 preview from the user's two KBO CSV exports.
import { createHash } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const snapshotDate = '2026-11-05';
const fxSourceUrl = 'https://www.kita.net/cmmrcInfo/ehgtGnrlzInfo/rltmEhgt.do';
const salaryDefinition = '2026 KBO profile salary; contract options not independently verified';
const clubs = new Set(['LG', 'KT', 'SSG', '삼성', 'KIA', '두산', '롯데', 'NC', '한화', '키움']);
const positions = new Set(['투수', '포수', '내야수', '외야수']);
const teamEnglish = {
  LG: 'LG Twins', KT: 'KT Wiz', SSG: 'SSG Landers',
  삼성: 'Samsung Lions', KIA: 'Kia Tigers', 두산: 'Doosan Bears',
  롯데: 'Lotte Giants', NC: 'NC Dinos', 한화: 'Hanwha Eagles',
  키움: 'Kiwoom Heroes',
};

function arg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1];
}
const salaryFile = arg('--salary');
const allFile = arg('--all', salaryFile && path.join(path.dirname(salaryFile), 'kbo_players_2026_all.csv'));
const wikidataFile = arg('--wikidata', path.join(root, 'data', 'wikidata-candidates-2026.json'));
const startDate = arg('--start-date', snapshotDate);
const checkOnly = process.argv.includes('--check-only');
if (!salaryFile || !allFile || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
  console.error('Usage: node scripts/select-kbo-top250.mjs --salary salary_confirmed.csv [--all all.csv] [--wikidata candidates.json] [--start-date YYYY-MM-DD] [--check-only]');
  process.exit(2);
}
const startTime = Date.parse(startDate + 'T00:00:00Z');
if (!Number.isFinite(startTime) || new Date(startTime).toISOString().slice(0, 10) !== startDate || startDate < snapshotDate) {
  console.error('startDate must be a valid date on or after ' + snapshotDate);
  process.exit(2);
}

function parseCsv(source) {
  const rows = [];
  let record = [], field = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i++; }
      else if (!quoted && field) throw new Error('Unexpected CSV quote at offset ' + i);
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      record.push(field); field = '';
    } else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.some((cell) => cell !== '')) rows.push(record);
      record = [];
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (record.length || field) { record.push(field); rows.push(record); }
  const [head, ...values] = rows;
  if (!head || new Set(head).size !== head.length) throw new Error('Missing or duplicate CSV header');
  return values.map((cells, index) => {
    if (cells.length !== head.length) throw new Error('Wrong column count at CSV row ' + (index + 2));
    return Object.fromEntries(head.map((key, column) => [key, cells[column]]));
  });
}
function csvFromBuffer(buffer) {
  return parseCsv(buffer.toString('utf8').replace(/^\uFEFF/, ''));
}
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
function requireUniqueIds(rows, label) {
  const ids = new Set();
  for (const row of rows) {
    const id = row['고유id'];
    if (!/^\d+$/.test(id || '') || ids.has(id)) throw new Error(label + ' has invalid or duplicate player ID: ' + id);
    ids.add(id);
  }
}
function positiveInteger(raw) {
  const value = Number(raw);
  return raw !== '' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function validProfileUrl(value, id) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.koreabaseball.com' && url.searchParams.get('playerId') === id;
  } catch { return false; }
}
function addReason(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

const initials = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const medials = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const finals = ['', 'k', 'k', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk', 'lm', 'lp', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const surnames = {
  김: 'Kim', 이: 'Lee', 박: 'Park', 최: 'Choi', 정: 'Jung',
  강: 'Kang', 조: 'Cho', 윤: 'Yoon', 장: 'Jang', 임: 'Lim',
  한: 'Han', 신: 'Shin', 오: 'Oh', 서: 'Seo', 홍: 'Hong',
  유: 'Yoo', 노: 'Noh', 배: 'Bae', 문: 'Moon', 차: 'Cha',
  양: 'Yang', 황: 'Hwang', 손: 'Son', 송: 'Song', 전: 'Jeon',
  권: 'Kwon', 안: 'Ahn', 류: 'Ryu', 나: 'Na', 백: 'Baek',
  심: 'Shim', 민: 'Min', 하: 'Ha', 구: 'Koo', 고: 'Ko',
  진: 'Jin', 주: 'Joo', 원: 'Won', 천: 'Cheon', 허: 'Heo',
  남: 'Nam', 엄: 'Eom', 표: 'Pyo', 변: 'Byun', 채: 'Chae',
  염: 'Yeom', 설: 'Seol', 도: 'Do', 방: 'Bang', 마: 'Ma',
};
function romanizeSyllable(letter) {
  const code = letter.charCodeAt(0) - 44032;
  if (code < 0 || code >= 11172) return letter;
  const initial = Math.floor(code / 588);
  const medial = Math.floor((code % 588) / 28);
  const final = code % 28;
  return initials[initial] + medials[medial] + finals[final];
}
function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function romanizeName(name) {
  const letters = [...name];
  if (/^[가-힣]{3,4}$/.test(name) && surnames[letters[0]]) {
    return surnames[letters[0]] + ' ' + letters.slice(1).map((letter, index) =>
      (index === 0 ? title(romanizeSyllable(letter)) : romanizeSyllable(letter))).join('-');
  }
  return name.split(/\s+/).map((word) => title([...word].map(romanizeSyllable).join(''))).join(' ');
}
function makeLatinIndex(wikidata) {
  const names = new Map();
  for (const candidate of wikidata.candidates || []) {
    if (!candidate.nameKo || !candidate.nameEn || !/[A-Za-z]/.test(candidate.nameEn)) continue;
    const list = names.get(candidate.nameKo) || [];
    list.push(candidate);
    names.set(candidate.nameKo, list);
  }
  return names;
}
function englishAlias(name, birthYear, club, latinIndex) {
  const matches = (latinIndex.get(name) || []).filter((candidate) =>
    candidate.birthDate?.slice(0, 4) === String(birthYear) &&
    candidate.memberships?.some((membership) => membership.team === teamEnglish[club]));
  if (matches.length === 1) return { latin: matches[0].nameEn, latinSource: 'wikidata' };
  return { latin: romanizeName(name), latinSource: 'romanized' };
}
function scheduleOrder(players) {
  const digest = (id) => sha256(Buffer.from('whoami-kbo-2026-schedule-v1\0' + id));
  return players.map((player) => player.id).sort((a, b) => digest(a).localeCompare(digest(b)) || Number(a) - Number(b));
}
async function readExisting(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function replacePair(playerFile, dataset, scheduleFile, schedule) {
  const oldPlayers = await readFile(playerFile, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  const tempPlayers = playerFile + '.' + process.pid + '.tmp';
  const tempSchedule = scheduleFile + '.' + process.pid + '.tmp';
  try {
    await writeFile(tempPlayers, JSON.stringify(dataset, null, 2) + '\n');
    await writeFile(tempSchedule, JSON.stringify(schedule, null, 2) + '\n');
    await rename(tempPlayers, playerFile);
    try { await rename(tempSchedule, scheduleFile); }
    catch (error) {
      if (oldPlayers === null) await unlink(playerFile);
      else await writeFile(playerFile, oldPlayers);
      throw error;
    }
  } finally {
    await Promise.allSettled([unlink(tempPlayers), unlink(tempSchedule)]);
  }
}

try {
  const [salaryBuffer, allBuffer, wikidataBuffer] = await Promise.all([
    readFile(path.resolve(salaryFile)),
    readFile(path.resolve(allFile)),
    readFile(path.resolve(wikidataFile)),
  ]);
  const salaryRows = csvFromBuffer(salaryBuffer);
  const allRows = csvFromBuffer(allBuffer);
  requireUniqueIds(salaryRows, 'salary CSV');
  requireUniqueIds(allRows, 'all CSV');
  const allMap = new Map(allRows.map((row) => [row['고유id'], row]));
  const latinIndex = makeLatinIndex(JSON.parse(wikidataBuffer.toString('utf8')));
  const shared = [
    '선수명', '소속구단', '포지션', '키_cm', '출생연도', '연봉_연도',
    '연봉_원문', '연봉_통화', '연봉_금액', '연봉_상태', '구단_원문', '공식프로필_URL',
  ];
  const eligible = [];
  const exclusions = {};
  for (const salary of salaryRows) {
    const id = salary['고유id'];
    const detail = allMap.get(id);
    if (!detail) throw new Error('Salary row has no matching all.csv ID: ' + id);
    for (const key of shared) {
      if ((salary[key] || '').trim() !== (detail[key] || '').trim()) {
        throw new Error('CSV fields disagree for ID ' + id + ': ' + key);
      }
    }
    const number = detail['등번호']?.trim() || '';
    const club = salary['소속구단']?.trim() || '';
    const position = salary['포지션']?.trim() || '';
    const throwBat = (detail['투타유형'] || '').normalize('NFC').replace(/\s+/g, '');
    const birthYear = positiveInteger(salary['출생연도']);
    const heightCm = positiveInteger(salary['키_cm']);
    const original = positiveInteger(salary['연봉_금액']);
    const salaryKRW = positiveInteger(detail['연봉_원화환산']);
    const currency = salary['연봉_통화']?.trim() || '';
    const fxRate = currency === 'KRW' ? 1 : Number(detail['USD_KRW_적용환율']);
    const fxDate = currency === 'KRW' ? snapshotDate : detail['USD_KRW_환율기준일']?.trim();
    let excluded = false;
    const reject = (reason) => { addReason(exclusions, reason); excluded = true; };
    if (salary['연봉_연도'] !== '2026' || salary['연봉_상태'] !== '공개') reject('notConfirmed2026Salary');
    if (!/^\d{1,3}$/.test(number)) reject('missingOrInvalidJersey');
    if (!salary['선수명']?.trim()) reject('missingName');
    if (!clubs.has(club)) reject('invalidClub');
    if (!positions.has(position)) reject('invalidPosition');
    if (!/^(?:우투|좌투|우언|좌언|양투)(?:우타|좌타|양타)$/.test(throwBat)) reject('missingOrInvalidThrowBat');
    if (birthYear === null || birthYear < 1940 || birthYear > 2012) reject('missingOrInvalidBirthYear');
    if (heightCm === null || heightCm < 140 || heightCm > 220) reject('missingOrInvalidHeight');
    if (original === null) reject('missingOrInvalidOriginalSalary');
    if (salaryKRW === null) reject('missingOrInvalidKRWSalary');
    if (!['KRW', 'USD'].includes(currency)) reject('unsupportedCurrency');
    if (!validProfileUrl(salary['공식프로필_URL'], id)) reject('invalidProfileUrl');
    if (currency === 'USD' &&
      (!Number.isFinite(fxRate) || fxRate !== 1343.8 || fxDate !== snapshotDate ||
       (original !== null && salaryKRW !== Math.round(original * fxRate)))) reject('invalidUSDConversion');
    if (currency === 'KRW' && original !== null && salaryKRW !== original) reject('invalidKRWConversion');
    if (excluded) continue;
    const name = salary['선수명'].trim();
    const latin = englishAlias(name, birthYear, club, latinIndex);
    eligible.push({
      id, name, latin: latin.latin, latinSource: latin.latinSource,
      club, position, birthYear, number, heightCm,
      salaryOriginalAmount: original, salaryCurrency: currency,
      salarySourceText: salary['연봉_원문'], salaryDefinition,
      salaryKRW, fxRate, fxDate,
      sourceUrl: salary['공식프로필_URL'],
      snapshotDate, season: 2026,
      throwBat,
    });
  }
  if (eligible.length < 250) throw new Error('Only ' + eligible.length + ' players are eligible; need 250');
  eligible.sort((a, b) => b.salaryKRW - a.salaryKRW || Number(a.id) - Number(b.id));
  const selected = eligible.slice(0, 250);
  const cutoff = selected.at(-1).salaryKRW;
  const aboveCutoff = eligible.filter((player) => player.salaryKRW > cutoff).length;
  const tiedAtCutoff = eligible.filter((player) => player.salaryKRW === cutoff).length;
  const selectedTies = 250 - aboveCutoff;
  const dataset = {
    version: '2026-kbo-top250-' + snapshotDate + '-v1-throw-bat-v1',
    season: 2026,
    snapshotDate,
    demo: false,
    releaseReady: false,
    firstTeamVerified: false,
    rightsVerified: false,
    selectionRule: '2026 published salary with numeric jersey, descending converted KRW; ties by ascending numeric player ID',
    fxSourceUrl,
    players: selected,
  };
  const schedule = { startDate, players: scheduleOrder(selected) };
  if (new Set(schedule.players).size !== 250 || schedule.players.some((id) => !selected.some((player) => player.id === id))) {
    throw new Error('Schedule does not cover the selected pool exactly once');
  }
  const teamCounts = {};
  const currencyCounts = {};
  const latinSourceCounts = {};
  for (const player of selected) {
    addReason(teamCounts, player.club);
    addReason(currencyCounts, player.salaryCurrency);
    addReason(latinSourceCounts, player.latinSource);
  }
  const report = {
    snapshotDate,
    startDate,
    sourceFiles: {
      salary: { name: path.basename(salaryFile), sha256: sha256(salaryBuffer), rows: salaryRows.length },
      all: { name: path.basename(allFile), sha256: sha256(allBuffer), rows: allRows.length },
      wikidata: { name: path.basename(wikidataFile), sha256: sha256(wikidataBuffer) },
    },
    selection: {
      joinedSalaryRows: salaryRows.length,
      eligible: eligible.length,
      excluded: salaryRows.length - eligible.length,
      exclusionReasons: exclusions,
      exclusionReasonCountsMayOverlap: true,
      selected: 250,
      jerseyNumbersPreserveLeadingZeros: true,
      order: dataset.selectionRule,
      cutoffSalaryKRW: cutoff,
      aboveCutoff,
      tiedAtCutoff,
      selectedAtCutoff: selectedTies,
      teams: teamCounts,
      currencies: currencyCounts,
      latinSources: latinSourceCounts,
      firstTeamVerified: false,
      rightsVerified: false,
      salaryDefinitionNote: salaryDefinition,
    },
    rankedPlayers: selected.map((player, index) => ({
      rank: index + 1, id: player.id, name: player.name,
      club: player.club, number: player.number, salaryKRW: player.salaryKRW,
      currency: player.salaryCurrency, latinSource: player.latinSource,
    })),
  };
  const playerFile = path.join(root, 'src', 'players.json');
  const scheduleFile = path.join(root, 'src', 'daily-schedule.json');
  const reportFile = path.join(root, 'data', 'top250-selection-report.json');
  const existing = await readExisting(playerFile);
  const existingSchedule = await readExisting(scheduleFile);
  if (existing?.demo === false &&
    (JSON.stringify(existing) !== JSON.stringify(dataset) || JSON.stringify(existingSchedule) !== JSON.stringify(schedule))) {
    throw new Error('A non-demo snapshot already exists; refusing to change player data or the published answer schedule.');
  }
  if (!checkOnly && existing?.demo !== false) await replacePair(playerFile, dataset, scheduleFile, schedule);
  if (!checkOnly) await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log((checkOnly ? 'Checked' : 'Selected') + ' 250 of ' + eligible.length + ' eligible players. Cutoff ' + cutoff.toLocaleString('ko-KR') + ' KRW; ' + selectedTies + ' of ' + tiedAtCutoff + ' cutoff ties selected.');
  console.log('Latin aliases: ' + JSON.stringify(latinSourceCounts));
  if (checkOnly) console.log('No files changed (--check-only).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

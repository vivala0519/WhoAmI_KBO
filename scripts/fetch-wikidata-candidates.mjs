#!/usr/bin/env node
// Wikidata is CC0. This is a lead list, never the game's verified 2026 roster.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TEAM_NAMES = [
  'LG Twins', 'KT Wiz', 'SSG Landers', 'Samsung Lions', 'Kia Tigers',
  'Doosan Bears', 'Lotte Giants', 'NC Dinos', 'Hanwha Eagles', 'Kiwoom Heroes',
];

const SPARQL = `SELECT DISTINCT ?player ?nameKo ?nameEn ?teamName ?birthDate ?membershipStart ?membershipEnd WHERE {
  VALUES ?teamName { ${TEAM_NAMES.map((name) => `${JSON.stringify(name)}@en`).join(' ')} }
  ?team rdfs:label ?teamName .
  ?player p:P54 ?membership .
  ?membership ps:P54 ?team .
  OPTIONAL { ?membership pq:P580 ?membershipStart . }
  OPTIONAL { ?membership pq:P582 ?membershipEnd . }
  FILTER (!BOUND(?membershipStart) || ?membershipStart < "2027-01-01T00:00:00Z"^^xsd:dateTime)
  FILTER (!BOUND(?membershipEnd) || ?membershipEnd >= "2026-01-01T00:00:00Z"^^xsd:dateTime)
  OPTIONAL { ?player rdfs:label ?nameKo . FILTER (LANG(?nameKo) = "ko") }
  OPTIONAL { ?player rdfs:label ?nameEn . FILTER (LANG(?nameEn) = "en") }
  OPTIONAL { ?player wdt:P569 ?birthDate . }
}
LIMIT 2000`;

function argument(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1];
}

const contact = argument('--contact', process.env.WIKIDATA_CONTACT);
const output = path.resolve(argument('--out', 'data/wikidata-candidates-2026.json'));
if (!contact || !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || /^https?:\/\/\S+$/.test(contact))) {
  console.error('Provide an email or contact URL with --contact or WIKIDATA_CONTACT for the Wikimedia User-Agent.');
  process.exit(2);
}

const endpoint = new URL('https://query.wikidata.org/sparql');
endpoint.searchParams.set('query', SPARQL);
endpoint.searchParams.set('format', 'json');

try {
  const response = await fetch(endpoint, {
    headers: {
      'Accept': 'application/sparql-results+json',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': `WhoAmI-KBO/0.1 (${contact})`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const retry = response.headers.get('Retry-After');
    throw new Error(`Wikidata query returned HTTP ${response.status}${retry ? `; retry after ${retry}` : ''}`);
  }
  const result = await response.json();
  if (!Array.isArray(result?.results?.bindings)) throw new Error('Unexpected Wikidata response shape');

  const players = new Map();
  for (const binding of result.results.bindings) {
    const id = binding.player?.value?.match(/\/entity\/(Q\d+)$/)?.[1];
    if (!id) continue;
    const player = players.get(id) ?? {
      wikidataId: id,
      nameKo: binding.nameKo?.value ?? null,
      nameEn: binding.nameEn?.value ?? null,
      birthDate: binding.birthDate?.value?.slice(0, 10) ?? null,
      memberships: [],
      sourceUrl: `https://www.wikidata.org/wiki/${id}`,
    };
    const membership = {
      team: binding.teamName?.value ?? null,
      start: binding.membershipStart?.value?.slice(0, 10) ?? null,
      end: binding.membershipEnd?.value?.slice(0, 10) ?? null,
    };
    if (!player.memberships.some((item) => JSON.stringify(item) === JSON.stringify(membership))) {
      player.memberships.push(membership);
    }
    players.set(id, player);
  }
  const candidates = [...players.values()].sort((a, b) => a.wikidataId.localeCompare(b.wikidataId, 'en', { numeric: true }));
  const payload = {
    source: 'Wikidata Query Service',
    sourceUrl: endpoint.toString(),
    license: 'CC0',
    retrievedAt: new Date().toISOString(),
    seasonToVerify: 2026,
    verifiedRoster: false,
    note: 'Team statements without date qualifiers can describe former players. Verify every candidate and all game fields from a permitted source before import.',
    candidates,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Saved ${candidates.length} unverified Wikidata candidates to ${output}`);
} catch (error) {
  console.error(`Wikidata candidate fetch failed: ${error.message}`);
  process.exitCode = 1;
}

# 2026 선수 데이터 준비

게임의 `src/players.json`은 2026-11-05 기준 사용자 제공 CSV에서 만든 250명 로컬 미리보기다. `releaseReady: false`로 표시했으며, 1군 출전 여부와 광고 앱에서의 저장·가공·배포 권리는 아직 확인되지 않았다.

## 이번 250명 선정

제공된 `kbo_players_2026_salary_confirmed.csv`에는 등번호와 원화환산액이 없어 같은 출력 폴더의 `kbo_players_2026_all.csv`를 `고유id`로 결합했다. 연봉 확인 993명 중 숫자 등번호 문자열과 양수 원화 환산액, 여섯 단서가 완전한 선수는 871명이다. `0`, `00`, `02` 등 앞자리 0은 보존한다.

871명을 원화 환산 연봉 내림차순, 동률이면 숫자 선수 ID 오름차순으로 정렬해 250명을 선정했다. 250위는 9,000만 원이다. 그보다 높은 241명에 9,000만 원 동률 12명 중 ID가 앞선 9명을 더했다. 선정 결과는 원화 연봉 216명, 달러 연봉 34명이며 달러는 자료에 기록된 2026-11-05 고정 환율 1 USD = 1,343.80원으로 환산했다. 전체 순위와 입력 해시는 [선정 보고서](./data/top250-selection-report.json)에 있다.

```powershell
node scripts/select-kbo-top250.mjs --salary "C:\Users\seungho\Documents\Codex\2026-11-05\kbo\outputs\kbo_players_2026_salary_confirmed.csv" --check-only
```

스크립트는 같은 폴더의 `kbo_players_2026_all.csv`를 자동으로 읽는다. 영문 이름이 원본에 없어 Wikidata에서 한글 이름·출생연도·구단이 일치하는 85명의 영문 표기를 사용하고, 나머지 165명은 검색용 로마자 별칭을 생성했다. 생성 별칭은 공식 영문 이름으로 표시하지 않는다. 원본 검색 결과에는 퓨처스 및 과거 기록이 섞일 수 있어 250명 모두의 2026 1군 출전을 보증하지 않는다.

## 투타유형 보강

기존에 선정한 250명의 ID를 사용자 제공 `kbo_players_2026_all.json`과 결합해 `투타유형`을 `throwBat`으로 추가했다. 이름·소속·포지션·등번호·키·출생연도·연봉·환율 등 기존 값이 모두 일치하는지 검사했으며, 선수 250명과 순서 및 일일 정답 일정은 보존했다. [보강 보고서](./data/throw-bat-enrichment-report.json)에 원본 JSON 해시, 250명 전체 매칭, 유형별 인원과 일정 해시를 남겼다.

```powershell
node scripts/enrich-throw-bat.mjs --source "C:\Users\seungho\Documents\Codex\2026-11-05\kbo\outputs\kbo_players_2026_all.json" --check-only
```

`--check-only`를 빼면 기존 선수 필드는 유지한 채 투타유형만 반영한다. 공백을 제거해 `우투우타` 같은 표기로 정규화하며, 누락·알 수 없는 유형·중복 ID가 있으면 반영하지 않는다. 현재 250명은 모두 투타유형이 있다.

## 공개 출처와 권리 확인

- [KBO 선수 등록 현황](https://www.koreabaseball.com/Player/Register.aspx)은 조회 날짜의 구단·포지션·등번호·생년월일·체격을, [선수 상세](https://www.koreabaseball.com/Record/Player/PitcherDetail/Basic.aspx?playerId=64001)는 연봉을 보여준다. 하루의 등록 현황은 시즌 전체 출전 선수 목록이 아니다.
- [2026년 2월 소속 선수 공시](https://www.koreabaseball.com/MediaNews/Notice/View.aspx?bdSe=11831)의 621명은 1군 출전 명단이 아니다. [2026 연봉 보도자료](https://www.koreabaseball.com/MediaNews/Notice/View.aspx?bdSe=11861)의 국내 선수 529명 평균은 신인·외국인·아시아쿼터를 제외한 집계다. 외국인 관련 보도 금액에는 계약금이 섞일 수 있으므로 선수 상세의 순수 연봉과 혼합하지 않는다.
- [KBO 이용약관](https://www.koreabaseball.com/Etc/Policy.aspx) 제14조는 사전 서면 동의 또는 공식 API가 없는 자동 대량 수집과 수집 데이터의 재배포·타 플랫폼 연동·2차 가공을 제한한다. 해당 내용은 [개정 공지](https://www.koreabaseball.com/kbo/board/notice/View.aspx?boardSe=12148)에서 2026년 10월 14일 시행으로 안내됐다. 화면에 공개된 정보라는 사실만으로 미니앱 번들 배포 권한이 생기지 않는다.
- [Wikidata 구조화 데이터](https://www.wikidata.org/wiki/Help:Data_access)는 CC0이며 SPARQL 조회를 제공한다. 팀 소속 기록에 종료일이 없더라도 현재 2026 선수라는 뜻은 아니며, 여섯 단서와 시즌 연봉을 완전히 제공하지 않는다. 후보 발견용으로만 쓴다.

KBO 또는 데이터 제공처에서 실제 자료를 받으면 사용 허가의 **출처, 범위, 기간, 광고 앱 사용, 저장·가공·재배포** 증빙을 보관한다. KBO 관련 데이터 문의 창구는 [KBOP 데이터 비즈니스팀 공지](https://www.koreabaseball.com/MediaNews/Notice/View.aspx?bdSe=11918)에 기재돼 있다. 선수 사진과 구단 로고는 별도의 권리 확인이 필요하다.

## Wikidata 후보 조회

Wikimedia는 요청 식별용 User-Agent에 연락처를 요구한다. 프로젝트 루트에서 연락 가능한 이메일 또는 URL을 넣어 한 번 조회한다.

```powershell
node scripts/fetch-wikidata-candidates.mjs --contact you@example.com --out data/wikidata-candidates-2026.json
```

결과 파일은 `verifiedRoster: false`이며 게임 데이터로 자동 반영되지 않는다. 이전 소속과 날짜 한정 소속이 포함될 수 있으므로 선수마다 2026 소속 및 모든 단서를 별도로 확인한다. 조회가 429를 반환하면 `Retry-After` 이후 다시 시도한다.

## 허가된 CSV 또는 JSON 반영

CSV는 UTF-8 헤더를 사용한다. JSON은 같은 키를 가진 선수 배열 또는 `{ "players": [...] }` 형식이다. 필수 선수 필드는 다음과 같다.

| 필드 | 형식 |
|---|---|
| `id`, `name`, `latin` | 고유 ID, 한글 검색명, 영문 검색명 |
| `club` | 10개 구단 약칭 또는 정식 명칭. 출력은 `LG`, `KT`, `SSG`, `삼성`, `KIA`, `두산`, `롯데`, `NC`, `한화`, `키움`으로 통일 |
| `position` | `투수`, `포수`, `내야수`, `외야수` 또는 대응 영문 |
| `throwBat` | 완전한 투타유형. 예: `우투우타`, `우언우타`, `좌투좌타`, `우투양타` |
| `birthYear`, `heightCm` | 정수 |
| `number` | **1~3자리 숫자 문자열**. `"0"`, `"00"`, `"02"`처럼 앞자리 0을 보존 |
| `salaryOriginalAmount`, `salaryCurrency` | 원통화 **단위** 금액과 3자리 통화 코드. 예: 2억 원은 `200000000`, `KRW` |
| `sourceUrl` | 해당 선수를 검증할 수 있는 출처 URL. 모든 행이 같은 정식 파일이면 manifest의 `sourceUrl`을 공통으로 사용 가능 |

선택 선수 필드 `salaryKRW`, `salaryDefinition`, `fxRate`, `fxDate`, `snapshotDate`, `season`은 제공하면 manifest와 일치해야 한다. 외화의 `salaryKRW`는 `Math.round(salaryOriginalAmount × fxRate)`로 계산한다. 원화 행의 환율은 1이다. 계약금과 옵션을 뺀 2026 시즌 기본 연봉만 받는다.

데이터와 별도로 권리 및 스냅샷 manifest를 만든다. 아래 값은 **형식 예시**이며 실제 허가, 출처, 날짜, 환율로 교체해야 한다.

```json
{
  "season": 2026,
  "snapshotDate": "2026-10-12",
  "startDate": "2026-11-15",
  "sourceUrl": "https://licensed-provider.example/roster-2026",
  "permissionEvidence": "계약서 또는 사용 허가 문서 식별자",
  "commercialUseAllowed": true,
  "appRedistributionAllowed": true,
  "transformationsAllowed": true,
  "salaryDefinition": "2026 base salary; signing bonus and incentives excluded",
  "fxRate": 1462,
  "fxDate": "2026-10-12"
}
```

`fxRate`는 외화 1단위당 원화이며, 실제로 적용한 고정 환율과 기준일을 입력한다. 원화 선수만 있다면 `fxRate`는 `1`이다. manifest의 허용값은 운영자가 계약을 확인한 뒤 기록하는 선언이며 스크립트가 권리 자체를 판정하지는 못한다.

```powershell
node scripts/import-players.mjs --input path/to/roster.csv --manifest path/to/rights.json --check-only --report path/to/validation-report.json
node scripts/import-players.mjs --input path/to/roster.csv --manifest path/to/rights.json --report path/to/validation-report.json
```

검증에 성공하면 `src/players.json`과 `src/daily-schedule.json`을 만든다. 등번호 `0`과 `00`, 고유 ID, 여섯 단서 누락, 연봉 원화 환산, 출처, 날짜를 검사한다. 오류가 있으면 게임 파일을 바꾸지 않고 행별 사유를 보고한다. 정답 순서는 선수 ID로 결정되는 고정 해시 순서다. 실제 스냅샷이 한 번 설치된 뒤에는 동일 파일 재검증만 허용한다. 공개된 날짜의 정답이나 단서를 수정하려면 별도 버전 변경 및 이력 보존 작업이 필요하다.

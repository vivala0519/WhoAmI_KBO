# WhoAmI KBO

이 프로젝트는 앱인토스 야구 선수 맞히기 미니앱이다. 요구사항은 `PRD.md`를 참고한다.

화면을 만들거나 고칠 때는 `docs/design-guide.md`와 기존 스타일을 따른다. 본문은 15px 이상, 터치 영역은 44px 이상, 하단 CTA는 safe area 34px을 확보한다. 상단 플랫폼 내비게이션을 웹 화면에 다시 그리지 않는다. 꺾쇠와 화살표는 SVG 아이콘을 사용한다.

사용자가 지정한 UI 벤치마크는 형제 프로젝트 `WhoAmI`다. 큰 WHO AM I 타이틀, 아이콘 메뉴, 게임 패널, 도감 및 진행·카운트다운 카드의 구조와 네이비·블루 테마를 따른다. 파티클 공은 `public/particle-baseball.png`의 사용자 제공 이미지를 사용한다.

`src/players.json`에는 사용자 제공 CSV에서 선정한 250명의 로컬 미리보기 데이터가 있다. `releaseReady: false`는 1군 검증과 앱 배포 권리가 미확인이라는 뜻이다. `scripts/select-kbo-top250.mjs`와 `data/top250-selection-report.json`의 선정 기준을 유지한다. 선수 사진과 구단 로고는 별도 사용 권한 없이는 넣지 않는다. 공개한 `src/daily-schedule.json`의 날짜별 정답은 변경하지 않는다.

검증용 테스트 파일은 임시로만 만들고 실행 후 삭제한다. 프로젝트에 테스트 파일을 남기지 않는다.

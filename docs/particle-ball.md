# 파티클 야구공

`src/ParticleBall.tsx`와 `src/particle-ball.css`는 원본 WhoAmI의 Canvas 2D 파티클 공 동작을 재사용한다. 컴포넌트 API는 `<ParticleBall theme={theme} />`이며 테마는 `light` 또는 `dark`다.

`public/particle-baseball.png`는 사용자가 제공한 1315×1196 RGBA 이미지 원본이다. 배경은 투명하므로 별도 배경 제거를 하지 않았다. 이미지의 실제 색을 표본화해 야구공을 만들고, 밝은 테마에서는 흰 가죽의 명도를 낮춰 대비를 확보하며 어두운 테마에서는 남색 부분만 약간 밝힌다.

처음에는 입자가 모여 공을 이루고 계속 회전한다. 공을 짧게 누르면 250ms 동안 흩어지며, 누른 뒤 3초부터 900ms 동안 다시 모인다. 포인터 주변 입자는 밀렸다가 복원된다. 최대 30fps·DPR 2로 그리고 화면 밖과 숨긴 탭에서는 중단한다. 동작 줄이기 설정에서는 정지된 공을 표시하며 Canvas 실패 시 제공된 PNG를 표시한다.

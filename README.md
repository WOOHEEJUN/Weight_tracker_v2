# 몸무게 기록

개인용 Android 체중 기록 앱입니다. 기록은 단순하게 남기고, 실제 체중 점과 이동평균선으로 추세를 확인하는 데 집중합니다.

## 주요 기능

- 첫 실행 시 키, 시작 몸무게, 선택 목표 몸무게 저장
- 날짜별 체중 기록, 같은 날짜 기록은 업데이트
- 실제 체중 점과 7/14/30일 이동평균 그래프
- 목표 체중까지 남은 양과 진행률
- 인바디 기록을 체중 기록과 분리
- 기록별 한 줄 메모와 삭제
- 데이터는 기기 로컬 저장소에 저장

## 개발 실행

```bash
npm install
npm run android
```

## APK 빌드

`main` 브랜치에 푸시하면 GitHub Actions가 APK를 만들고 `latest-apk` 릴리스에 올립니다. GitHub Pages는 설치 페이지로 사용합니다.

- 설치 페이지: https://wooheejun.github.io/Weight_tracker_v2/
- 직접 APK: https://github.com/WOOHEEJUN/Weight_tracker_v2/releases/download/latest-apk/weight-tracker-v2.apk

Expo 계정으로 EAS Build를 사용할 수 있으면 아래 명령으로 APK를 만들 수 있습니다.

```bash
npm run build:apk
```

로컬 Android SDK가 준비되어 있으면 `npx expo prebuild --platform android` 후 Gradle 빌드로도 APK를 만들 수 있습니다.

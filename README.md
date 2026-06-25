# POE2 Tampermonkey 도구

Path of Exile 2용 Tampermonkey 유저스크립트 배포 저장소입니다.

## Exile Ledger

POE2 공개 창고 자산 분석 및 변동 추적 도구입니다.

1. Chrome에 [Tampermonkey](https://www.tampermonkey.net/)를 설치합니다.
2. [Exile Ledger 설치](https://filterblade-kr-localizer.netlify.app/poe2-currency-wealth.user.js) 링크를 엽니다.
3. Tampermonkey 설치 화면에서 `설치`를 누릅니다.
4. Path of Exile 사이트에 로그인하고 [POE2 거래소](https://www.pathofexile.com/trade2/search/poe2/)를 엽니다.
5. 화면 오른쪽 아래의 `Exile Ledger` 버튼을 누릅니다.

공개 탭 아이템과 수량은 GGG 거래 API에서, 시세는 poe.ninja에서 사용자의 브라우저가
직접 조회합니다. 계정 정보와 창고 데이터는 별도 서버에 저장하지 않습니다.

## FilterBlade 한국어 현지화

1. Chrome에 [Tampermonkey](https://www.tampermonkey.net/)를 설치합니다.
2. [FilterBlade 현지화 설치](https://filterblade-kr-localizer.netlify.app/poe2-kr-filterblade.user.js) 링크를 엽니다.
3. Tampermonkey 설치 화면에서 `설치`를 누릅니다.
4. [FilterBlade](https://www.filterblade.xyz/?game=Poe2)를 새로고침합니다.

## 업데이트

두 스크립트 모두 Tampermonkey가 배포 서버의 최신 버전을 주기적으로 확인합니다.

수동으로 확인하려면 Tampermonkey 대시보드에서 이 스크립트의 업데이트 확인 기능을 실행하세요.

## FilterBlade 주요 기능

- FilterBlade UI 및 게임 용어 한국어 표시
- 한글 아이템명 입력과 FilterBlade 영어 검색값 연동
- 아이템 툴팁에 요구 레벨 표시
- 한글 폰트 및 글자 잘림 보정

이 프로젝트는 팬 제작 도구이며 Grinding Gear Games 또는 FilterBlade와 제휴 관계가 없습니다.

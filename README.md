# World In Words

24개 국가·지역의 당일 헤드라인을 모으는 텍스트 전용 신문. 날짜는 한국 시간 기준이며 전날 기사는 자정부터 제외합니다. 제목 한국어 번역과 원어 전환을 제공합니다.

## 운영 사이트의 갱신

운영 사이트는 Sites Worker에서 Google News RSS를 직접 수집하고 전체 당일 수집본을 R2 BUCKET의 headlines/latest.json에 보관합니다. 컴퓨터나 PyCharm이 꺼져 있어도 사이트가 동작합니다. 기존 본인 계정 전용 접근 범위를 유지합니다.

GET /api/headlines는 저장된 당일 기사만 반환합니다. 수집본이 없으면 즉시 수집하고, 15분 이상 지난 수집본은 화면을 유지하면서 다시 수집합니다. 전날 기사는 반환하지 않습니다. 일부 국가가 실패하면 그 국가의 당일 수집본만 유지합니다. 전체 RSS 실패는 기존 수집본을 덮어쓰지 않고 503으로 보고합니다. 정상적인 빈 피드와 연결 실패를 구분합니다.

POST /api/refresh는 새 수집본을 저장하는 공유 갱신 경로입니다. 현재 owner-private Sites의 플랫폼 접근 경계로 보호됩니다. 사이트를 공개로 변경하려면 이 쓰기 경로에 별도 인증을 먼저 추가해야 합니다.

## 클라우드 예약 작업

매 실행은 Sites get_site로 동일 Site를 다시 열고, 현재 live URL과 플랫폼 서비스 접근 자격을 얻습니다. 자격은 메모리에서만 보관하며 해당 Site의 OAI-Sites-Authorization 헤더에만 사용합니다. POST /api/refresh 호출 후 GET /api/headlines를 읽어 collectedAt, end, 실제 발행일, 오류 수를 확인합니다. RSS는 공개 소스이며 연결 앱이나 방문자 동의가 필요하지 않습니다. 전체 실패 시 잠시 후 한 번만 재시도하고 실패 상태를 보고합니다. 소스 수정·재배포는 일상 갱신에 필요하지 않습니다. 토큰을 소스·로그·예약 문구에 넣지 않습니다.

## 로컬 실행

python3 scripts/serve.py 8765

http://localhost:8765 에서 열 수 있습니다. 이 주소는 서버가 실행 중일 때만 작동하며 컴퓨터가 꺼지거나 프로세스가 종료되면 연결이 거부됩니다. PyCharm의 HTML 미리보기나 파일 직접 열기는 수집 서버를 실행하지 않습니다.

Python 3.10+, curl과 네트워크 연결이 필요합니다. 시작 시 오래된 데이터를 수집하고 자정과 당일 15분 간격으로 갱신합니다. 수동 수집은 python3 scripts/collect.py이며 news.js와 dist/news.js를 동시에 갱신합니다.

## 배포 빌드

python3 scripts/build.py

기존 화면과 RSS 수집 설정을 dist/server/index.js의 Cloudflare 호환 Worker로 묶습니다. .openai/hosting.json의 project_id는 그대로 유지합니다. 자료는 국가별 최대 50개이며 실제 확보된 기사만 표시합니다. 국가 분류는 언론사·뉴스판 기준입니다.

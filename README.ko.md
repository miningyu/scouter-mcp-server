# Scouter MCP Server

[English](./README.md)

[Scouter APM](https://github.com/scouter-project/scouter)을 AI 에이전트와 연결하는 MCP (Model Context Protocol) 서버입니다. 자연어로 실시간 애플리케이션 성능 데이터를 조회하고 분석할 수 있습니다.

*"지난 1시간 중 가장 느린 SQL은?"*, *"TPS가 떨어지는 이유가 뭐야?"* 같은 질문에 실제 모니터링 데이터를 기반으로 답변합니다.

## 주요 기능

- **32개 도구** — Scouter API 전체 영역 커버
- **듀얼 프로토콜** — HTTP (REST API) 또는 TCP (바이너리 프로토콜) 연결
- **자동 해시 해석** — Scouter 내부 해시 ID를 SQL 쿼리, 서비스명, 에러 메시지 등 사람이 읽을 수 있는 텍스트로 자동 변환
- **실행 가능한 SQL** — 트랜잭션 프로필에서 바인드 파라미터가 치환된 SQL 제공, `EXPLAIN ANALYZE` 바로 실행 가능
- **외부 의존성 최소** — `@modelcontextprotocol/sdk`와 `zod`만 사용

## 빠른 시작

### npx로 바로 실행 (설치 불필요)

```bash
npx scouter-mcp-server
```

### 또는 소스에서 직접 빌드

```bash
cd scouter.mcp
npm install
npm run build
```

### 환경 변수 설정

Scouter 수집 서버를 가리키도록 환경 변수를 설정합니다:

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SCOUTER_API_URL` | Scouter webapp REST API 기본 URL | `http://localhost:6180` |
| `SCOUTER_API_ID` | API 로그인 ID | |
| `SCOUTER_API_PASSWORD` | API 로그인 비밀번호 | |
| `SCOUTER_API_TOKEN` | Bearer 토큰 (로그인 생략) | |
| `SCOUTER_TCP_HOST` | TCP 직접 연결 호스트 | |
| `SCOUTER_TCP_PORT` | TCP 직접 연결 포트 | `6100` |
| `SCOUTER_PROTOCOL` | `http` 또는 `tcp` 강제 지정 | 자동 감지 |
| `SCOUTER_ENABLE_WRITE` | `true`로 설정 시 쓰기 도구 활성화 | *(비활성)* |
| `SCOUTER_MASK_PII` | `false`로 설정 시 PII 마스킹 비활성화 (IP, 로그인, UserAgent, SQL 파라미터) | `true` |

**HTTP 모드** (권장) — `SCOUTER_API_URL` 설정. 32개 도구 모두 지원 (쓰기 도구는 `SCOUTER_ENABLE_WRITE=true` 필요).
**TCP 모드** — `SCOUTER_TCP_HOST` 설정. 경량, webapp 불필요. 일부 관리 도구 미지원.

> **참고:** 기본적으로 읽기 전용 도구(25개)만 등록됩니다. 쓰기 도구(`set_configure`, `set_alert_scripting`, `manage_kv_store`, `manage_shortener`, `control_thread`, `remove_inactive_objects`)를 사용하려면 `SCOUTER_ENABLE_WRITE=true`를 설정하세요.

### 3. MCP 클라이언트에 추가

**Claude Desktop** (`claude_desktop_config.json`):

HTTP 모드:

```json
{
  "mcpServers": {
    "scouter": {
      "command": "npx",
      "args": ["-y", "scouter-mcp-server"],
      "env": {
        "SCOUTER_API_URL": "http://your-scouter-server:6180",
        "SCOUTER_API_ID": "admin",
        "SCOUTER_API_PASSWORD": "your-password"
      }
    }
  }
}
```

TCP 모드:

```json
{
  "mcpServers": {
    "scouter": {
      "command": "npx",
      "args": ["-y", "scouter-mcp-server"],
      "env": {
        "SCOUTER_TCP_HOST": "your-scouter-server",
        "SCOUTER_TCP_PORT": "6100",
        "SCOUTER_API_ID": "admin",
        "SCOUTER_API_PASSWORD": "your-password"
      }
    }
  }
}
```

**Claude Code** (`-s user`로 글로벌 등록하면 모든 프로젝트에서 사용 가능):

```bash
# HTTP 모드
claude mcp add scouter -s user \
  -e SCOUTER_API_URL=http://your-scouter-server:6180 \
  -e SCOUTER_API_ID=admin \
  -e SCOUTER_API_PASSWORD=your-password \
  -- npx -y scouter-mcp-server

# TCP 모드
claude mcp add scouter -s user \
  -e SCOUTER_TCP_HOST=your-scouter-server \
  -e SCOUTER_TCP_PORT=6100 \
  -e SCOUTER_API_ID=admin \
  -e SCOUTER_API_PASSWORD=your-password \
  -- npx -y scouter-mcp-server
```

설정을 나중에 수정하려면 `~/.claude.json`을 직접 편집하거나, 삭제 후 다시 추가:

```bash
claude mcp remove scouter -s user
claude mcp add scouter -s user \
  -e SCOUTER_TCP_HOST=새주소 \
  -e SCOUTER_TCP_PORT=6100 \
  -e SCOUTER_API_ID=admin \
  -e SCOUTER_API_PASSWORD=your-password \
  -- npx -y scouter-mcp-server
```

## 도구 목록

### 성능 조사

| 도구 | 설명 |
|------|------|
| `get_system_overview` | 실시간 스냅샷 — TPS, 응답시간, CPU, 힙, 활성 서비스, 알림 |
| `diagnose_performance` | 자동 다단계 진단, 심각도 순 결과 (CRITICAL/WARNING/INFO) |
| `get_counter_trend` | 카운터 이력 조회 (TPS, ElapsedTime, CPU 등) |
| `search_transactions` | 시간/서비스/IP/로그인 기준 느린/에러 트랜잭션 검색 |
| `get_transaction_detail` | 전체 트랜잭션 프로필 — **실행 가능 SQL**, API 호출 추적 포함 |
| `list_active_services` | 현재 실행 중인 요청과 스레드 상태 |

### SQL & 데이터베이스

| 도구 | 설명 |
|------|------|
| `get_sql_analysis` | SQL 성능 랭킹 — 호출 수, 소요시간, 에러, 점유율 |
| `lookup_text` | 해시 ID를 SQL/서비스/에러 텍스트로 변환 |

### 에러 & 알림 분석

| 도구 | 설명 |
|------|------|
| `get_error_summary` | 빈도순 에러 분석 + 서비스별 에러율 |
| `get_alert_summary` | 시간 범위 내 알림 통계 |
| `get_alert_scripting` | 알림 스크립트 규칙 조회 |
| `set_alert_scripting` | 알림 규칙 생성/수정 (HTTP 전용) |

### 서비스 & 트래픽

| 도구 | 설명 |
|------|------|
| `get_service_summary` | 서비스별 성능 통계 + 외부 API 호출 분석 |
| `get_ip_summary` | 클라이언트 IP별 요청 분포 |
| `get_user_agent_summary` | 브라우저/User-Agent별 요청 분포 |
| `get_visitor_stats` | 고유 방문자 수 (실시간, 일별, 시간별) |
| `get_interaction_counters` | 서비스 간 호출 관계 |

### 인프라

| 도구 | 설명 |
|------|------|
| `get_thread_dump` | 스레드 덤프 + 스택 트레이스 |
| `get_host_info` | 호스트 Top 프로세스, 디스크 사용량 |
| `get_agent_info` | 에이전트 런타임 정보 (스레드, 환경변수, 소켓) |
| `get_server_info` | 수집 서버 메타데이터 및 카운터 모델 |

### 분산 추적

| 도구 | 설명 |
|------|------|
| `get_distributed_trace` | GXID로 서비스 간 트랜잭션 추적 |
| `get_realtime_xlogs` | 실시간 트랜잭션 스트림 |
| `get_raw_xlog` | Raw XLog 데이터 (5가지 조회 모드) |
| `get_raw_profile` | Raw 프로필 스텝 (해시 ID 포함) |

### 설정 & 관리

| 도구 | 설명 |
|------|------|
| `get_configure` | 서버/에이전트 설정 조회 |
| `set_configure` | 설정 변경 (HTTP 전용) |
| `control_thread` | 스레드 일시정지/재개/중단 |
| `manage_kv_store` | 글로벌/네임스페이스/프라이빗 키-값 저장소 |
| `manage_shortener` | URL 단축 서비스 |
| `remove_inactive_objects` | 비활성 에이전트 정리 (HTTP 전용) |

## 아키텍처

```
┌─────────────────────────────┐
│  AI 에이전트 (Claude 등)     │
│  "앱이 왜 느려?"             │
└──────────┬──────────────────┘
           │ MCP (stdio)
┌──────────▼──────────────────┐
│  Scouter MCP Server         │
│  ┌────────────────────────┐ │
│  │ Tool Hub (31개 도구)   │ │
│  │ 해시 해석 엔진          │ │
│  │ SQL 파라미터 바인딩     │ │
│  └────────────────────────┘ │
└──────────┬──────────────────┘
           │ HTTP REST 또는 TCP Binary
┌──────────▼──────────────────┐
│  Scouter 수집 서버           │
│  + Webapp (REST API)        │
└──────────┬──────────────────┘
           │
    ┌──────▼──────┐
    │ Java 에이전트│
    │ Host 에이전트│
    └─────────────┘
```

### 프로젝트 구조

```
scouter.mcp/
├── index.ts                 # 진입점 — stdio 전송 + SIGINT 처리
├── server/
│   └── index.ts             # createServer() 팩토리 → { server, cleanup }
├── tools/
│   ├── index.ts             # registerAllTools() 허브 — 전체 도구 명시적 import
│   ├── shared-utils.ts      # 해시 해석, SQL 파라미터 바인딩
│   └── ... (31개 도구 파일)
├── client/
│   ├── index.ts             # 클라이언트 파사드 — client, jsonStringify, catchWarn 등
│   ├── interface.ts         # ScouterClient 인터페이스 + 타입
│   ├── http.ts              # HTTP/REST 구현체
│   └── tcp.ts               # TCP 바이너리 프로토콜 구현체
├── protocol/
│   ├── tcp-connection.ts    # TCP 연결 (핸드셰이크/인증)
│   ├── packs.ts             # Scouter 바이너리 팩 정의
│   ├── values.ts            # 값 타입 직렬화
│   ├── data-input.ts        # 바이너리 역직렬화
│   ├── data-output.ts       # 바이너리 직렬화
│   └── constants.ts         # 프로토콜 상수
├── time-utils.ts            # 시간 파싱 유틸리티
├── __tests__/               # Vitest 테스트 스위트
├── vitest.config.ts         # 테스트 설정 (v8 커버리지)
├── tsconfig.json            # NodeNext 모듈
└── package.json
```

## 개발

```bash
npm run dev            # 감시 모드 (tsc --watch)
npm test               # 테스트 실행
npm run test:coverage  # 커버리지 리포트
npm run build          # 프로덕션 빌드
```

### 새 도구 추가하기

1. `tools/my-tool.ts` 파일 생성, `register(server: McpServer)` 함수를 `server.registerTool()`로 구현
2. `tools/index.ts`에 `import { register as registerMyTool } from "./my-tool.js"` 추가
3. `registerAllTools()` 안에서 `registerMyTool(server)` 호출
4. 해시 해석과 SQL 바인딩은 `shared-utils.ts` 활용

## 프로토콜 상세

### HTTP 모드

Scouter webapp REST API(`/scouter/v1/*`)에 연결합니다. 설정 변경, 알림 스크립팅, 스레드 제어 등 쓰기 작업을 포함한 32개 도구 모두 지원합니다.

인증: 사용자명/비밀번호 로그인 후 Bearer 토큰 자동 갱신 (401 시 재로그인).

### TCP 모드

Scouter 수집 서버에 바이너리 프로토콜(포트 6100)로 직접 연결합니다. 핸드셰이크 시 NetCafe 매직 넘버(`0xCAFE2001`)를 사용하며, SHA-256 해시된 비밀번호로 로그인합니다.

읽기 전용 도구만 지원합니다. 쓰기 작업(설정, 알림, KV 스토어, URL 단축)은 `UnsupportedOperationError`를 발생시킵니다.

텍스트 해시 해석은 `GET_TEXT_100` 명령을 사용하며 날짜별 캐싱을 지원합니다.

## 요구 사항

- Node.js >= 18
- Scouter 수집 서버 >= 2.x, webapp 활성화 (HTTP 모드)

## 라이선스

Apache License 2.0 — Scouter 프로젝트와 동일합니다.

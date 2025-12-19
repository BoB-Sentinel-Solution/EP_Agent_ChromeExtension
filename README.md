# Sentinel CE Agent (EP_Agent_ChromeExtension)

Sentinel Solution 환경에서 **브라우저(Chrome) 기반 LLM 웹 서비스 사용 시** 프롬프트/파일 업로드를 **정책 기반으로 사전 점검(hold) → 서버 판단 → 허용/차단/마스킹/파일교체**까지 수행하는 **Chrome Extension 에이전트(CE_Agent)** 입니다.

- Extension name: **Sentinel CE Agent**
- Manifest: **MV3**
- Version: **1.1.2**
- Default server endpoint: `https://bobsentinel.com/api/logs`

---

## 1) 주요 기능

### 프롬프트(텍스트) 유출 방지
- 사용자가 “전송(Enter / Send 버튼)”을 누르는 순간을 가로채 **전송을 HOLD**
- Sentinel Server로 프롬프트를 전송하여 정책 판단 수행
- 서버 응답에 따라
  - **차단**: 알림 표시 후 전송 중단
  - **허용 + 마스킹/치환**: `modified_prompt`로 입력창 내용을 교체한 뒤 전송 재개

### 파일 업로드 유출 방지 (사전 검사 + 교체)
- 브라우저에서 파일 선택/드래그&드롭/붙여넣기 시점에 pending으로 기록
- 실제 업로드는 네트워크 레벨에서 발생하므로,
  - `fetch` / `XMLHttpRequest`를 **MAIN world에서 래핑**해 업로드 body(FormData/Blob/File)를 탐지
  - 업로드 직전에 Sentinel Server로 파일(지원 포맷만) base64 인코딩 전송하여 정책 판단
- 서버 응답에 따라
  - **차단**: 업로드 요청 abort 또는 에러로 중단
  - **허용 + 파일 교체**: 서버가 내려준 `attachment`로 업로드 파일을 새 파일로 교체하여 전송

---

## 2) 동작 구조 (아키텍처)

### 구성 요소
- **Content Script (isolated world)**
  - `src/content/inject.js` : 프롬프트 hold/replace 로직, collector 연결
  - `src/content/file_hook.js` : MAIN world에서 전달받은 파일을 인코딩/서버로 사전검사
- **Injected Script (MAIN world)**
  - `src/content/file_hook_main.js` : `fetch`/`XHR` 래핑 + 파일 업로드 직전 교체/차단 실행
- **Service Worker (background)**
  - `src/background/sw.js` : 서버로 JSON POST, 타임아웃 관리(10s)

### 데이터 흐름(프롬프트)
1. 사용자가 LLM 입력창에서 전송(Enter/Send) 시도  
2. Collector가 이벤트를 가로채 HOLD  
3. `chrome.runtime.sendMessage(SENTINEL_PROCESS)` → SW가 서버로 POST  
4. 서버 응답:
   - `allow=false` → 차단 알림
   - `modified_prompt` → 입력창 교체 후 전송

### 데이터 흐름(파일)
1. 사용자가 파일 선택(change/drop/paste) → pending에 기록  
2. 실제 업로드 요청이 발생하는 순간(MAIN world에서 fetch/XHR body 탐지)
3. `file_hook_main.js`가 `file_hook.js`로 파일을 postMessage 전달  
4. `file_hook.js`가 파일을 base64 인코딩 → SW 통해 서버로 POST  
5. 서버 응답:
   - `allow=false` → 업로드 중단
   - `attachment.file_change=true` → 파일 교체 후 업로드

---

## 3) 지원 LLM 서비스(기본 매칭)

`manifest.json` 기준으로 아래 도메인에서 content script가 동작합니다.

- ChatGPT: `chatgpt.com`, `chat.openai.com`
- Gemini: `gemini.google.com`
- Claude: `claude.ai`
- DeepSeek: `chat.deepseek.com`, `deepseek.com`
- Groq: `groq.com`, `console.groq.com`
- Grok: `grok.com`
- Perplexity: `perplexity.ai`, `www.perplexity.ai`
- Poe: `poe.com`
- Mistral: `chat.mistral.ai`
- Cohere: `cohere.com`, `*.cohere.com`
- HuggingFace: `huggingface.co`
- You: `you.com`
- OpenRouter: `openrouter.ai`

> 신규 서비스 추가 시 `src/content/collectors/`에 collector를 추가하고, `manifest.json`의 `matches`에 도메인을 추가하세요.

---

## 4) 지원 파일 포맷

파일 사전검사는 아래 확장자/타입만 처리합니다.

- 이미지: `png`, `jpg`, `jpeg`, `webp`
- 문서: `pdf`, `docx`, `pptx`, `xlsx`
- 텍스트: `csv`, `txt`

지원하지 않는 포맷은 `skipped: true (unsupported_format)`로 처리되며 업로드는 기본적으로 방해하지 않습니다.

---

## 5) 설치 방법 (개발자 모드)

1. Chrome → `chrome://extensions`
2. 우측 상단 **Developer mode** ON
3. **Load unpacked** 클릭
4. 이 레포의 `sentinel-ext/` 디렉터리를 선택
5. 툴바에서 Sentinel 아이콘 클릭 → 상태 확인

---

## 6) 설정 (Options)

확장프로그램 아이콘 → **Options**에서 설정합니다.

- **PCName**
  - 자동 생성: `CE-` + UUID 앞 8자리
  - 로컬 저장되며 동일 기기에서 고정 유지
- **Solution Server URL**
  - 기본값: `https://bobsentinel.com/api/logs`
  - 다른 도메인/경로 사용 시 반드시 `manifest.json > host_permissions`에도 추가해야 합니다.
- **Enabled**
  - 기본 ON
  - OFF 시: 프롬프트/파일 모두 서버로 보내지 않고 그대로 전송

### 저장 키(chrome.storage.local)
- `sentinel_enabled`
- `sentinel_endpoint_url`
- `sentinel_pc_name`
- `sentinel_uuid`

>
(UI 호환을 위해 `enabled`, `endpointUrl`, `deviceId`, `pcName` legacy 키도 같이 관리/마이그레이션합니다.)

---

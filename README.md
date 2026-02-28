# PageNode

전공 서적에서 개념을 추출하고, 지식 그래프로 시각화하며, 반복 퀴즈로 학습하는 데스크톱 앱

## 기술 스택

- **프론트엔드**: Tauri 2 + React 19 + TypeScript + Vite 7
- **백엔드**: Python 3.12 + FastAPI (사이드카 패턴)
- **데이터베이스**: SQLite + ChromaDB (벡터) + Kuzu (그래프)
- **LLM**: Ollama (권장) 또는 llama-cpp-python (GGUF)

## 주요 기능

- PDF 업로드 및 텍스트 추출 (PyMuPDF)
- 청크 분할 + 임베딩 (all-MiniLM-L6-v2)
- 로컬 LLM을 활용한 개념 자동 추출
- Cytoscape.js 기반 지식 그래프 시각화
- SM-2 알고리즘 기반 간격 반복 퀴즈
- 퀴즈 결과에 따른 그래프 숙달도 자동 반영

## 개발 환경 설정

### 요구사항

- Node.js 20+
- Python 3.12+
- Rust (rustup)
- [Ollama](https://ollama.com/) (LLM 추론용, 선택)

### 설치 및 실행

```bash
# 프론트엔드 의존성
npm install

# 백엔드 가상 환경
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 개발 서버 시작
cd ..
bash scripts/dev.sh
```

## 프로덕션 빌드

```bash
# 백엔드 바이너리 빌드 (PyInstaller) + Tauri 번들
bash scripts/build.sh
```

빌드 결과물은 `src-tauri/target/release/bundle/` 에 생성됩니다.

## 데이터 저장 경로

```
~/.pagenode/data/    # SQLite, ChromaDB, Kuzu, PDF 파일
~/.pagenode/models/  # GGUF 모델 파일
```

## 릴리스

`v*` 태그 푸시 시 GitHub Actions가 자동으로 Linux (.deb, .AppImage), macOS (.dmg), Windows (.msi) 패키지를 빌드합니다.

## 라이선스

MIT

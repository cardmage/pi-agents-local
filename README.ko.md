# pi-agents-local

[English](README.md) | **한국어**

> 이 저장소의 코드는 AI가 생성했으며 사람이 리뷰하지 않았습니다.

![AI generated, not reviewed by a human](https://img.shields.io/badge/AI%20generated-not%20reviewed%20by%20a%20human-orange)

[Pi](https://github.com/earendil-works/pi) 확장입니다. Pi가 `AGENTS.md`를 컨텍스트에 넣을 때, 같은 폴더의 `AGENTS.local.md`도 함께 넣습니다.

- `AGENTS.md`: 팀/프로젝트 설정
- `AGENTS.local.md`: 추가 개인 설정

## 설치

```sh
pi install git:github.com/cardmage/pi-agents-local
```

설치하지 않고 한 번만 써 보려면:

```sh
pi -e git:github.com/cardmage/pi-agents-local
```

Pi 1.5.2에서 확인했습니다.

## 동작

- Pi가 로드한 컨텍스트 파일(`AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`)마다, 같은 폴더의 `AGENTS.local.md`를 바로 뒤에 넣습니다. agent 디렉터리(`~/.pi/agent`), 작업 디렉터리, 그 상위 디렉터리에 모두 적용됩니다.
- Pi가 그 폴더의 컨텍스트 파일을 로드하지 않았으면 `AGENTS.local.md`도 넣지 않습니다. 그래서 `AGENTS.md` 없이 `AGENTS.local.md`만 있는 폴더, `--no-context-files`로 실행한 경우, 다른 확장이 컨텍스트 파일을 뺀 경우에는 들어가지 않습니다.
- `AGENTS.md`와 마찬가지로 세션마다 한 번 읽습니다. 수정한 내용은 `/reload` 하거나 새 세션을 시작하면 반영됩니다.
- `/agents-local` 명령으로 추가된 파일을 확인할 수 있습니다.

## 알려진 문제

### pi-subagents의 포그라운드 서브에이전트에는 `AGENTS.local.md`가 들어가지 않음

[pi-subagents](https://github.com/nicobailon/pi-subagents)는 기본적으로 서브에이전트를 백그라운드로 실행하고, 이때는 이 확장이 동작합니다. 프로젝트 컨텍스트를 상속하는 서브에이전트에는 `AGENTS.local.md`가 들어가고, 상속하지 않는 서브에이전트에는 들어가지 않습니다.

포그라운드 서브에이전트(`async: false`)는 부모 Pi 프로세스 안에서 실행되며, pi-subagents는 여기에 사용자가 설치한 확장을 로드하지 않습니다. 그래서 `AGENTS.md`는 들어가지만(Pi가 직접 로드) `AGENTS.local.md`는 빠집니다.

포그라운드 서브에이전트에서도 이 확장을 로드하려면 `~/.pi/agent/settings.json`에 설치된 경로를 추가하세요.

```json
{
  "subagents": {
    "defaultSubagentOnlyExtensions": ["~/.pi/agent/git/github.com/cardmage/pi-agents-local"]
  }
}
```

pi-subagents 0.89.1에서 확인했습니다. pi-subagents 문서에 따르면 자체 `subagentOnlyExtensions`를 설정한 에이전트는 이 기본값을 쓰지 않으므로, 그 목록에도 경로를 추가해야 합니다.

### Pi 시작 화면에 표시되지 않음

Pi 시작 화면의 목록에는 Pi가 직접 로드한 컨텍스트 파일만 나옵니다. `AGENTS.local.md`는 `/agents-local` 명령으로 확인하세요.

## 테스트

```sh
npm test
```

의존성 설치는 필요 없습니다(Node 22.18 이상). `test/e2e.test.ts`는 설치된 `pi` CLI를 임시 agent 디렉터리와 로컬 모의 서버로 실행해서, 실제로 전송되는 요청의 시스템 프롬프트를 검사합니다. 사용자의 Pi 설정을 건드리거나 실제 모델을 호출하지 않으며, `pi`가 없으면 건너뜁니다.

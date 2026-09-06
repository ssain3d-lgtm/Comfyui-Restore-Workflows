# Comfyui-Restore-Workflows

ComfyUI의 `user/default/workflows` 폴더를 **로컬 Git으로 자동 버전 관리**하고,
ComfyUI 사이드바에서 과거 Workflow 전체 상태를 확인/복구하는 커스텀 노드입니다.

## 주요 기능

- ComfyUI 시작 시 `user/default/workflows` 자동 `git init`
- 현재 Workflow 전체를 최초 Snapshot으로 저장
- Workflow 파일 변경 감지
- 변경이 약 6초간 멈추면 자동 Commit
- ComfyUI 사이드바의 **Workflow Git** 탭에서 최근 200개 Commit 확인
- Commit 시간 / Commit 메시지 / 변경 파일을 동시에 표시
- Commit 선택 시 unified diff 표시
- 변경 파일 클릭 시 해당 Commit 당시의 실제 파일 내용(JSON)을 표시
- 원하는 Commit을 선택해 **workflows 폴더 전체를 그 시점으로 복구**
- 복구 직전 현재 디스크 상태를 `Safety snapshot before restore`로 자동 보존
- 복구 작업도 새 Commit으로 남기므로 다시 되돌릴 수 있음
- GitHub Push 없음. Workflow 이력은 `workflows/.git`에 로컬 저장

## 설치

필수: **Git for Windows**가 설치되어 있고 `git` 명령이 PATH에서 실행 가능해야 합니다.

이 저장소를 다음 위치에 설치합니다.

```text
ComfyUI/
└─ custom_nodes/
   └─ Comfyui-Restore-Workflows/
      ├─ __init__.py
      ├─ workflow_git.py
      └─ web/
         └─ js/
            └─ workflow_git.js
```

예시:

```text
D:\ComfyUI-Easy-Install\ComfyUI-Easy-Install\ComfyUI\custom_nodes\Comfyui-Restore-Workflows
```

그 후 ComfyUI를 재시작합니다.

## 정상 동작 확인

ComfyUI 콘솔에 다음과 비슷한 로그가 표시됩니다.

```text
[Restore Workflows] git init: ...\user\default\workflows
[Restore Workflows] initial snapshot created
[Restore Workflows] watching ...\user\default\workflows (auto commit after 6s idle)
```

그리고 아래 폴더가 생성됩니다.

```text
ComfyUI\user\default\workflows\.git
```

## 사용 방법

1. ComfyUI 왼쪽 사이드바에서 **Workflow Git**(History 아이콘)을 엽니다.
2. Commit 목록에서 수정 시간을 확인합니다.
3. Commit을 클릭합니다.
4. 해당 시점에서 변경된 파일과 diff를 확인합니다.
5. 파일명을 클릭하면 그 Commit 당시의 JSON 내용을 볼 수 있습니다.
6. 복구할 시점을 정했다면 **이 시점으로 전체 복구**를 누릅니다.
7. 복구가 끝나면 현재 열려 있던 Workflow를 다시 열어 디스크의 복구본을 불러옵니다.

## 복구 안전성

복구 버튼을 누르면 다음 순서로 처리합니다.

```text
현재 workflows 상태
   ↓
미커밋 변경이 있으면 Safety Snapshot 자동 Commit
   ↓
선택한 과거 Commit의 전체 Tree 복원
   ↓
Restore workflows to ... 새 Commit 생성
```

즉, 과거 Commit으로 `git reset --hard`하여 이력을 잘라내는 방식이 아닙니다.
복구 자체도 새로운 이력으로 남습니다.

## 주의

- 설치 전에 이미 사라진 Workflow 버전은 이 도구가 복구할 수 없습니다.
- Git은 **디스크에 저장된 Workflow 파일**을 추적합니다. 아직 ComfyUI 캔버스에서 저장하지 않은 변경은 Git에 존재하지 않습니다.
- 현재 버전은 기본 사용자 경로인 `user/default/workflows`를 대상으로 합니다.
- Workflow 내용이 매우 큰 경우 UI 보호를 위해 diff/파일 내용 표시가 약 1 MB에서 잘릴 수 있지만, Git에 저장되는 실제 파일은 잘리지 않습니다.

## 라이선스

MIT

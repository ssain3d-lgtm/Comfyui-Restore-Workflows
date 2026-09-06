# Comfyui-Restore-Workflows

> ComfyUI Workflow Git auto-backup, history viewer, and full-folder restore tool.

ComfyUI의 `user/default/workflows` 폴더를 **로컬 Git으로 자동 버전 관리**하고, ComfyUI 사이드바에서 과거 Workflow 상태를 시간/변경 파일/diff와 함께 확인한 뒤 원하는 시점으로 전체 복구하는 커스텀 노드입니다.

![Workflow Git Preview](docs/workflow-git-preview.svg)

> 위 이미지는 현재 구현된 사이드바 UI 구조를 재현한 preview입니다. 실제 ComfyUI 테마/버전에 따라 표시가 조금 다를 수 있습니다.

---

## 한국어

### 주요 기능

- ComfyUI 시작 시 `user/default/workflows`를 자동으로 Git 저장소로 초기화
- 현재 Workflow 전체를 최초 Snapshot으로 저장
- Workflow 파일 변경 감지
- 변경이 약 6초간 멈추면 자동 Commit
- ComfyUI 왼쪽 사이드바에 **Workflow Git** 탭 추가
- 최근 Commit의 날짜/시간, Commit 메시지, 변경된 Workflow 파일 표시
- Commit 선택 시 실제 Git diff 표시
- 변경 파일 클릭 시 해당 Commit 당시의 실제 JSON 내용 표시
- 파일명 / Commit 메시지 검색
- 원하는 Commit을 선택해 **workflows 폴더 전체를 해당 시점으로 복구**
- 복구 직전 현재 상태를 `Safety snapshot before restore`로 자동 저장
- 복구 작업 자체도 새 Commit으로 남김
- 따라서 잘못 복구해도 다시 이전 상태로 돌아갈 수 있음
- GitHub Push 없음. 모든 Workflow 이력은 `workflows/.git`에 로컬 저장

### 설치

필수 조건:

- **Git for Windows** 설치
- `git` 명령이 PATH에서 실행 가능해야 함

저장소를 ComfyUI `custom_nodes` 아래에 설치합니다.

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

Git으로 설치하려면:

```powershell
cd "D:\ComfyUI-Easy-Install\ComfyUI-Easy-Install\ComfyUI\custom_nodes"
git clone https://github.com/ssain3d-lgtm/Comfyui-Restore-Workflows.git
```

설치 후 ComfyUI를 재시작합니다.

### 정상 동작 확인

ComfyUI 콘솔에 다음과 비슷한 로그가 표시됩니다.

```text
[Restore Workflows] git init: ...\user\default\workflows
[Restore Workflows] initial snapshot created
[Restore Workflows] watching ...\user\default\workflows (auto commit after 6s idle)
```

그리고 아래 경로에 Git 데이터가 생성됩니다.

```text
ComfyUI\user\default\workflows\.git
```

### 사용 방법

1. ComfyUI 왼쪽 사이드바에서 **Workflow Git** 탭을 엽니다.
2. Commit 목록에서 원하는 수정 시간을 찾습니다.
3. Commit을 클릭합니다.
4. 그 시점에 변경된 Workflow 파일과 diff를 확인합니다.
5. 파일명을 클릭하면 해당 Commit 당시의 JSON 내용을 확인할 수 있습니다.
6. 복구할 시점을 정했다면 **이 시점으로 전체 복구**를 누릅니다.
7. 복구가 끝나면 현재 열려 있던 Workflow를 다시 열어 디스크의 복구본을 불러옵니다.

### 자동 백업 방식

```text
Workflow 저장/수정
      ↓
파일 변경 감지
      ↓
약 6초간 추가 변경 없음
      ↓
Git add -A
      ↓
자동 Commit
```

변경이 없는 경우에는 Commit을 만들지 않습니다.

### 복구 안전성

복구 버튼을 누르면 다음 순서로 처리합니다.

```text
현재 workflows 상태
      ↓
미커밋 변경이 있으면
Safety Snapshot 자동 Commit
      ↓
선택한 과거 Commit의 전체 Tree 복원
      ↓
Restore workflows to ... 새 Commit 생성
```

과거 Commit으로 `git reset --hard`해서 이후 이력을 잘라내는 방식이 아닙니다.

즉:

```text
A → B → C → D
        ↑
        C 시점 복구
```

하면 실제 Git 이력은 대략 아래처럼 유지됩니다.

```text
A → B → C → D → Restore-to-C
```

따라서 `D`도 계속 남아 있습니다.

### 주의사항

- 설치하기 전에 이미 덮어써지거나 삭제된 Workflow 버전은 이 도구가 복구할 수 없습니다.
- Git은 **디스크에 저장된 Workflow 파일**을 추적합니다. 캔버스에서 수정만 하고 아직 저장하지 않은 내용은 Git에 존재하지 않습니다.
- 기본 대상 경로는 `user/default/workflows`입니다.
- 매우 큰 Workflow는 UI 보호를 위해 diff/파일 preview 표시가 약 1 MB에서 잘릴 수 있습니다. 실제 Git에 저장되는 원본 파일은 잘리지 않습니다.
- 복구 직후 이미 열려 있는 ComfyUI 캔버스가 자동으로 과거 상태로 바뀌는 것은 아닙니다. 해당 Workflow를 다시 열어야 복구된 파일이 표시됩니다.

---

## English

### Overview

**Comfyui-Restore-Workflows** automatically versions your ComfyUI `user/default/workflows` directory with a local Git repository and adds a **Workflow Git** sidebar panel to ComfyUI.

It is designed for cases where a workflow is accidentally overwritten by another workflow, corrupted, deleted, or saved in the wrong state.

You can browse previous snapshots by date and time, inspect changed files and Git diffs, view the actual JSON stored in a selected commit, and restore the entire workflows directory to that point in history.

### Features

- Automatically initializes Git inside `user/default/workflows`
- Creates an initial snapshot on first launch
- Watches workflow files while ComfyUI is running
- Automatically commits after roughly 6 seconds of inactivity following a change
- Adds a **Workflow Git** tab to the ComfyUI sidebar
- Shows commit date/time, commit message, changed files, and commit hash
- Displays a unified Git diff for the selected commit
- Click a changed file to inspect its JSON at that exact commit
- Search by workflow filename or commit message
- Restore the **entire workflows folder** to a selected commit
- Automatically creates a safety snapshot immediately before restore
- Creates a new restore commit instead of truncating Git history
- No GitHub push or cloud sync is performed
- All history remains local inside `workflows/.git`

### Installation

Requirements:

- **Git for Windows**
- `git` must be available from your system PATH

Clone the repository into ComfyUI's `custom_nodes` directory:

```powershell
cd "D:\ComfyUI-Easy-Install\ComfyUI-Easy-Install\ComfyUI\custom_nodes"
git clone https://github.com/ssain3d-lgtm/Comfyui-Restore-Workflows.git
```

Or copy the repository folder manually to:

```text
ComfyUI/
└─ custom_nodes/
   └─ Comfyui-Restore-Workflows/
```

Restart ComfyUI after installation.

### Verify installation

You should see console messages similar to:

```text
[Restore Workflows] git init: ...\user\default\workflows
[Restore Workflows] initial snapshot created
[Restore Workflows] watching ...\user\default\workflows (auto commit after 6s idle)
```

A local Git repository will also be created at:

```text
ComfyUI\user\default\workflows\.git
```

### Usage

1. Open **Workflow Git** from the ComfyUI sidebar.
2. Browse commits by modification time.
3. Select a commit.
4. Review the workflows changed in that commit and inspect the diff.
5. Click a workflow file to view its exact JSON content at that point in history.
6. Click **Restore entire workflows to this point** when you find the desired snapshot.
7. Reopen the affected workflow in ComfyUI after restore.

### Restore safety model

Restore is intentionally non-destructive to Git history.

```text
Current workflows state
        ↓
Create Safety Snapshot if needed
        ↓
Restore selected historical tree
        ↓
Create a new Restore commit
```

For example, restoring state `C` from this history:

```text
A → B → C → D
```

results in something conceptually like:

```text
A → B → C → D → Restore-to-C
```

The later state `D` remains recoverable.

### Important notes

- This extension cannot recover workflow versions that were lost before the extension was installed and before Git history existed.
- Only files that have actually been saved to disk can be versioned. Unsaved canvas edits are not part of Git history.
- The default monitored path is `user/default/workflows`.
- Very large diffs/file previews may be truncated in the sidebar UI at around 1 MB for responsiveness. The underlying Git snapshots are not truncated.
- After a restore, already-open ComfyUI canvases are not forcibly replaced. Reopen the workflow to load the restored file from disk.

## License

MIT

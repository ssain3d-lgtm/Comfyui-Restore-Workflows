import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXT = "ssain3d.workflow_git_restore";
const SIDEBAR_ID = "workflow-git-restore";

let activeContainer = null;
let selectedHash = null;

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatTime(iso) {
    try {
        return new Intl.DateTimeFormat("ko-KR", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false,
        }).format(new Date(iso));
    } catch {
        return iso || "";
    }
}

function toast(severity, summary, detail) {
    const manager = app.extensionManager;
    if (manager?.toast?.add) {
        manager.toast.add({ severity, summary, detail, life: 5000 });
    } else {
        console.log(`[${summary}] ${detail}`);
    }
}

async function requestJson(route, options = {}) {
    const response = await api.fetchApi(route, options);
    const data = await response.json();
    if (!response.ok || !data.ok) {
        throw new Error(data.error || `${response.status} ${response.statusText}`);
    }
    return data;
}

async function confirmRestore(commit) {
    const text =
        `${formatTime(commit.timestamp)}\n${commit.short_hash} · ${commit.subject}\n\n` +
        "workflows 폴더 전체를 이 시점으로 복구합니다.\n" +
        "현재 디스크 상태는 복구 전에 안전 스냅샷으로 자동 저장됩니다.";

    if (app.extensionManager?.dialog?.confirm) {
        return await app.extensionManager.dialog.confirm({
            title: "Workflow 전체 복구",
            message: text,
        });
    }
    return window.confirm(text);
}

function injectStyles() {
    if (document.getElementById("workflow-git-restore-style")) return;
    const style = document.createElement("style");
    style.id = "workflow-git-restore-style";
    style.textContent = `
        .wgr-root { height:100%; display:flex; flex-direction:column; overflow:hidden; font-size:12px; color:var(--fg-color,#ddd); background:var(--comfy-menu-bg,transparent); }
        .wgr-header { padding:10px; border-bottom:1px solid var(--border-color,#444); display:flex; flex-direction:column; gap:8px; }
        .wgr-title-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .wgr-title { font-size:14px; font-weight:700; }
        .wgr-badge { border:1px solid #3d8a52; border-radius:999px; padding:2px 7px; font-size:10px; white-space:nowrap; }
        .wgr-path { opacity:.72; word-break:break-all; line-height:1.35; }
        .wgr-toolbar { display:flex; gap:6px; }
        .wgr-btn { border:1px solid var(--border-color,#555); background:var(--comfy-input-bg,#292929); color:inherit; border-radius:6px; padding:6px 8px; cursor:pointer; font-size:11px; }
        .wgr-btn:hover { filter:brightness(1.16); }
        .wgr-btn:disabled { opacity:.45; cursor:default; }
        .wgr-btn-primary { border-color:#4b78c2; font-weight:700; }
        .wgr-btn-danger { border-color:#b55050; font-weight:700; }
        .wgr-search { width:100%; box-sizing:border-box; padding:7px 8px; border:1px solid var(--border-color,#555); border-radius:6px; background:var(--comfy-input-bg,#222); color:inherit; outline:none; }
        .wgr-main { min-height:0; flex:1; overflow:auto; padding:8px; }
        .wgr-commit { border:1px solid var(--border-color,#444); border-radius:8px; margin-bottom:7px; overflow:hidden; background:color-mix(in srgb,var(--comfy-menu-bg,#222) 88%,white 3%); }
        .wgr-commit.selected { border-color:#4b78c2; }
        .wgr-commit-head { padding:8px; cursor:pointer; display:flex; flex-direction:column; gap:4px; }
        .wgr-commit-head:hover { background:rgba(255,255,255,.04); }
        .wgr-time { font-weight:700; font-size:11px; }
        .wgr-subject { opacity:.9; line-height:1.35; word-break:break-word; }
        .wgr-meta { display:flex; gap:7px; opacity:.62; font-size:10px; }
        .wgr-detail { border-top:1px solid var(--border-color,#444); padding:8px; display:flex; flex-direction:column; gap:8px; }
        .wgr-files { display:flex; flex-direction:column; gap:3px; }
        .wgr-file { display:flex; align-items:flex-start; gap:6px; padding:4px 5px; border-radius:4px; cursor:pointer; word-break:break-all; }
        .wgr-file:hover { background:rgba(255,255,255,.05); }
        .wgr-file-status { min-width:18px; font-weight:700; opacity:.75; }
        .wgr-section-title { font-weight:700; margin-top:2px; }
        .wgr-pre { margin:0; padding:8px; max-height:330px; overflow:auto; white-space:pre; tab-size:2; font:10px/1.45 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; border:1px solid var(--border-color,#444); border-radius:6px; background:rgba(0,0,0,.20); }
        .wgr-empty,.wgr-error { padding:14px 8px; line-height:1.55; opacity:.8; }
        .wgr-error { opacity:1; }
        .wgr-footer-note { opacity:.62; line-height:1.45; font-size:10px; }
        .wgr-loading { padding:8px 0; opacity:.65; }
    `;
    document.head.appendChild(style);
}

function baseMarkup() {
    return `
        <div class="wgr-root">
            <div class="wgr-header">
                <div class="wgr-title-row">
                    <div class="wgr-title">Workflow Git History</div>
                    <div class="wgr-badge" data-role="badge">확인 중</div>
                </div>
                <div class="wgr-path" data-role="path"></div>
                <div class="wgr-toolbar">
                    <button class="wgr-btn wgr-btn-primary" data-role="snapshot">지금 백업</button>
                    <button class="wgr-btn" data-role="refresh">새로고침</button>
                </div>
                <input class="wgr-search" data-role="search" placeholder="파일명 / 커밋 내용 검색" />
            </div>
            <div class="wgr-main" data-role="main"><div class="wgr-loading">Git 이력을 불러오는 중...</div></div>
        </div>`;
}

async function renderPanel(container) {
    activeContainer = container;
    injectStyles();
    container.innerHTML = baseMarkup();

    const refreshBtn = container.querySelector('[data-role="refresh"]');
    const snapshotBtn = container.querySelector('[data-role="snapshot"]');
    const search = container.querySelector('[data-role="search"]');

    refreshBtn.addEventListener("click", () => loadAll(container, search.value));
    snapshotBtn.addEventListener("click", async () => {
        snapshotBtn.disabled = true;
        try {
            const data = await requestJson("/workflow-git/snapshot", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
            });
            toast("success", "Workflow Git", data.created ? "현재 상태를 새 커밋으로 저장했습니다." : "변경된 파일이 없습니다.");
            await loadAll(container, search.value);
        } catch (error) {
            toast("error", "Workflow Git", error.message);
        } finally {
            snapshotBtn.disabled = false;
        }
    });

    let debounce;
    search.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => loadAll(container, search.value), 150);
    });

    await loadAll(container, "");
}

async function loadAll(container, query = "") {
    if (!container?.isConnected) return;
    const main = container.querySelector('[data-role="main"]');
    const badge = container.querySelector('[data-role="badge"]');
    const path = container.querySelector('[data-role="path"]');

    try {
        const [status, history] = await Promise.all([
            requestJson("/workflow-git/status"),
            requestJson("/workflow-git/commits?limit=200"),
        ]);

        if (!status.ready) throw new Error(status.error || "Workflow Git을 사용할 수 없습니다.");
        badge.textContent = status.dirty ? "자동백업 ON · 변경 대기" : "자동백업 ON";
        path.textContent = `${status.repo} · ${status.commit_count} commits`;

        const needle = query.trim().toLowerCase();
        const commits = history.commits.filter((commit) => {
            if (!needle) return true;
            const haystack = [commit.subject, commit.short_hash, ...commit.files.map((f) => `${f.path} ${f.old_path || ""}`)].join(" ").toLowerCase();
            return haystack.includes(needle);
        });

        if (!commits.length) {
            main.innerHTML = `<div class="wgr-empty">표시할 커밋이 없습니다.</div>`;
            return;
        }

        main.innerHTML = commits.map((commit) => {
            const selected = commit.hash === selectedHash ? " selected" : "";
            const fileNames = commit.files.slice(0, 3).map((f) => escapeHtml(f.path)).join(", ");
            const extra = commit.file_count > 3 ? ` 외 ${commit.file_count - 3}개` : "";
            return `
                <div class="wgr-commit${selected}" data-hash="${commit.hash}">
                    <div class="wgr-commit-head" data-action="select">
                        <div class="wgr-time">${escapeHtml(formatTime(commit.timestamp))}</div>
                        <div class="wgr-subject">${escapeHtml(commit.subject)}</div>
                        <div class="wgr-meta"><span>${escapeHtml(commit.short_hash)}</span><span>${commit.file_count} files</span></div>
                        ${fileNames ? `<div class="wgr-meta"><span>${fileNames}${extra}</span></div>` : ""}
                    </div>
                    <div data-role="detail"></div>
                </div>`;
        }).join("");

        for (const card of main.querySelectorAll(".wgr-commit")) {
            const hash = card.dataset.hash;
            card.querySelector('[data-action="select"]').addEventListener("click", async () => {
                selectedHash = selectedHash === hash ? null : hash;
                for (const el of main.querySelectorAll(".wgr-commit")) {
                    el.classList.toggle("selected", el.dataset.hash === selectedHash);
                    if (el.dataset.hash !== selectedHash) el.querySelector('[data-role="detail"]').innerHTML = "";
                }
                if (selectedHash) await loadDetail(card, commits.find((c) => c.hash === hash));
                else card.querySelector('[data-role="detail"]').innerHTML = "";
            });

            if (hash === selectedHash) await loadDetail(card, commits.find((c) => c.hash === hash));
        }
    } catch (error) {
        badge.textContent = "오류";
        main.innerHTML = `<div class="wgr-error"><b>Workflow Git을 불러오지 못했습니다.</b><br><br>${escapeHtml(error.message)}</div>`;
    }
}

async function loadDetail(card, commit) {
    const detailEl = card.querySelector('[data-role="detail"]');
    detailEl.innerHTML = `<div class="wgr-detail"><div class="wgr-loading">변경 내용을 읽는 중...</div></div>`;

    try {
        const data = await requestJson(`/workflow-git/commit/${commit.hash}`);
        const detail = data.commit;
        detailEl.innerHTML = `
            <div class="wgr-detail">
                <div class="wgr-section-title">이 커밋에서 변경된 Workflow</div>
                <div class="wgr-files">
                    ${detail.files.length ? detail.files.map((file) => `
                        <div class="wgr-file" data-file="${escapeHtml(file.path)}" title="클릭하면 이 커밋의 파일 내용을 표시합니다.">
                            <span class="wgr-file-status">${escapeHtml(file.status)}</span><span>${escapeHtml(file.path)}</span>
                        </div>`).join("") : `<div class="wgr-empty">변경 파일 정보 없음</div>`}
                </div>
                <div class="wgr-toolbar"><button class="wgr-btn wgr-btn-danger" data-action="restore">이 시점으로 전체 복구</button></div>
                <div class="wgr-footer-note">복구 직전 현재 디스크 상태를 Safety snapshot으로 먼저 저장합니다. 복구 후에는 열린 캔버스를 다시 열어야 디스크의 복구본이 표시됩니다.</div>
                <div class="wgr-section-title">변경 내용 (diff)</div>
                <pre class="wgr-pre" data-role="content">${escapeHtml(detail.diff || "(diff 없음)")}</pre>
            </div>`;

        const content = detailEl.querySelector('[data-role="content"]');
        for (const fileEl of detailEl.querySelectorAll(".wgr-file")) {
            fileEl.addEventListener("click", async () => {
                const filePath = fileEl.dataset.file;
                content.textContent = "파일 내용을 읽는 중...";
                try {
                    const fileData = await requestJson(`/workflow-git/file/${commit.hash}?path=${encodeURIComponent(filePath)}`);
                    const file = fileData.file;
                    let shown = file.exists ? file.content : "(이 커밋에는 파일이 없습니다.)";
                    if (file.exists && filePath.toLowerCase().endsWith(".json")) {
                        try { shown = JSON.stringify(JSON.parse(file.content), null, 2); } catch {}
                    }
                    content.textContent = shown;
                } catch (error) {
                    content.textContent = `오류: ${error.message}`;
                }
            });
        }

        const restoreBtn = detailEl.querySelector('[data-action="restore"]');
        restoreBtn.addEventListener("click", async (event) => {
            event.stopPropagation();
            if (!(await confirmRestore(commit))) return;
            restoreBtn.disabled = true;
            restoreBtn.textContent = "복구 중...";

            try {
                const result = await requestJson("/workflow-git/restore", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ commit: commit.hash }),
                });
                selectedHash = result.new_head?.hash || null;
                toast("success", "Workflow 복구 완료", `${commit.short_hash} 시점으로 복구했습니다. 열린 Workflow는 다시 열어주세요.`);
                await loadAll(activeContainer, activeContainer?.querySelector('[data-role="search"]')?.value || "");
            } catch (error) {
                toast("error", "Workflow 복구 실패", error.message);
                restoreBtn.disabled = false;
                restoreBtn.textContent = "이 시점으로 전체 복구";
            }
        });
    } catch (error) {
        detailEl.innerHTML = `<div class="wgr-detail wgr-error">${escapeHtml(error.message)}</div>`;
    }
}

app.registerExtension({
    name: EXT,
    async setup() {
        injectStyles();
        app.extensionManager.registerSidebarTab({
            id: SIDEBAR_ID,
            icon: "pi pi-history",
            title: "Workflow Git",
            tooltip: "Workflow Git History / Restore",
            type: "custom",
            render: (container) => renderPanel(container),
            destroy: () => { activeContainer = null; },
        });
    },
});

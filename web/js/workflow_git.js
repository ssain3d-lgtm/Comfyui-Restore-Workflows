import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXT = "ssain3d.workflow_git_restore";
const SIDEBAR_ID = "workflow-git-restore";

let activeContainer = null;
let selectedHash = null;
let cachedCommits = [];

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
        return new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
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
        `${formatTime(commit.timestamp)}\n` +
        `${commit.short_hash} · ${commit.subject}\n\n` +
        "Restore the entire workflows folder to this point.\n" +
        "The current on-disk state will be saved automatically as a safety snapshot before restore.";

    if (app.extensionManager?.dialog?.confirm) {
        return await app.extensionManager.dialog.confirm({
            title: "Restore Entire Workflows Folder",
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
        .wgr-root {
            height: 100%;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-size: 12px;
            color: var(--fg-color, #ddd);
            background: var(--comfy-menu-bg, transparent);
        }
        .wgr-header {
            padding: 10px;
            border-bottom: 1px solid var(--border-color, #444);
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .wgr-title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .wgr-title {
            font-size: 14px;
            font-weight: 700;
        }
        .wgr-badge {
            border: 1px solid #3d8a52;
            border-radius: 999px;
            padding: 2px 7px;
            font-size: 10px;
            white-space: nowrap;
        }
        .wgr-path {
            opacity: .72;
            word-break: break-all;
            line-height: 1.35;
        }
        .wgr-toolbar {
            display: flex;
            gap: 6px;
        }
        .wgr-btn {
            border: 1px solid var(--border-color, #555);
            background: var(--comfy-input-bg, #292929);
            color: inherit;
            border-radius: 6px;
            padding: 6px 8px;
            cursor: pointer;
            font-size: 11px;
        }
        .wgr-btn:hover { filter: brightness(1.16); }
        .wgr-btn:disabled { opacity: .45; cursor: default; }
        .wgr-btn-primary {
            border-color: #4b78c2;
            font-weight: 700;
        }
        .wgr-btn-danger {
            border-color: #b55050;
            font-weight: 700;
        }
        .wgr-search {
            width: 100%;
            box-sizing: border-box;
            padding: 7px 8px;
            border: 1px solid var(--border-color, #555);
            border-radius: 6px;
            background: var(--comfy-input-bg, #222);
            color: inherit;
            outline: none;
        }
        .wgr-main {
            min-height: 0;
            flex: 1;
            overflow: auto;
            padding: 8px;
        }
        .wgr-commit {
            border: 1px solid var(--border-color, #444);
            border-radius: 8px;
            margin-bottom: 7px;
            overflow: hidden;
            background: color-mix(in srgb, var(--comfy-menu-bg, #222) 88%, white 3%);
        }
        .wgr-commit.selected {
            border-color: #4b78c2;
        }
        .wgr-commit-head {
            padding: 8px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .wgr-commit-head:hover {
            background: rgba(255,255,255,.04);
        }
        .wgr-time {
            font-weight: 700;
            font-size: 11px;
        }
        .wgr-subject {
            opacity: .9;
            line-height: 1.35;
            word-break: break-word;
        }
        .wgr-meta {
            display: flex;
            gap: 7px;
            opacity: .62;
            font-size: 10px;
        }
        .wgr-detail {
            border-top: 1px solid var(--border-color, #444);
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .wgr-files {
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .wgr-file {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            padding: 4px 5px;
            border-radius: 4px;
            cursor: pointer;
            word-break: break-all;
        }
        .wgr-file:hover { background: rgba(255,255,255,.05); }
        .wgr-file-status {
            min-width: 18px;
            font-weight: 700;
            opacity: .75;
        }
        .wgr-section-title {
            font-weight: 700;
            margin-top: 2px;
        }
        .wgr-pre {
            margin: 0;
            padding: 8px;
            max-height: 330px;
            overflow: auto;
            white-space: pre;
            tab-size: 2;
            font: 10px/1.45 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
            border: 1px solid var(--border-color, #444);
            border-radius: 6px;
            background: rgba(0,0,0,.20);
        }
        .wgr-empty, .wgr-error {
            padding: 14px 8px;
            line-height: 1.55;
            opacity: .8;
        }
        .wgr-error { opacity: 1; }
        .wgr-footer-note {
            opacity: .62;
            line-height: 1.45;
            font-size: 10px;
        }
        .wgr-loading {
            padding: 8px 0;
            opacity: .65;
        }
    `;
    document.head.appendChild(style);
}

function baseMarkup() {
    return `
        <div class="wgr-root">
            <div class="wgr-header">
                <div class="wgr-title-row">
                    <div class="wgr-title">Workflow Git History</div>
                    <div class="wgr-badge" data-role="badge">Checking…</div>
                </div>
                <div class="wgr-path" data-role="path"></div>
                <div class="wgr-toolbar">
                    <button class="wgr-btn wgr-btn-primary" data-role="snapshot">Create Snapshot</button>
                    <button class="wgr-btn" data-role="refresh">Refresh</button>
                </div>
                <input class="wgr-search" data-role="search"
                    placeholder="Search filename / commit message" />
            </div>
            <div class="wgr-main" data-role="main">
                <div class="wgr-loading">Loading Git history…</div>
            </div>
        </div>
    `;
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
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            toast(
                "success",
                "Workflow Git",
                data.created ? "Current state saved as a new commit." : "No changed files to commit."
            );
            await loadAll(container, search.value);
        } catch (error) {
            toast("error", "Workflow Git", error.message);
        } finally {
            snapshotBtn.disabled = false;
        }
    });

    search.addEventListener("input", () => {
        renderCommits(container, search.value);
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

        if (!status.ready) {
            throw new Error(status.error || "Workflow Git is not available.");
        }

        badge.textContent = status.dirty ? "Auto Backup ON \u00b7 Pending changes" : "Auto Backup ON";
        path.textContent = `${status.repo} \u00b7 ${status.commit_count} commits`;

        cachedCommits = history.commits;
        renderCommits(container, query);
    } catch (error) {
        badge.textContent = "Error";
        main.innerHTML = `
            <div class="wgr-error">
                <b>Failed to load Workflow Git.</b><br><br>
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}

// Filters the already-fetched history. Searching is a pure client-side pass
// over cachedCommits and never hits the server.
function renderCommits(container, query = "") {
    if (!container?.isConnected) return;

    const main = container.querySelector('[data-role="main"]');
    const needle = query.trim().toLowerCase();

    const commits = cachedCommits.filter((commit) => {
        if (!needle) return true;
        const haystack = [
            commit.subject,
            commit.short_hash,
            ...commit.files.map((f) => `${f.path} ${f.old_path || ""}`),
        ].join(" ").toLowerCase();
        return haystack.includes(needle);
    });

    if (!commits.length) {
        main.innerHTML = `<div class="wgr-empty">No commits to display.</div>`;
        return;
    }

    main.innerHTML = commits.map((commit) => {
        const selected = commit.hash === selectedHash ? " selected" : "";
        const fileNames = commit.files
            .slice(0, 3)
            .map((f) => escapeHtml(f.path))
            .join(", ");
        const extra = commit.file_count > 3 ? ` +${commit.file_count - 3} more` : "";

        return `
            <div class="wgr-commit${selected}" data-hash="${commit.hash}">
                <div class="wgr-commit-head" data-action="select">
                    <div class="wgr-time">${escapeHtml(formatTime(commit.timestamp))}</div>
                    <div class="wgr-subject">${escapeHtml(commit.subject)}</div>
                    <div class="wgr-meta">
                        <span>${escapeHtml(commit.short_hash)}</span>
                        <span>${commit.file_count} files</span>
                    </div>
                    ${fileNames ? `<div class="wgr-meta"><span>${fileNames}${extra}</span></div>` : ""}
                </div>
                <div data-role="detail"></div>
            </div>
        `;
    }).join("");

    for (const card of main.querySelectorAll(".wgr-commit")) {
        const hash = card.dataset.hash;
        const header = card.querySelector('[data-action="select"]');
        header.addEventListener("click", async () => {
            selectedHash = selectedHash === hash ? null : hash;
            for (const el of main.querySelectorAll(".wgr-commit")) {
                el.classList.toggle("selected", el.dataset.hash === selectedHash);
                if (el.dataset.hash !== selectedHash) {
                    el.querySelector('[data-role="detail"]').innerHTML = "";
                }
            }
            if (selectedHash) {
                await loadDetail(card, commits.find((c) => c.hash === hash));
            } else {
                card.querySelector('[data-role="detail"]').innerHTML = "";
            }
        });

        if (hash === selectedHash) {
            await loadDetail(card, commits.find((c) => c.hash === hash));
        }
    }
}

async function loadDetail(card, commit) {
    const detailEl = card.querySelector('[data-role="detail"]');
    detailEl.innerHTML = `<div class="wgr-detail"><div class="wgr-loading">Loading changes…</div></div>`;

    try {
        const data = await requestJson(`/workflow-git/commit/${commit.hash}`);
        const detail = data.commit;

        detailEl.innerHTML = `
            <div class="wgr-detail">
                <div class="wgr-section-title">Workflows changed in this commit</div>
                <div class="wgr-files">
                    ${detail.files.length ? detail.files.map((file) => `
                        <div class="wgr-file"
                            data-file="${escapeHtml(file.path)}"
                            title="Click to view this file as stored in this commit.">
                            <span class="wgr-file-status">${escapeHtml(file.status)}</span>
                            <span>${escapeHtml(file.path)}</span>
                        </div>
                    `).join("") : `<div class="wgr-empty">No changed-file information</div>`}
                </div>

                <div class="wgr-toolbar">
                    <button class="wgr-btn wgr-btn-danger" data-action="restore">
                        Restore entire folder to this point
                    </button>
                </div>

                <div class="wgr-footer-note">
                    The current on-disk state is saved as a Safety Snapshot before restore.
                    After restore, reopen any already-open workflow to load the restored file from disk.
                </div>

                <div class="wgr-section-title">Changes (diff)</div>
                <pre class="wgr-pre" data-role="content">${escapeHtml(detail.diff || "(no diff)")}</pre>
            </div>
        `;

        const content = detailEl.querySelector('[data-role="content"]');

        for (const fileEl of detailEl.querySelectorAll(".wgr-file")) {
            fileEl.addEventListener("click", async () => {
                const path = fileEl.dataset.file;
                content.textContent = "Loading file contents…";
                try {
                    const fileData = await requestJson(
                        `/workflow-git/file/${commit.hash}?path=${encodeURIComponent(path)}`
                    );
                    const file = fileData.file;
                    let shown = file.exists ? file.content : "(This file does not exist in this commit.)";

                    if (file.exists && path.toLowerCase().endsWith(".json")) {
                        try {
                            shown = JSON.stringify(JSON.parse(file.content), null, 2);
                        } catch {
                            // Keep raw content if JSON parsing fails/truncated.
                        }
                    }
                    content.textContent = shown;
                } catch (error) {
                    content.textContent = `Error: ${error.message}`;
                }
            });
        }

        const restoreBtn = detailEl.querySelector('[data-action="restore"]');
        restoreBtn.addEventListener("click", async (event) => {
            event.stopPropagation();
            const confirmed = await confirmRestore(commit);
            if (!confirmed) return;

            restoreBtn.disabled = true;
            restoreBtn.textContent = "Restoring…";

            try {
                const result = await requestJson("/workflow-git/restore", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ commit: commit.hash }),
                });

                selectedHash = result.new_head?.hash || null;
                toast(
                    "success",
                    "Workflow Restore Complete",
                    `Restored to ${commit.short_hash}. Reopen any already-open workflow to load the restored file.`
                );
                await loadAll(activeContainer, activeContainer?.querySelector('[data-role="search"]')?.value || "");
            } catch (error) {
                toast("error", "Workflow Restore Failed", error.message);
                restoreBtn.disabled = false;
                restoreBtn.textContent = "Restore entire folder to this point";
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
            render: (container) => {
                renderPanel(container);
            },
            destroy: () => {
                activeContainer = null;
                cachedCommits = [];
            },
        });
    },
});

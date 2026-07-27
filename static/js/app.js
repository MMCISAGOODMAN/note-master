/**
 * Ops Notepad — Frontend
 */
(() => {
  "use strict";

  const API = "";
  const AUTOSAVE_MS = 30000;
  const SEARCH_DEBOUNCE = 300;

  const state = {
    notes: [],
    currentId: null,
    current: null,
    categories: [],
    servers: [],
    tags: [],
    phrases: [],
    filters: {
      q: "",
      category: "",
      tag: "",
      server_ip: "",
      archived: false,
      deleted: false,
      pinned: false,
      knowledge: false,
      date_from: "",
      date_to: "",
    },
    view: "notes",
    dirty: false,
    saving: false,
    previewMode: 0, // 0 edit, 1 split, 2 preview
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth() + 1,
    calSelected: null,
    cmdCategory: "",
    searchTimer: null,
    autosaveTimer: null,
    ctxNoteId: null,
    dragId: null,
  };

  // ---------- DOM ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const els = {
    noteList: $("#noteList"),
    emptyState: $("#emptyState"),
    editorPane: $("#editorPane"),
    noteTitle: $("#noteTitle"),
    noteContent: $("#noteContent"),
    noteCategory: $("#noteCategory"),
    noteServer: $("#noteServer"),
    noteEnv: $("#noteEnv"),
    noteKnowledge: $("#noteKnowledge"),
    tagsDisplay: $("#tagsDisplay"),
    tagInput: $("#tagInput"),
    tagAc: $("#tagAc"),
    saveState: $("#saveState"),
    noteUpdated: $("#noteUpdated"),
    wordCount: $("#wordCount"),
    searchInput: $("#searchInput"),
    searchWrap: $("#searchWrap"),
    searchClear: $("#searchClear"),
    searchHistory: $("#searchHistory"),
    categoryFilters: $("#categoryFilters"),
    similarBox: $("#similarBox"),
    similarList: $("#similarList"),
    editorBody: $("#editorBody"),
    previewArea: $("#previewArea"),
    btnLike: $("#btnLike"),
    btnCopySolution: $("#btnCopySolution"),
    ctxMenu: $("#ctxMenu"),
    phrasesMenu: $("#phrasesMenu"),
    modalOverlay: $("#modalOverlay"),
    modal: $("#modal"),
  };

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      let err = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        err = j.error || err;
      } catch (_) {}
      throw new Error(err);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res;
  }

  function toast(msg, type = "ok") {
    const wrap = $("#toasts");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  // ---------- Markdown (lightweight) ----------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMarkdown(src) {
    let text = String(src || "");
    const blocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const i = blocks.length;
      blocks.push(`<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
      return `\n%%BLOCK${i}%%\n`;
    });
    let html = escapeHtml(text);
    html = html.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
    html = html.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
    html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/^---$/gm, "<hr>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // lists
    html = html.replace(/((?:^[\-\*] .+(?:\n|$))+)/gm, (m) => {
      const items = m.trim().split(/\n/).map((l) => `<li>${l.replace(/^[\-\*] /, "")}</li>`).join("");
      return `<ul>${items}</ul>`;
    });
    html = html.replace(/((?:^\d+\. .+(?:\n|$))+)/gm, (m) => {
      const items = m.trim().split(/\n/).map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("");
      return `<ol>${items}</ol>`;
    });
    html = html.replace(/\n{2,}/g, "</p><p>");
    html = html.replace(/\n/g, "<br>");
    html = `<p>${html}</p>`;
    html = html.replace(/%%BLOCK(\d+)%%/g, (_, i) => blocks[+i] || "");
    html = html.replace(/<p>\s*(<(?:h[1-6]|ul|ol|pre|blockquote|hr))/g, "$1");
    html = html.replace(/(<\/(?:h[1-6]|ul|ol|pre|blockquote)>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*<\/p>/g, "");
    return html;
  }

  function highlight(text, q) {
    if (!q) return escapeHtml(text);
    const esc = escapeHtml(text);
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return esc.replace(re, '<span class="highlight">$1</span>');
  }

  // ---------- Loaders ----------
  async function loadMeta() {
    const [cats, servers, tags, phrases] = await Promise.all([
      api("/api/categories"),
      api("/api/servers"),
      api("/api/tags"),
      api("/api/phrases"),
    ]);
    state.categories = cats.data || [];
    state.servers = servers.data || [];
    state.tags = tags.data || [];
    state.phrases = phrases.data || [];
    renderCategorySelect();
    renderServerSelect();
    renderCategoryFilters();
  }

  function buildQuery() {
    const f = state.filters;
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.category) p.set("category", f.category);
    if (f.tag) p.set("tag", f.tag);
    if (f.server_ip) p.set("server_ip", f.server_ip);
    if (f.archived) p.set("archived", "1");
    if (f.deleted) p.set("deleted", "1");
    if (f.pinned) p.set("pinned", "1");
    if (f.knowledge || state.view === "knowledge") p.set("knowledge", "1");
    if (f.date_from) p.set("date_from", f.date_from);
    if (f.date_to) p.set("date_to", f.date_to);
    return p.toString();
  }

  async function loadNotes() {
    const qs = buildQuery();
    const res = await api(`/api/notes?${qs}`);
    state.notes = res.data || [];
    renderNoteList();
    if (state.view === "knowledge") renderKnowledge();
  }

  // ---------- Render list ----------
  function renderCategoryFilters() {
    const wrap = els.categoryFilters;
    wrap.innerHTML = `<button class="chip ${!state.filters.category ? "active" : ""}" data-cat="">全部</button>`;
    state.categories.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = `chip ${state.filters.category === c.name ? "active" : ""}`;
      btn.dataset.cat = c.name;
      btn.textContent = c.name;
      wrap.appendChild(btn);
    });
  }

  function renderCategorySelect() {
    els.noteCategory.innerHTML = state.categories
      .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
      .join("");
  }

  function renderServerSelect() {
    const cur = els.noteServer.value;
    els.noteServer.innerHTML =
      `<option value="">未关联服务器</option>` +
      state.servers
        .map(
          (s) =>
            `<option value="${escapeHtml(s.ip)}" data-env="${escapeHtml(s.env)}">${escapeHtml(s.name)} (${escapeHtml(s.ip)})</option>`
        )
        .join("");
    if (cur) els.noteServer.value = cur;
  }

  function renderNoteList() {
    const list = els.noteList;
    if (!state.notes.length) {
      list.innerHTML = `<div class="empty-list">${state.filters.q ? "无搜索结果" : "暂无笔记，点击「新建笔记」开始"}</div>`;
      return;
    }
    const q = state.filters.q;
    list.innerHTML = state.notes
      .map((n) => {
        const tags = (n.tags || [])
          .slice(0, 3)
          .map((t) => `<span class="tag-pill" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`)
          .join("");
        return `
        <div class="note-item ${n.id === state.currentId ? "active" : ""}"
             data-id="${n.id}" draggable="true">
          <div class="note-item-title">${n.is_pinned ? '<span class="pin">📌</span>' : ""}${highlight(n.title || "无标题", q)}</div>
          <div class="note-item-meta">
            <span class="cat-badge ${escapeHtml(n.category || "")}">${escapeHtml(n.category || "")}</span>
            ${n.server_ip ? `<span>${escapeHtml(n.server_ip)}</span>` : ""}
            <span>${(n.updated_at || "").slice(0, 16)}</span>
            ${tags}
          </div>
        </div>`;
      })
      .join("");
  }

  // ---------- Editor ----------
  function showEditor(show) {
    els.emptyState.style.display = show ? "none" : "flex";
    els.editorPane.classList.toggle("visible", show);
    $$(".panel-view").forEach((p) => p.classList.remove("active"));
  }

  function openNote(note) {
    state.currentId = note.id;
    state.current = note;
    state.dirty = false;
    showEditor(true);
    els.noteTitle.value = note.title || "";
    els.noteContent.value = note.content || "";
    els.noteCategory.value = note.category || "日常";
    els.noteServer.value = note.server_ip || "";
    els.noteEnv.value = note.server_env || "";
    els.noteKnowledge.checked = !!note.is_knowledge;
    renderTags(note.tags || []);
    updateStatus();
    updatePreview();
    renderNoteList();
    els.btnLike.style.display = note.is_knowledge ? "" : "none";
    els.btnCopySolution.style.display = note.is_knowledge && note.solution ? "" : "none";
    $("#btnPin").textContent = note.is_pinned ? "📌 已置顶" : "📌 置顶";
    $("#btnArchive").textContent = note.is_archived ? "取消归档" : "归档";
    if (note.is_knowledge) maybeLoadSimilar(note.title || note.problem_title || "");
    else els.similarBox.classList.remove("open");
    // Focus content for new notes
    if (!(note.content || "").trim()) els.noteContent.focus();
  }

  function renderTags(tags) {
    els.tagsDisplay.innerHTML = tags
      .map(
        (t) =>
          `<span class="tag-pill" data-tag="${escapeHtml(t)}">#${escapeHtml(t)} <span data-remove="${escapeHtml(t)}" style="cursor:pointer;opacity:.7">×</span></span>`
      )
      .join("");
  }

  function getEditorTags() {
    return [...els.tagsDisplay.querySelectorAll(".tag-pill")]
      .map((el) => el.dataset.tag)
      .filter(Boolean);
  }

  function collectPayload(extra = {}) {
    return {
      title: els.noteTitle.value,
      content: els.noteContent.value,
      category: els.noteCategory.value,
      tags: getEditorTags(),
      server_ip: els.noteServer.value,
      server_env: els.noteEnv.value,
      is_knowledge: els.noteKnowledge.checked,
      problem_title: els.noteKnowledge.checked ? els.noteTitle.value : "",
      solution: extractSolution(els.noteContent.value),
      ...extra,
    };
  }

  function extractSolution(content) {
    const m = content.match(/【解决方案】\s*([\s\S]*?)(?=【|$)/);
    return m ? m[1].trim() : "";
  }

  function markDirty() {
    state.dirty = true;
    els.saveState.textContent = "未保存";
    els.saveState.className = "save-state dirty";
    updateWordCount();
    updatePreview();
  }

  function updateStatus() {
    const n = state.current;
    els.saveState.textContent = state.dirty ? "未保存" : "已保存";
    els.saveState.className = `save-state ${state.dirty ? "dirty" : "saved"}`;
    els.noteUpdated.textContent = n ? `更新于 ${n.updated_at || ""}` : "";
    updateWordCount();
  }

  function updateWordCount() {
    const t = els.noteContent.value || "";
    els.wordCount.textContent = `${t.length} 字`;
  }

  function updatePreview() {
    if (state.previewMode > 0) {
      els.previewArea.innerHTML = renderMarkdown(els.noteContent.value);
    }
  }

  async function saveNote(opts = {}) {
    if (!state.currentId) return;
    if (state.saving) return;
    state.saving = true;
    els.saveState.textContent = "保存中…";
    els.saveState.className = "save-state saving";
    try {
      const payload = collectPayload({
        auto_save: !!opts.auto,
        manual_save: !!opts.manual,
        force_version: !!opts.manual,
        ...opts,
      });
      const res = await api(`/api/notes/${state.currentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      state.current = res.data;
      state.dirty = false;
      // refresh list item
      const idx = state.notes.findIndex((n) => n.id === state.currentId);
      if (idx >= 0) state.notes[idx] = res.data;
      else state.notes.unshift(res.data);
      renderNoteList();
      updateStatus();
      if (opts.manual) toast("已保存");
    } catch (e) {
      toast(e.message || "保存失败", "err");
      els.saveState.textContent = "保存失败";
      els.saveState.className = "save-state dirty";
    } finally {
      state.saving = false;
    }
  }

  async function createNote(preset = {}) {
    if (state.dirty && state.currentId) await saveNote({ auto: true });
    const today = new Date().toISOString().slice(0, 10);
    const res = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        title: preset.title || `无标题笔记 - ${today}`,
        content: preset.content || "",
        category: preset.category || "日常",
        tags: preset.tags || [],
        server_ip: preset.server_ip || "",
        server_env: preset.server_env || "",
        is_knowledge: !!preset.is_knowledge,
      }),
    });
    state.filters.archived = false;
    state.filters.deleted = false;
    switchView("notes");
    await loadNotes();
    openNote(res.data);
    els.noteContent.focus();
    toast("笔记已创建");
  }

  // ---------- Insert helpers ----------
  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + text + after;
    const pos = start + text.length;
    textarea.selectionStart = textarea.selectionEnd = pos;
    textarea.focus();
    markDirty();
  }

  function insertCodeBlock(lang = "bash") {
    insertAtCursor(els.noteContent, `\n\`\`\`${lang}\n\n\`\`\`\n`);
    const pos = els.noteContent.selectionStart - 5;
    els.noteContent.selectionStart = els.noteContent.selectionEnd = pos - lang.length - 4 + lang.length + 1;
  }

  function insertTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    insertAtCursor(els.noteContent, ts);
  }

  function insertServerInfo() {
    const ip = els.noteServer.value;
    const env = els.noteEnv.value;
    const srv = state.servers.find((s) => s.ip === ip);
    const name = srv ? srv.name : "";
    const block = `\n> 服务器: ${name || "-"} | IP: ${ip || "-"} | 环境: ${env || "-"}\n\n`;
    insertAtCursor(els.noteContent, block);
  }

  // ---------- Similar ----------
  let similarTimer = null;
  function maybeLoadSimilar(title) {
    clearTimeout(similarTimer);
    if (!els.noteKnowledge.checked || !title || title.length < 2) {
      els.similarBox.classList.remove("open");
      return;
    }
    similarTimer = setTimeout(async () => {
      try {
        const res = await api(`/api/knowledge/similar?title=${encodeURIComponent(title)}`);
        const items = (res.data || []).filter((n) => n.id !== state.currentId);
        if (!items.length) {
          els.similarBox.classList.remove("open");
          return;
        }
        els.similarList.innerHTML = items
          .map(
            (n) => `
          <div class="similar-item">
            <span class="title" data-open="${n.id}">${escapeHtml(n.title)}</span>
            <span class="likes">👍 ${n.likes || 0}</span>
            <button class="btn btn-ghost btn-sm" data-reuse="${n.id}">复用方案</button>
          </div>`
          )
          .join("");
        els.similarBox.classList.add("open");
      } catch (_) {}
    }, 400);
  }

  // ---------- Views ----------
  function switchView(view) {
    state.view = view;
    $$(".nav-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
    if (view === "notes" || view === "knowledge") {
      $$(".panel-view").forEach((p) => p.classList.remove("active"));
      if (state.currentId && view === "notes") showEditor(true);
      else if (view === "knowledge") {
        showEditor(false);
        els.emptyState.style.display = "none";
        $("#panel-knowledge").classList.add("active");
        state.filters.knowledge = true;
        loadNotes().then(renderKnowledge);
      } else {
        showEditor(!!state.currentId);
        if (!state.currentId) els.emptyState.style.display = "flex";
      }
      if (view === "notes") {
        state.filters.knowledge = false;
        loadNotes();
      }
    } else {
      showEditor(false);
      els.emptyState.style.display = "none";
      $$(".panel-view").forEach((p) => p.classList.toggle("active", p.id === `panel-${view}`));
      if (view === "commands") loadCommands();
      if (view === "calendar") loadCalendar();
      if (view === "stats") loadStats();
      if (view === "servers") renderServers();
    }
  }

  async function renderKnowledge() {
    const grid = $("#knowledgeGrid");
    const notes = state.notes.filter((n) => n.is_knowledge);
    if (!notes.length) {
      grid.innerHTML = `<div class="empty-list">暂无知识库条目。编辑笔记时勾选「知识库」即可。</div>`;
      return;
    }
    notes.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    grid.innerHTML = notes
      .map(
        (n) => `
      <div class="cmd-card" data-open-note="${n.id}">
        <div class="cmd-head">
          <span class="cmd-title">${escapeHtml(n.title)}</span>
          <span class="likes" style="color:var(--warn);font-family:var(--mono)">👍 ${n.likes || 0}</span>
        </div>
        <div class="scenario">${escapeHtml((n.solution || n.content || "").slice(0, 160))}…</div>
        <div style="margin-top:8px;display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" data-open-note="${n.id}">打开</button>
          <button class="btn btn-ghost btn-sm" data-like="${n.id}">点赞</button>
          <button class="btn btn-ghost btn-sm" data-copy-sol="${n.id}">复制方案</button>
        </div>
      </div>`
      )
      .join("");
  }

  // ---------- Commands ----------
  async function loadCommands() {
    const qs = state.cmdCategory ? `?category=${encodeURIComponent(state.cmdCategory)}` : "";
    const res = await api(`/api/commands${qs}`);
    const cats = ["全部", "网络", "数据库", "容器", "系统"];
    $("#cmdFilters").innerHTML = cats
      .map((c) => {
        const val = c === "全部" ? "" : c;
        return `<button class="chip ${state.cmdCategory === val ? "active" : ""}" data-cmd-cat="${val}">${c}</button>`;
      })
      .join("");
    const grid = $("#cmdGrid");
    const list = res.data || [];
    if (!list.length) {
      grid.innerHTML = `<div class="empty-list">暂无命令</div>`;
      return;
    }
    grid.innerHTML = list
      .map(
        (c) => `
      <div class="cmd-card">
        <div class="cmd-head">
          <span class="cmd-title">${escapeHtml(c.title)}</span>
          <span class="cat-badge">${escapeHtml(c.category)}</span>
          <button class="btn btn-ghost btn-sm" data-copy-cmd="${escapeHtml(c.command)}">复制</button>
          <button class="btn btn-ghost btn-sm" data-edit-cmd="${c.id}">编辑</button>
          <button class="btn btn-danger btn-sm" data-del-cmd="${c.id}">删</button>
        </div>
        <pre>${escapeHtml(c.command)}</pre>
        <div class="scenario">${escapeHtml(c.scenario || "")}</div>
      </div>`
      )
      .join("");
  }

  // ---------- Calendar ----------
  async function loadCalendar() {
    const { calYear: y, calMonth: m } = state;
    $("#calTitle").textContent = `${y}-${String(m).padStart(2, "0")}`;
    const res = await api(`/api/calendar?year=${y}&month=${m}`);
    const counts = res.data || {};
    const first = new Date(y, m - 1, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const dows = ["日", "一", "二", "三", "四", "五", "六"];
    let html = dows.map((d) => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < startDow; i++) html += `<div class="cal-day empty"></div>`;
    const today = new Date().toISOString().slice(0, 10);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const cnt = counts[date] || 0;
      const cls = [
        "cal-day",
        date === today ? "today" : "",
        date === state.calSelected ? "selected" : "",
      ].join(" ");
      html += `<button class="${cls}" data-date="${date}">${d}${cnt ? '<span class="dot"></span>' : ""}</button>`;
    }
    $("#calGrid").innerHTML = html;
    if (state.calSelected) loadCalDay(state.calSelected);
  }

  async function loadCalDay(date) {
    state.calSelected = date;
    const res = await api(`/api/calendar/day?date=${date}`);
    const notes = res.data || [];
    $("#calDayList").innerHTML =
      `<h3 style="font-size:14px;margin-bottom:8px">${date} · ${notes.length} 条笔记</h3>` +
      (notes.length
        ? notes
            .map(
              (n) =>
                `<div class="note-item" data-id="${n.id}" style="background:var(--bg-panel);margin-bottom:4px">
                  <div class="note-item-title">${escapeHtml(n.title)}</div>
                  <div class="note-item-meta"><span class="cat-badge">${escapeHtml(n.category)}</span></div>
                </div>`
            )
            .join("")
        : `<div class="empty-list">当天无笔记</div>`);
    loadCalendar();
  }

  // ---------- Stats ----------
  async function loadStats() {
    const res = await api("/api/stats");
    const d = res.data || {};
    $("#statsGrid").innerHTML = [
      ["本月笔记", d.month_created],
      ["笔记总数", d.total_notes],
      ["知识库", d.knowledge_count],
      ["命令收藏", d.commands_count],
      ["连续记录", `${d.streak_days} 天`],
    ]
      .map(
        ([label, value]) =>
          `<div class="stat-card"><div class="label">${label}</div><div class="value">${value ?? 0}</div></div>`
      )
      .join("");

    const maxTag = Math.max(1, ...(d.top_tags || []).map((t) => t.count));
    $("#tagBars").innerHTML = (d.top_tags || [])
      .map(
        (t) => `
      <div class="bar-row">
        <span class="name">#${escapeHtml(t.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(t.count / maxTag) * 100}%"></div></div>
        <span class="cnt">${t.count}</span>
      </div>`
      )
      .join("") || `<div class="empty-list">暂无标签</div>`;

    const maxCat = Math.max(1, ...(d.top_categories || []).map((c) => c.count));
    $("#catBars").innerHTML = (d.top_categories || [])
      .map(
        (c) => `
      <div class="bar-row">
        <span class="name">${escapeHtml(c.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(c.count / maxCat) * 100}%"></div></div>
        <span class="cnt">${c.count}</span>
      </div>`
      )
      .join("");
  }

  // ---------- Servers ----------
  function renderServers() {
    const list = $("#serverList");
    if (!state.servers.length) {
      list.innerHTML = `<div class="empty-list">暂无服务器</div>`;
      return;
    }
    list.innerHTML = state.servers
      .map(
        (s) => `
      <div class="server-card">
        <div>
          <div style="font-weight:600;margin-bottom:4px">${escapeHtml(s.name)}
            <span class="env-badge ${escapeHtml(s.env)}">${escapeHtml(s.env)}</span>
          </div>
          <div class="ip">${escapeHtml(s.ip)}</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:4px">${escapeHtml(s.description || "")}</div>
        </div>
        <div style="display:flex;gap:4px;flex-direction:column">
          <button class="btn btn-ghost btn-sm" data-filter-server="${escapeHtml(s.ip)}">筛选笔记</button>
          <button class="btn btn-ghost btn-sm" data-edit-server="${s.id}">编辑</button>
          <button class="btn btn-danger btn-sm" data-del-server="${s.id}">删除</button>
        </div>
      </div>`
      )
      .join("");
  }

  // ---------- Modal helpers ----------
  function openModal(html) {
    els.modal.innerHTML = html;
    els.modalOverlay.classList.add("open");
  }
  function closeModal() {
    els.modalOverlay.classList.remove("open");
  }

  // ---------- Events ----------
  function bindEvents() {
    $("#btnNew").addEventListener("click", () => createNote());
    $("#btnNewEmpty").addEventListener("click", () => createNote());

    $("#btnIncident").addEventListener("click", async () => {
      const res = await api("/api/templates/incident");
      await createNote({
        title: res.data.title,
        content: res.data.content,
        category: res.data.category,
        tags: ["故障"],
        is_knowledge: true,
      });
    });

    $("#btnDaily").addEventListener("click", async () => {
      const res = await api("/api/daily");
      openModal(`
        <h3>今日工作日报</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
          新建 ${res.data.count_created} · 更新 ${res.data.count_updated}
        </p>
        <textarea id="dailyMd" style="min-height:260px;font-family:var(--mono)">${escapeHtml(res.data.report_md)}</textarea>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="modalCancel">关闭</button>
          <button class="btn btn-ghost" id="dailyCopy">复制</button>
          <button class="btn btn-primary" id="dailySave">保存为笔记</button>
          <button class="btn btn-ghost" id="dailyExport">导出 .md</button>
        </div>
      `);
      const mdEl = $("#dailyMd");
      $("#modalCancel").onclick = closeModal;
      $("#dailyCopy").onclick = () => {
        navigator.clipboard.writeText(mdEl.value);
        toast("已复制");
      };
      $("#dailySave").onclick = async () => {
        const md = mdEl.value;
        closeModal();
        await createNote({
          title: `${res.data.date} 工作日报`,
          content: md,
          category: "日报",
          tags: ["日报", res.data.date.slice(0, 7)],
        });
      };
      $("#dailyExport").onclick = () => {
        const blob = new Blob([mdEl.value], { type: "text/markdown" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `日报-${res.data.date}.md`;
        a.click();
      };
    });

    $("#btnExport").addEventListener("click", () => {
      openModal(`
        <h3>导出备份</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">所有数据仅存储在本地，导出后可备份到网盘。</p>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-ghost" data-fmt="json">JSON（完整备份，含元数据）</button>
          <button class="btn btn-ghost" data-fmt="markdown">Markdown（按分类打包 ZIP）</button>
          <button class="btn btn-ghost" data-fmt="html">HTML（静态网页）</button>
        </div>
        <div class="modal-actions"><button class="btn btn-ghost" id="modalCancel">关闭</button></div>
      `);
      $("#modalCancel").onclick = closeModal;
      $$("[data-fmt]").forEach((btn) => {
        btn.onclick = () => {
          window.location.href = `/api/export?format=${btn.dataset.fmt}`;
          closeModal();
          toast("开始下载");
        };
      });
    });

    $("#btnImport").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/import", { method: "POST", body: fd });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "导入失败");
        toast(`已导入 ${j.imported_notes} 条笔记`);
        await loadMeta();
        await loadNotes();
      } catch (err) {
        toast(err.message, "err");
      }
      e.target.value = "";
    });

    // Nav tabs
    $$(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchView(tab.dataset.view));
    });

    // Category filters
    els.categoryFilters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      state.filters.category = btn.dataset.cat;
      renderCategoryFilters();
      loadNotes();
    });

    $("#extraFilters").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      const key = btn.dataset.filter;
      state.filters[key] = !state.filters[key];
      if (key === "archived" && state.filters.archived) state.filters.deleted = false;
      if (key === "deleted" && state.filters.deleted) state.filters.archived = false;
      $$("#extraFilters .chip").forEach((c) => {
        c.classList.toggle("active", !!state.filters[c.dataset.filter]);
      });
      loadNotes();
    });

    // Note list click / context / drag
    els.noteList.addEventListener("click", async (e) => {
      const tag = e.target.closest("[data-tag]");
      if (tag) {
        e.stopPropagation();
        state.filters.tag = tag.dataset.tag;
        toast(`筛选标签 #${tag.dataset.tag}`);
        loadNotes();
        return;
      }
      const item = e.target.closest(".note-item");
      if (!item) return;
      if (state.dirty && state.currentId) await saveNote({ auto: true });
      const res = await api(`/api/notes/${item.dataset.id}`);
      switchView("notes");
      openNote(res.data);
    });

    els.noteList.addEventListener("contextmenu", (e) => {
      const item = e.target.closest(".note-item");
      if (!item) return;
      e.preventDefault();
      state.ctxNoteId = +item.dataset.id;
      const menu = els.ctxMenu;
      menu.classList.add("open");
      menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
      menu.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`;
      const note = state.notes.find((n) => n.id === state.ctxNoteId);
      menu.querySelector('[data-action="restore"]').style.display = note?.is_deleted ? "" : "none";
      menu.querySelector('[data-action="delete"]').style.display = note?.is_deleted ? "none" : "";
    });

    // Drag reorder
    els.noteList.addEventListener("dragstart", (e) => {
      const item = e.target.closest(".note-item");
      if (!item) return;
      state.dragId = +item.dataset.id;
      item.classList.add("dragging");
    });
    els.noteList.addEventListener("dragend", async (e) => {
      const item = e.target.closest(".note-item");
      if (item) item.classList.remove("dragging");
      $$(".note-item").forEach((el) => el.classList.remove("drag-over"));
      const order = $$(".note-item", els.noteList).map((el) => +el.dataset.id);
      await api("/api/notes/reorder", { method: "POST", body: JSON.stringify({ order }) });
      state.dragId = null;
    });
    els.noteList.addEventListener("dragover", (e) => {
      e.preventDefault();
      const item = e.target.closest(".note-item");
      if (!item || +item.dataset.id === state.dragId) return;
      $$(".note-item").forEach((el) => el.classList.remove("drag-over"));
      item.classList.add("drag-over");
      const dragging = $(".note-item.dragging");
      if (dragging && item !== dragging) {
        const rect = item.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        els.noteList.insertBefore(dragging, before ? item : item.nextSibling);
      }
    });

    // Context menu actions
    els.ctxMenu.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const id = state.ctxNoteId;
      const action = btn.dataset.action;
      els.ctxMenu.classList.remove("open");
      const note = state.notes.find((n) => n.id === id);
      if (!note) return;
      if (action === "open") {
        const res = await api(`/api/notes/${id}`);
        switchView("notes");
        openNote(res.data);
      } else if (action === "pin") {
        await api(`/api/notes/${id}`, {
          method: "PUT",
          body: JSON.stringify({ is_pinned: !note.is_pinned }),
        });
        await loadNotes();
      } else if (action === "archive") {
        await api(`/api/notes/${id}`, {
          method: "PUT",
          body: JSON.stringify({ is_archived: !note.is_archived }),
        });
        await loadNotes();
        if (state.currentId === id) showEditor(false);
      } else if (action === "copy") {
        await navigator.clipboard.writeText(note.title);
        toast("已复制标题");
      } else if (action === "delete") {
        await api(`/api/notes/${id}`, { method: "DELETE" });
        if (state.currentId === id) {
          state.currentId = null;
          showEditor(false);
          els.emptyState.style.display = "flex";
        }
        await loadNotes();
        toast("已移入回收站");
      } else if (action === "restore") {
        await api(`/api/notes/${id}/restore`, { method: "POST" });
        await loadNotes();
        toast("已恢复");
      }
    });

    document.addEventListener("click", () => {
      els.ctxMenu.classList.remove("open");
      els.phrasesMenu.classList.remove("open");
      els.searchHistory.classList.remove("open");
      els.tagAc.classList.remove("open");
    });

    // Editor fields
    ["input", "change"].forEach((ev) => {
      els.noteTitle.addEventListener(ev, () => {
        markDirty();
        if (els.noteKnowledge.checked) maybeLoadSimilar(els.noteTitle.value);
      });
      els.noteContent.addEventListener(ev, markDirty);
    });
    els.noteCategory.addEventListener("change", markDirty);
    els.noteEnv.addEventListener("change", markDirty);
    els.noteServer.addEventListener("change", () => {
      const opt = els.noteServer.selectedOptions[0];
      if (opt?.dataset?.env) els.noteEnv.value = opt.dataset.env;
      markDirty();
    });
    els.noteKnowledge.addEventListener("change", () => {
      markDirty();
      els.btnLike.style.display = els.noteKnowledge.checked ? "" : "none";
      if (els.noteKnowledge.checked) maybeLoadSimilar(els.noteTitle.value);
      else els.similarBox.classList.remove("open");
    });

    $("#btnSave").addEventListener("click", () => saveNote({ manual: true }));
    $("#btnPin").addEventListener("click", async () => {
      if (!state.current) return;
      await api(`/api/notes/${state.currentId}`, {
        method: "PUT",
        body: JSON.stringify({ ...collectPayload(), is_pinned: !state.current.is_pinned }),
      });
      const res = await api(`/api/notes/${state.currentId}`);
      openNote(res.data);
      await loadNotes();
    });
    $("#btnArchive").addEventListener("click", async () => {
      if (!state.current) return;
      await saveNote({ auto: true });
      await api(`/api/notes/${state.currentId}`, {
        method: "PUT",
        body: JSON.stringify({ is_archived: !state.current.is_archived }),
      });
      state.currentId = null;
      showEditor(false);
      els.emptyState.style.display = "flex";
      await loadNotes();
      toast("已归档");
    });
    $("#btnDelete").addEventListener("click", async () => {
      if (!state.currentId) return;
      if (!confirm("确定将笔记移入回收站？")) return;
      await api(`/api/notes/${state.currentId}`, { method: "DELETE" });
      state.currentId = null;
      showEditor(false);
      els.emptyState.style.display = "flex";
      await loadNotes();
      toast("已移入回收站");
    });

    $("#btnVersions").addEventListener("click", async () => {
      if (!state.currentId) return;
      const res = await api(`/api/notes/${state.currentId}/versions`);
      const vers = res.data || [];
      openModal(`
        <h3>版本历史（最多 ${20} 个）</h3>
        <div style="max-height:360px;overflow:auto">
          ${
            vers.length
              ? vers
                  .map(
                    (v) => `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-subtle)">
              <div style="flex:1">
                <div style="font-size:13px">${escapeHtml(v.title)}</div>
                <div style="font-size:11px;color:var(--text-dim);font-family:var(--mono)">${escapeHtml(v.created_at)} · ${v.content_len} 字</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-restore-ver="${v.id}">恢复</button>
            </div>`
                  )
                  .join("")
              : `<div class="empty-list">暂无版本</div>`
          }
        </div>
        <div class="modal-actions"><button class="btn btn-ghost" id="modalCancel">关闭</button></div>
      `);
      $("#modalCancel").onclick = closeModal;
      $$("[data-restore-ver]").forEach((btn) => {
        btn.onclick = async () => {
          const r = await api(`/api/notes/${state.currentId}/versions/${btn.dataset.restoreVer}/restore`, {
            method: "POST",
          });
          closeModal();
          openNote(r.data);
          await loadNotes();
          toast("已恢复该版本");
        };
      });
    });

    $("#btnPreview").addEventListener("click", () => {
      state.previewMode = (state.previewMode + 1) % 3;
      els.editorBody.classList.remove("split", "preview-only");
      if (state.previewMode === 1) els.editorBody.classList.add("split");
      if (state.previewMode === 2) els.editorBody.classList.add("preview-only");
      updatePreview();
      const labels = ["预览", "分屏中", "预览中"];
      $("#btnPreview").textContent = labels[state.previewMode];
    });

    $("#btnLike").addEventListener("click", async () => {
      if (!state.currentId) return;
      const res = await api(`/api/notes/${state.currentId}/like`, { method: "POST" });
      state.current = res.data;
      toast(`已点赞 (${res.data.likes})`);
    });

    $("#btnCopySolution").addEventListener("click", async () => {
      const sol = state.current?.solution || extractSolution(els.noteContent.value);
      await navigator.clipboard.writeText(sol);
      toast("方案已复制");
    });

    // Toolbar inserts
    $$(".tb-btn[data-insert]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.insert;
        if (t === "code-bash") insertCodeBlock("bash");
        else if (t === "code-python") insertCodeBlock("python");
        else if (t === "code-sql") insertCodeBlock("sql");
        else if (t === "timestamp") insertTimestamp();
        else if (t === "server") insertServerInfo();
      });
    });

    $("#btnPhrases").addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = els.phrasesMenu;
      menu.innerHTML = state.phrases
        .map((p) => `<button data-phrase="${escapeHtml(p.text)}">${escapeHtml(p.text)}</button>`)
        .join("");
      const rect = e.currentTarget.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 4}px`;
      menu.classList.add("open");
      $$("[data-phrase]", menu).forEach((b) => {
        b.onclick = () => {
          insertAtCursor(els.noteContent, b.dataset.phrase);
          menu.classList.remove("open");
        };
      });
    });

    // Tags
    els.tagsDisplay.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const tags = getEditorTags().filter((t) => t !== rm.dataset.remove);
        renderTags(tags);
        markDirty();
        return;
      }
      const pill = e.target.closest("[data-tag]");
      if (pill && !e.target.closest("[data-remove]")) {
        state.filters.tag = pill.dataset.tag;
        loadNotes();
      }
    });

    els.tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "," || e.key === " ") {
        e.preventDefault();
        addTagFromInput();
      } else if (e.key === "Backspace" && !els.tagInput.value) {
        const tags = getEditorTags();
        if (tags.length) {
          renderTags(tags.slice(0, -1));
          markDirty();
        }
      }
    });
    els.tagInput.addEventListener("input", () => {
      const q = els.tagInput.value.replace(/^#/, "").toLowerCase();
      if (!q) {
        els.tagAc.classList.remove("open");
        return;
      }
      const matches = state.tags.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) {
        els.tagAc.classList.remove("open");
        return;
      }
      els.tagAc.innerHTML = matches
        .map((t) => `<button data-ac-tag="${escapeHtml(t.name)}">#${escapeHtml(t.name)} (${t.count})</button>`)
        .join("");
      els.tagAc.classList.add("open");
      $$("[data-ac-tag]", els.tagAc).forEach((b) => {
        b.onclick = (ev) => {
          ev.stopPropagation();
          const tags = getEditorTags();
          if (!tags.includes(b.dataset.acTag)) tags.push(b.dataset.acTag);
          renderTags(tags);
          els.tagInput.value = "";
          els.tagAc.classList.remove("open");
          markDirty();
        };
      });
    });

    function addTagFromInput() {
      let v = els.tagInput.value.trim().replace(/^#/, "");
      if (!v) return;
      const tags = getEditorTags();
      if (!tags.includes(v)) tags.push(v);
      renderTags(tags);
      els.tagInput.value = "";
      els.tagAc.classList.remove("open");
      markDirty();
    }

    // Similar box
    els.similarBox.addEventListener("click", async (e) => {
      const open = e.target.closest("[data-open]");
      if (open) {
        const res = await api(`/api/notes/${open.dataset.open}`);
        if (state.dirty) await saveNote({ auto: true });
        openNote(res.data);
        return;
      }
      const reuse = e.target.closest("[data-reuse]");
      if (reuse) {
        const res = await api(`/api/notes/${reuse.dataset.reuse}`);
        const sol = res.data.solution || extractSolution(res.data.content);
        insertAtCursor(els.noteContent, `\n【复用方案】\n${sol}\n`);
        toast("已插入方案");
      }
    });

    // Search
    els.searchInput.addEventListener("focus", async () => {
      const res = await api("/api/search/history");
      const hist = res.data || [];
      if (!hist.length) return;
      els.searchHistory.innerHTML =
        `<div class="hint">最近搜索</div>` +
        hist.map((h) => `<button data-q="${escapeHtml(h.query)}">${escapeHtml(h.query)}</button>`).join("");
      els.searchHistory.classList.add("open");
      $$("[data-q]", els.searchHistory).forEach((b) => {
        b.onclick = (ev) => {
          ev.stopPropagation();
          els.searchInput.value = b.dataset.q;
          els.searchWrap.classList.add("has-value");
          state.filters.q = b.dataset.q;
          loadNotes();
          els.searchHistory.classList.remove("open");
        };
      });
    });
    els.searchInput.addEventListener("input", () => {
      const v = els.searchInput.value.trim();
      els.searchWrap.classList.toggle("has-value", !!v);
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.filters.q = v;
        loadNotes();
      }, SEARCH_DEBOUNCE);
    });
    els.searchClear.addEventListener("click", () => {
      els.searchInput.value = "";
      els.searchWrap.classList.remove("has-value");
      state.filters.q = "";
      loadNotes();
    });

    // Commands panel
    $("#panel-commands").addEventListener("click", async (e) => {
      const cat = e.target.closest("[data-cmd-cat]");
      if (cat) {
        state.cmdCategory = cat.dataset.cmdCat;
        loadCommands();
        return;
      }
      const copy = e.target.closest("[data-copy-cmd]");
      if (copy) {
        await navigator.clipboard.writeText(copy.dataset.copyCmd);
        toast("命令已复制");
        return;
      }
      const del = e.target.closest("[data-del-cmd]");
      if (del) {
        if (!confirm("删除该命令？")) return;
        await api(`/api/commands/${del.dataset.delCmd}`, { method: "DELETE" });
        loadCommands();
        return;
      }
      const edit = e.target.closest("[data-edit-cmd]");
      if (edit) {
        const all = await api("/api/commands");
        const c = (all.data || []).find((x) => x.id === +edit.dataset.editCmd);
        if (c) showCommandModal(c);
      }
    });

    $("#btnAddCmd").addEventListener("click", () => showCommandModal());

    function showCommandModal(cmd = null) {
      openModal(`
        <h3>${cmd ? "编辑命令" : "添加命令"}</h3>
        <div class="form-row"><label>标题</label><input id="mTitle" value="${escapeHtml(cmd?.title || "")}" /></div>
        <div class="form-row"><label>命令</label><textarea id="mCmd">${escapeHtml(cmd?.command || "")}</textarea></div>
        <div class="form-row"><label>分类</label>
          <select id="mCat">
            ${["网络", "数据库", "容器", "系统"].map((c) => `<option ${cmd?.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
        <div class="form-row"><label>使用场景</label><input id="mScene" value="${escapeHtml(cmd?.scenario || "")}" /></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="modalCancel">取消</button>
          <button class="btn btn-primary" id="modalOk">保存</button>
        </div>
      `);
      $("#modalCancel").onclick = closeModal;
      $("#modalOk").onclick = async () => {
        const body = {
          title: $("#mTitle").value,
          command: $("#mCmd").value,
          category: $("#mCat").value,
          scenario: $("#mScene").value,
        };
        if (cmd) await api(`/api/commands/${cmd.id}`, { method: "PUT", body: JSON.stringify(body) });
        else await api("/api/commands", { method: "POST", body: JSON.stringify(body) });
        closeModal();
        loadCommands();
        toast("已保存");
      };
    }

    // Knowledge panel
    $("#panel-knowledge").addEventListener("click", async (e) => {
      const open = e.target.closest("[data-open-note]");
      if (open) {
        const res = await api(`/api/notes/${open.dataset.openNote}`);
        switchView("notes");
        openNote(res.data);
        return;
      }
      const like = e.target.closest("[data-like]");
      if (like) {
        await api(`/api/notes/${like.dataset.like}/like`, { method: "POST" });
        await loadNotes();
        renderKnowledge();
        toast("已点赞");
        return;
      }
      const copy = e.target.closest("[data-copy-sol]");
      if (copy) {
        const n = state.notes.find((x) => x.id === +copy.dataset.copySol);
        if (n) {
          await navigator.clipboard.writeText(n.solution || extractSolution(n.content));
          toast("方案已复制");
        }
      }
    });

    // Calendar
    $("#calPrev").addEventListener("click", () => {
      state.calMonth--;
      if (state.calMonth < 1) {
        state.calMonth = 12;
        state.calYear--;
      }
      loadCalendar();
    });
    $("#calNext").addEventListener("click", () => {
      state.calMonth++;
      if (state.calMonth > 12) {
        state.calMonth = 1;
        state.calYear++;
      }
      loadCalendar();
    });
    $("#calGrid").addEventListener("click", (e) => {
      const day = e.target.closest("[data-date]");
      if (day) loadCalDay(day.dataset.date);
    });
    $("#calDayList").addEventListener("click", async (e) => {
      const item = e.target.closest(".note-item");
      if (!item) return;
      const res = await api(`/api/notes/${item.dataset.id}`);
      switchView("notes");
      openNote(res.data);
    });

    // Servers
    $("#btnAddServer").addEventListener("click", () => showServerModal());
    $("#panel-servers").addEventListener("click", async (e) => {
      const filter = e.target.closest("[data-filter-server]");
      if (filter) {
        state.filters.server_ip = filter.dataset.filterServer;
        switchView("notes");
        toast(`筛选服务器 ${filter.dataset.filterServer}`);
        loadNotes();
        return;
      }
      const edit = e.target.closest("[data-edit-server]");
      if (edit) {
        const s = state.servers.find((x) => x.id === +edit.dataset.editServer);
        if (s) showServerModal(s);
        return;
      }
      const del = e.target.closest("[data-del-server]");
      if (del) {
        if (!confirm("删除该服务器？")) return;
        await api(`/api/servers/${del.dataset.delServer}`, { method: "DELETE" });
        await loadMeta();
        renderServers();
      }
    });

    function showServerModal(s = null) {
      openModal(`
        <h3>${s ? "编辑服务器" : "添加服务器"}</h3>
        <div class="form-row"><label>名称</label><input id="sName" value="${escapeHtml(s?.name || "")}" /></div>
        <div class="form-row"><label>IP</label><input id="sIp" value="${escapeHtml(s?.ip || "")}" /></div>
        <div class="form-row"><label>环境</label>
          <select id="sEnv">
            ${["生产", "测试", "开发"].map((e) => `<option ${s?.env === e ? "selected" : ""}>${e}</option>`).join("")}
          </select>
        </div>
        <div class="form-row"><label>备注</label><input id="sDesc" value="${escapeHtml(s?.description || "")}" /></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="modalCancel">取消</button>
          <button class="btn btn-primary" id="modalOk">保存</button>
        </div>
      `);
      $("#modalCancel").onclick = closeModal;
      $("#modalOk").onclick = async () => {
        const body = {
          name: $("#sName").value,
          ip: $("#sIp").value,
          env: $("#sEnv").value,
          description: $("#sDesc").value,
        };
        if (s) await api(`/api/servers/${s.id}`, { method: "PUT", body: JSON.stringify(body) });
        else await api("/api/servers", { method: "POST", body: JSON.stringify(body) });
        closeModal();
        await loadMeta();
        renderServers();
        toast("已保存");
      };
    }

    els.modalOverlay.addEventListener("click", (e) => {
      if (e.target === els.modalOverlay) closeModal();
    });

    // Tab key in editor
    els.noteContent.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        insertAtCursor(els.noteContent, "  ");
      }
    });

    // Shortcuts
    document.addEventListener("keydown", (e) => {
      const meta = e.ctrlKey || e.metaKey;
      const tag = (e.target.tagName || "").toLowerCase();
      const inInput = tag === "input" || tag === "textarea" || e.target.isContentEditable;

      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createNote();
        return;
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          // Save as — create a copy
          if (state.current) {
            createNote({
              title: (els.noteTitle.value || "笔记") + " (副本)",
              content: els.noteContent.value,
              category: els.noteCategory.value,
              tags: getEditorTags(),
              server_ip: els.noteServer.value,
              server_env: els.noteEnv.value,
              is_knowledge: els.noteKnowledge.checked,
            });
          }
        } else {
          saveNote({ manual: true });
        }
        return;
      }
      if (meta && e.key.toLowerCase() === "f") {
        e.preventDefault();
        els.searchInput.focus();
        els.searchInput.select();
        return;
      }
      if (meta && e.key.toLowerCase() === "d" && !e.shiftKey) {
        e.preventDefault();
        if (state.currentId) insertTimestamp();
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (state.currentId) insertCodeBlock("bash");
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        $("#btnPreview").click();
        return;
      }
      if (meta && (e.key === "Delete" || e.key === "Backspace") && !inInput) {
        e.preventDefault();
        $("#btnDelete").click();
        return;
      }
      if (e.key === "Escape") {
        if (els.modalOverlay.classList.contains("open")) {
          closeModal();
          return;
        }
        if (els.searchInput.value) {
          els.searchClear.click();
          return;
        }
        els.searchInput.blur();
        els.ctxMenu.classList.remove("open");
        els.phrasesMenu.classList.remove("open");
      }
    });

    // Autosave
    state.autosaveTimer = setInterval(() => {
      if (state.dirty && state.currentId) saveNote({ auto: true });
    }, AUTOSAVE_MS);

    // Warn before leave
    window.addEventListener("beforeunload", (e) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  // ---------- Boot ----------
  async function boot() {
    bindEvents();
    await loadMeta();
    await loadNotes();
  }

  boot().catch((err) => {
    console.error(err);
    toast("初始化失败: " + err.message, "err");
  });
})();

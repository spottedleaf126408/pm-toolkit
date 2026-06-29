/* =========================================================
   TrackerBoard — app.js
   Architecture: localStorage as primary store, GAS as sync
   ========================================================= */

// ── CONSTANTS ──────────────────────────────────────────────
const STATUSES = [
  { key: 'todo',     label: '待處理',  cls: 's-todo'     },
  { key: 'progress', label: '進行中',  cls: 's-progress'  },
  { key: 'review',   label: '審查中',  cls: 's-review'   },
  { key: 'done',     label: '完成',    cls: 's-done'     },
];

const BRAND_PALETTE = [
  '#E8A598','#98C5B8','#A5B8E8','#C9A5E8',
  '#E8C9A5','#A5E8C9','#E8A5C9','#C9E8A5',
  '#E89898','#98B8E8','#B8E898','#E8B898',
];

const TYPE_LABELS = { epic: 'Epic', story: 'Story', subtask: 'Subtask' };
const TYPE_BADGES = { epic: 'badge-epic', story: 'badge-story', subtask: 'badge-subtask' };

// ── GAS URL ────────────────────────────────────────────────
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxQVu--3Xnpo5m4ftiyxz5fQFEjjS5oIMd4KK6js6w4uhTT3fxlZuH3R7gPw8Ox50or/exec';

// ── STATE ──────────────────────────────────────────────────
let state = {
  epics: [],       // [{ id, title, desc, brand, deadline, assignee, status, steps:[], storyIds:[], comments:[], createdAt }]
  stories: [],     // [{ id, epicId, title, desc, assignee, status, steps:[], subtaskIds:[], comments:[], createdAt }]
  subtasks: [],    // [{ id, storyId, title, desc, assignee, status, done, comments:[], createdAt }]
  globalStages: ['待開始','進行中','審查','完成'],  // default kanban columns
  gasUrl: DEFAULT_GAS_URL,
  brandFilter: '',
  timelineOffset: 0,
};
let currentModal = null; // { type, id, isNew }
let brandColorMap = {};

// ── INIT ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  loadFromLocal();
  // 確保 GAS URL 永遠使用預設值
  if (!state.gasUrl) state.gasUrl = DEFAULT_GAS_URL;
  buildBrandColorMap();
  renderAll();
  setupCommentShortcut();
  // 隱藏 banner（已有 GAS）
  document.getElementById('gas-config-banner').style.display = 'none';
  // 自動從 GAS 載入最新資料
  await loadFromGas();
});

function loadFromLocal() {
  const saved = localStorage.getItem('trackerboard_v1');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state = { ...state, ...parsed };
    } catch(e) {}
  }
  state.gasUrl = DEFAULT_GAS_URL;
  document.getElementById('gas-url-input').value = state.gasUrl;
}

function saveToLocal() {
  localStorage.setItem('trackerboard_v1', JSON.stringify(state));
}

async function syncToGas(action, payload) {
  if (!state.gasUrl) return;
  try {
    await fetch(state.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, payload }),
    });
  } catch(e) {
    console.warn('GAS sync failed:', e);
  }
}

// ── ID GEN ─────────────────────────────────────────────────
function genId(prefix) {
  return prefix + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase();
}

// ── BRAND COLOR MAP ────────────────────────────────────────
function buildBrandColorMap() {
  const brands = [...new Set(state.epics.map(e => e.brand).filter(Boolean))];
  brands.forEach((b, i) => {
    if (!brandColorMap[b]) brandColorMap[b] = BRAND_PALETTE[i % BRAND_PALETTE.length];
  });
}

function getBrandColor(brand) {
  if (!brand) return '#72636E';
  if (!brandColorMap[brand]) {
    const used = Object.values(brandColorMap);
    const next = BRAND_PALETTE.find(c => !used.includes(c)) || BRAND_PALETTE[0];
    brandColorMap[brand] = next;
  }
  return brandColorMap[brand];
}

// ── FILTER ─────────────────────────────────────────────────
function applyBrandFilter() {
  state.brandFilter = document.getElementById('brand-filter').value;
  renderAll();
}

function filteredEpics() {
  if (!state.brandFilter) return state.epics;
  return state.epics.filter(e => e.brand === state.brandFilter);
}

function updateBrandFilter() {
  const sel = document.getElementById('brand-filter');
  const cur = sel.value;
  const brands = [...new Set(state.epics.map(e => e.brand).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">全部</option>' +
    brands.map(b => `<option value="${b}" ${b===cur?'selected':''}>${b}</option>`).join('');
  if (cur && !brands.includes(cur)) sel.value = '';
}

// ── RENDER ALL ─────────────────────────────────────────────
function renderAll() {
  buildBrandColorMap();
  updateBrandFilter();
  renderBacklog();
  renderKanban();
  renderTimeline();
  document.getElementById('epic-count').textContent = `${state.epics.length} 主票`;
}

// ── VIEW SWITCH ────────────────────────────────────────────
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
}

// ═══════════════════════════════════════════════════════════
// BACKLOG RENDER
// ═══════════════════════════════════════════════════════════
function renderBacklog() {
  const list = document.getElementById('backlog-list');
  const epics = filteredEpics();
  document.getElementById('backlog-empty').style.display = epics.length ? 'none' : 'flex';

  // Remove old epic rows (keep empty state)
  list.querySelectorAll('.epic-row').forEach(el => el.remove());

  epics.forEach(epic => {
    const el = buildEpicRow(epic);
    list.appendChild(el);
  });
}

function buildEpicRow(epic) {
  const color = getBrandColor(epic.brand);
  const stories = state.stories.filter(s => s.epicId === epic.id);
  const doneStories = stories.filter(s => s.status === 'done').length;
  const pct = stories.length ? Math.round(doneStories / stories.length * 100) : 0;

  const wrap = document.createElement('div');
  wrap.className = 'epic-row';
  wrap.id = 'epic-row-' + epic.id;
  wrap.innerHTML = `
    <div class="epic-row-header" style="--brand-color:${color}" onclick="toggleEpicRow('${epic.id}')">
      <span class="epic-chevron">▶</span>
      <span class="epic-type-badge">Epic</span>
      <span class="epic-row-title">${esc(epic.title || '未命名主票')}</span>
      <span class="epic-row-id">${epic.id}</span>
      ${epic.brand ? `<span class="brand-tag" style="background:${color}22;color:${color}">${esc(epic.brand)}</span>` : ''}
      ${epic.deadline ? `<span class="epic-row-deadline ${deadlineCls(epic.deadline)}">📅 ${formatDate(epic.deadline)}</span>` : ''}
      <span class="status-pill ${statusObj(epic.status).cls}">${statusObj(epic.status).label}</span>
      <div class="epic-row-actions" onclick="event.stopPropagation()">
        <button class="icon-btn" title="編輯" onclick="openEditModal('epic','${epic.id}')">✏️</button>
        <button class="icon-btn" title="新增子票" onclick="openCreateModal('story','${epic.id}')">＋</button>
      </div>
    </div>
    <div class="progress-bar" style="margin:0 16px;border-radius:0;">
      <div class="progress-fill" style="width:${pct}%;"></div>
    </div>`;

  // Story list container
  const storyList = document.createElement('div');
  storyList.className = 'story-list';
  storyList.id = 'story-list-' + epic.id;
  storyList.style.display = 'none';

  stories.forEach(story => {
    storyList.appendChild(buildStoryRow(story));
  });

  // Add story btn
  const addStoryBtn = document.createElement('button');
  addStoryBtn.className = 'add-row-btn';
  addStoryBtn.style.paddingLeft = '28px';
  addStoryBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> 新增 Story`;
  addStoryBtn.onclick = (e) => { e.stopPropagation(); openCreateModal('story', epic.id); };
  storyList.appendChild(addStoryBtn);

  wrap.appendChild(storyList);
  return wrap;
}

function buildStoryRow(story) {
  const subtasks = state.subtasks.filter(s => s.storyId === story.id);
  const doneCount = subtasks.filter(s => s.done).length;

  const el = document.createElement('div');
  el.className = 'story-row';
  el.id = 'story-row-' + story.id;
  el.innerHTML = `
    <span class="story-type-badge">Story</span>
    <span class="story-row-title">${esc(story.title || '未命名子票')}</span>
    <span class="story-row-id">${story.id}</span>
    ${subtasks.length ? `<span style="font-size:11px;color:var(--text-mute);">${doneCount}/${subtasks.length} subtasks</span>` : ''}
    <span class="status-pill ${statusObj(story.status).cls}">${statusObj(story.status).label}</span>
    <div class="story-row-actions" onclick="event.stopPropagation()">
      <button class="icon-btn" title="編輯" onclick="openEditModal('story','${story.id}')">✏️</button>
      <button class="icon-btn" title="展開子任務" onclick="toggleStoryRow('${story.id}',event)">▾</button>
    </div>`;

  el.onclick = () => openEditModal('story', story.id);

  // Subtask container
  const subList = document.createElement('div');
  subList.className = 'subtask-list';
  subList.id = 'sub-list-' + story.id;
  subList.style.display = 'none';

  subtasks.forEach(sub => subList.appendChild(buildSubtaskRow(sub)));

  const addSubBtn = document.createElement('button');
  addSubBtn.className = 'add-row-btn';
  addSubBtn.style.paddingLeft = '40px';
  addSubBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> 新增 Subtask`;
  addSubBtn.onclick = (e) => { e.stopPropagation(); openCreateModal('subtask', story.id); };
  subList.appendChild(addSubBtn);

  // Wrap them together
  const wrap = document.createElement('div');
  wrap.id = 'story-wrap-' + story.id;
  wrap.appendChild(el);
  wrap.appendChild(subList);
  return wrap;
}

function buildSubtaskRow(sub) {
  const el = document.createElement('div');
  el.className = 'subtask-row' + (sub.done ? ' done' : '');
  el.id = 'sub-row-' + sub.id;
  el.innerHTML = `
    <div class="subtask-checkbox ${sub.done ? 'done' : ''}" onclick="toggleSubtaskDone('${sub.id}',event)">
      ${sub.done ? `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>` : ''}
    </div>
    <span class="subtask-row-title">${esc(sub.title || '未命名')}</span>
    <span class="subtask-row-id">${sub.id}</span>
    <span class="status-pill ${statusObj(sub.status).cls}" style="font-size:10px;">${statusObj(sub.status).label}</span>
    <div class="subtask-row-actions" onclick="event.stopPropagation()">
      <button class="icon-btn" title="編輯" onclick="openEditModal('subtask','${sub.id}')">✏️</button>
    </div>`;
  el.onclick = () => openEditModal('subtask', sub.id);
  return el;
}

function toggleEpicRow(epicId) {
  const row = document.getElementById('epic-row-' + epicId);
  const list = document.getElementById('story-list-' + epicId);
  const open = row.classList.toggle('open');
  list.style.display = open ? 'block' : 'none';
}

function toggleStoryRow(storyId, e) {
  if (e) e.stopPropagation();
  const list = document.getElementById('sub-list-' + storyId);
  if (!list) return;
  list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

function toggleSubtaskDone(subId, e) {
  e.stopPropagation();
  const sub = state.subtasks.find(s => s.id === subId);
  if (!sub) return;
  sub.done = !sub.done;
  sub.status = sub.done ? 'done' : 'todo';
  saveToLocal();
  syncToGas('upsert', { type: 'subtask', data: sub });
  renderAll();
}

// ═══════════════════════════════════════════════════════════
// KANBAN RENDER
// ═══════════════════════════════════════════════════════════
function renderKanban() {
  const board = document.getElementById('kanban-board');
  const epics = filteredEpics();
  const stages = state.globalStages;

  document.getElementById('kanban-subtitle').textContent =
    state.brandFilter ? `品牌：${state.brandFilter}` : '全部品牌';

  board.innerHTML = '';

  // Build columns from globalStages
  stages.forEach(stage => {
    // Find all epics where current step matches this stage, OR create "all epic" column
    const col = document.createElement('div');
    col.className = 'kanban-col';

    // Cards: epics whose current active step name === stage
    const matchEpics = epics.filter(epic => {
      const currentStep = epic.steps && epic.steps.find(s => s.name === stage);
      // Show epic in stage column if any step matches, weighted by status
      return epic.steps && epic.steps.some(s => s.name === stage);
    });

    // More practical: show epic in column matching their status label
    const statusEpics = epics.filter(epic => {
      const s = statusObj(epic.status);
      return s.label === stage || epic.status === stageToStatus(stage);
    });

    // Use status-based assignment if stages match statuses, else use step-based
    const isStatusStage = ['待開始','進行中','審查','完成'].includes(stage);
    const cardsToShow = isStatusStage ? statusEpics : matchEpics;

    const count = cardsToShow.length;
    const dot = document.createElement('div');
    col.innerHTML = `
      <div class="kanban-col-header">
        <div class="kanban-col-title">
          <div class="kanban-col-dot" style="background:${stageColor(stage)}"></div>
          ${esc(stage)}
        </div>
        <span class="kanban-col-count">${count}</span>
      </div>`;

    const body = document.createElement('div');
    body.className = 'kanban-col-body';

    if (cardsToShow.length === 0) {
      body.innerHTML = `<div style="font-size:12px;color:var(--text-mute);text-align:center;padding:20px 0;">暫無票卡</div>`;
    } else {
      cardsToShow.forEach(epic => {
        body.appendChild(buildKanbanCard(epic));
      });
    }

    col.appendChild(body);
    board.appendChild(col);
  });
}

function buildKanbanCard(epic) {
  const color = getBrandColor(epic.brand);
  const stories = state.stories.filter(s => s.epicId === epic.id);
  const doneStories = stories.filter(s => s.status === 'done').length;
  const pct = stories.length ? Math.round(doneStories / stories.length * 100) : 0;
  const dl = epic.deadline ? deadlineCls(epic.deadline) : '';

  const card = document.createElement('div');
  card.className = 'epic-card';
  card.style.setProperty('--brand-color', color);
  card.innerHTML = `
    <div class="epic-card-top">
      <span class="epic-card-id">${epic.id}</span>
      ${epic.brand ? `<span class="epic-card-brand" style="color:${color}">${esc(epic.brand)}</span>` : ''}
    </div>
    <div class="epic-card-title">${esc(epic.title || '未命名')}</div>
    <div class="epic-card-meta">
      ${epic.deadline ? `<span class="epic-deadline ${dl}">📅 ${formatDate(epic.deadline)}</span>` : ''}
      ${stories.length ? `<span class="story-count">${doneStories}/${stories.length} stories</span>` : ''}
    </div>
    ${stories.length ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}`;
  card.onclick = () => openEditModal('epic', epic.id);
  return card;
}

function stageToStatus(stage) {
  const map = { '待開始':'todo','進行中':'progress','審查':'review','完成':'done' };
  return map[stage] || 'todo';
}

function stageColor(stage) {
  const map = { '待開始':'#6B6275','進行中':'#9A8A96','審查':'#C9A86B','完成':'#6BAF8C' };
  return map[stage] || '#72636E';
}

// ═══════════════════════════════════════════════════════════
// TIMELINE / GANTT RENDER
// ═══════════════════════════════════════════════════════════
function shiftTimeline(days) {
  if (days === 0) { state.timelineOffset = 0; }
  else { state.timelineOffset += days; }
  renderTimeline();
}

function renderTimeline() {
  const container = document.getElementById('gantt-container');
  const epics = filteredEpics().filter(e => e.deadline);

  const today = new Date();
  today.setHours(0,0,0,0);
  const baseDate = new Date(today);
  baseDate.setDate(baseDate.getDate() + state.timelineOffset);

  const DAYS = 60;
  const startDate = new Date(baseDate);
  startDate.setDate(startDate.getDate() - 15);

  const dates = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  if (epics.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-text">沒有設定期限的主票<br/>請在主票中加入期限</div></div>`;
    return;
  }

  // Build gantt grid
  const totalCols = dates.length + 1; // 1 for label col
  const gantt = document.createElement('div');
  gantt.className = 'gantt-wrap';

  const table = document.createElement('div');
  table.className = 'gantt-table';
  table.style.gridTemplateColumns = `220px repeat(${dates.length}, 36px)`;

  // Header row
  const headerLabel = document.createElement('div');
  headerLabel.className = 'gantt-label-cell header';
  headerLabel.style.top = '0'; headerLabel.style.position = 'sticky'; headerLabel.style.zIndex = '20';
  headerLabel.textContent = '主票';
  table.appendChild(headerLabel);

  dates.forEach(d => {
    const cell = document.createElement('div');
    cell.className = 'gantt-day-header';
    const isToday = d.toDateString() === today.toDateString();
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    if (isToday) cell.classList.add('today');
    if (isWeekend) cell.classList.add('weekend');
    cell.innerHTML = `<div>${d.getDate()}</div><div style="font-size:9px;opacity:0.6;">${['日','一','二','三','四','五','六'][d.getDay()]}</div>`;
    table.appendChild(cell);
  });

  // Epic rows
  epics.forEach(epic => {
    const color = getBrandColor(epic.brand);
    const deadline = new Date(epic.deadline);
    deadline.setHours(0,0,0,0);

    // Try to infer start: createdAt or 30 days before deadline
    let start = epic.createdAt ? new Date(epic.createdAt) : new Date(deadline);
    if (!epic.createdAt) start.setDate(start.getDate() - 30);
    start.setHours(0,0,0,0);

    // Label cell
    const label = document.createElement('div');
    label.className = 'gantt-label-cell';
    label.innerHTML = `
      <span style="font-size:11px;opacity:0.5;">▌</span>
      <div>
        <div class="gantt-label-title" title="${esc(epic.title)}">${esc(epic.title || '未命名')}</div>
        <div class="gantt-label-id">${epic.id}</div>
      </div>`;
    label.style.cursor = 'pointer';
    label.onclick = () => openEditModal('epic', epic.id);
    table.appendChild(label);

    // Day cells
    let barStart = null, barSpan = 0;
    dates.forEach((d, idx) => {
      const cell = document.createElement('div');
      cell.className = 'gantt-cell';
      const isToday = d.toDateString() === today.toDateString();
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      if (isToday) cell.classList.add('today');
      if (isWeekend) cell.classList.add('weekend');

      const inRange = d >= start && d <= deadline;

      if (inRange) {
        if (barStart === null) barStart = idx;
        barSpan++;

        // Draw bar on the first cell of the range
        if (d.getTime() === start.getTime() || idx === 0 && inRange) {
          // handled below via absolute bar
        }
      }
      table.appendChild(cell);
    });

    // Now draw a single absolute bar spanning from barStart
    if (barStart !== null) {
      // Find first cell of this epic's row
      // Cells: row starts at position (epicRowIndex * (dates.length+1) + 1)
      // We'll attach bar to the gantt wrap with absolute positioning
      // Since we use grid, use a floating bar approach: inject into the first in-range cell
      const allCells = table.querySelectorAll('.gantt-cell');
      const epicIdx = epics.indexOf(epic);
      const cellIdx = epicIdx * dates.length + barStart;
      const targetCell = allCells[cellIdx];
      if (targetCell) {
        const bar = document.createElement('div');
        bar.className = 'gantt-bar epic';
        bar.style.left = '2px';
        bar.style.width = `calc(${barSpan * 36}px - 4px)`;
        bar.style.background = color;
        bar.style.color = '#fff';
        bar.style.zIndex = '4';
        bar.textContent = epic.title;
        bar.title = `${epic.title} — 截止：${formatDate(epic.deadline)}`;
        bar.onclick = (e) => { e.stopPropagation(); openEditModal('epic', epic.id); };
        targetCell.appendChild(bar);
      }
    }

    // Stories sub-rows
    const stories = state.stories.filter(s => s.epicId === epic.id);
    stories.forEach(story => {
      const sLabel = document.createElement('div');
      sLabel.className = 'gantt-label-cell';
      sLabel.style.paddingLeft = '32px';
      sLabel.style.background = 'var(--surface)';
      sLabel.innerHTML = `<span style="color:var(--story-accent);font-size:10px;">◆</span>
        <div>
          <div class="gantt-label-title" style="font-size:11px;color:var(--text-sub);" title="${esc(story.title)}">${esc(story.title || '未命名')}</div>
          <div class="gantt-label-id">${story.id}</div>
        </div>`;
      sLabel.style.cursor = 'pointer';
      sLabel.onclick = () => openEditModal('story', story.id);
      table.appendChild(sLabel);

      dates.forEach(d => {
        const cell = document.createElement('div');
        cell.className = 'gantt-cell';
        const isToday = d.toDateString() === today.toDateString();
        if (isToday) cell.classList.add('today');
        if (d.getDay() === 0 || d.getDay() === 6) cell.classList.add('weekend');
        table.appendChild(cell);
      });
    });
  });

  gantt.appendChild(table);
  container.innerHTML = '';
  container.appendChild(gantt);
}

// ═══════════════════════════════════════════════════════════
// MODAL: CREATE / EDIT
// ═══════════════════════════════════════════════════════════
function openCreateModal(type, parentId) {
  const id = genId(type === 'epic' ? 'EP' : type === 'story' ? 'ST' : 'SUB');
  currentModal = { type, id, isNew: true, parentId };
  populateModal({ id, type, title:'', desc:'', status:'todo', steps:[], comments:[], assignee:'' });
  openModal('ticket-modal');
}

function openEditModal(type, id) {
  const obj = getObj(type, id);
  if (!obj) return;
  currentModal = { type, id, isNew: false };
  populateModal({ ...obj, type });
  openModal('ticket-modal');
}

function getObj(type, id) {
  if (type === 'epic')    return state.epics.find(e => e.id === id);
  if (type === 'story')   return state.stories.find(s => s.id === id);
  if (type === 'subtask') return state.subtasks.find(s => s.id === id);
}

function populateModal(obj) {
  const { type, id, title, desc, status, brand, deadline, assignee, steps, comments, epicId, storyId } = obj;

  // Badge
  const badge = document.getElementById('modal-type-badge');
  badge.textContent = TYPE_LABELS[type];
  badge.className = 'modal-type-badge ' + TYPE_BADGES[type];

  document.getElementById('modal-id').textContent = id;
  document.getElementById('modal-title').value = title || '';
  document.getElementById('modal-desc').value = desc || '';
  document.getElementById('modal-assignee').value = assignee || '';

  // Status
  const statusWrap = document.getElementById('modal-status-wrap');
  statusWrap.innerHTML = STATUSES.map(s =>
    `<button class="status-btn ${s.key === (status||'todo') ? 'active' : ''}" onclick="setModalStatus('${s.key}',this)">${s.label}</button>`
  ).join('');

  // Brand / Deadline (epic only)
  document.getElementById('brand-meta').style.display = type === 'epic' ? 'flex' : 'none';
  document.getElementById('deadline-meta').style.display = type === 'epic' ? 'flex' : 'none';
  if (type === 'epic') {
    document.getElementById('modal-brand').value = brand || '';
    document.getElementById('modal-deadline').value = deadline || '';
  }

  // Steps (epic & story only)
  document.getElementById('steps-section').style.display = type !== 'subtask' ? 'flex' : 'none';
  renderModalSteps(steps || []);

  // Children
  const childrenSection = document.getElementById('children-section');
  const childLabel = document.getElementById('children-label');
  const addChildBtn = document.getElementById('add-child-btn');
  if (type === 'epic') {
    childrenSection.style.display = 'flex';
    childLabel.textContent = '子票 (Stories)';
    addChildBtn.textContent = '新增 Story';
    addChildBtn.onclick = () => { closeModal('ticket-modal'); openCreateModal('story', id); };
    renderModalChildren('epic', id);
  } else if (type === 'story') {
    childrenSection.style.display = 'flex';
    childLabel.textContent = 'Subtasks';
    addChildBtn.textContent = '新增 Subtask';
    addChildBtn.onclick = () => { closeModal('ticket-modal'); openCreateModal('subtask', id); };
    renderModalChildren('story', id);
  } else {
    childrenSection.style.display = 'none';
  }

  // Parent info
  const parentMeta = document.getElementById('parent-meta');
  if (type === 'story' && epicId) {
    const epic = state.epics.find(e => e.id === epicId);
    parentMeta.style.display = 'flex';
    document.getElementById('modal-parent-info').textContent = epic ? `${epic.id} ${epic.title}` : epicId;
  } else if (type === 'subtask' && storyId) {
    const story = state.stories.find(s => s.id === storyId);
    parentMeta.style.display = 'flex';
    document.getElementById('modal-parent-info').textContent = story ? `${story.id} ${story.title}` : storyId;
  } else {
    parentMeta.style.display = 'none';
  }

  // Comments
  renderModalComments(comments || []);
  document.getElementById('modal-comment-input').value = '';

  // Delete btn
  document.getElementById('modal-delete-btn').style.display = currentModal.isNew ? 'none' : 'block';
}

function setModalStatus(key, btn) {
  document.querySelectorAll('#modal-status-wrap .status-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function getModalStatus() {
  const active = document.querySelector('#modal-status-wrap .status-btn.active');
  return active ? active.onclick.toString().match(/'(\w+)'/)?.[1] ||
    STATUSES.find(s => s.label === active.textContent)?.key || 'todo' : 'todo';
}

// Re-derive status from onclick attribute
function getModalStatusValue() {
  const active = document.querySelector('#modal-status-wrap .status-btn.active');
  if (!active) return 'todo';
  // Find which status this button represents
  for (const s of STATUSES) {
    if (active.textContent.trim() === s.label) return s.key;
  }
  return 'todo';
}

// Steps in modal
let modalSteps = [];
let modalStepCurrent = 0; // how many steps are "done"
let stepsInEditMode = false;

function renderModalSteps(steps) {
  modalSteps = steps.map(s => ({ ...s }));
  // restore currentStep from saved data
  const saved = steps.findIndex(s => s.isCurrent);
  modalStepCurrent = saved >= 0 ? saved : steps.filter(s => s.done).length;
  // Show progress mode if steps exist and not new
  if (modalSteps.length > 0 && !currentModal.isNew) {
    showProgressMode();
  } else {
    showEditMode();
  }
}

function showProgressMode() {
  stepsInEditMode = false;
  document.getElementById('steps-edit-mode').style.display = 'none';
  document.getElementById('steps-progress-mode').style.display = 'block';
  refreshStepsProgress();
}

function showEditMode() {
  stepsInEditMode = true;
  document.getElementById('steps-edit-mode').style.display = 'block';
  document.getElementById('steps-progress-mode').style.display = 'none';
  refreshStepsList();
}

function switchToEditMode() {
  showEditMode();
}

function refreshStepsProgress() {
  const track = document.getElementById('modal-steps-track');
  track.innerHTML = '';
  const total = modalSteps.length;
  if (total === 0) return;

  modalSteps.forEach((step, i) => {
    let state = i < modalStepCurrent ? 'spr-done' : i === modalStepCurrent ? 'spr-current' : 'spr-pending';
    const row = document.createElement('div');
    row.className = 'step-progress-row ' + state;
    const dot = state === 'spr-done' ? '✓' : (i + 1);
    const badge = state === 'spr-done'
      ? '<span class="step-prog-badge">已完成</span>'
      : state === 'spr-current'
      ? '<span class="step-prog-badge">進行中</span>' : '';
    const hint = state === 'spr-done' ? '點此退回' : state === 'spr-current' ? '點此完成' : '點此跳至';
    row.innerHTML = `
      <div class="step-prog-dot">${dot}</div>
      <div class="step-prog-info">
        <div class="step-prog-name">${esc(step.name)}</div>${badge}
      </div>
      <span class="step-prog-hint">${hint}</span>`;
    row.onclick = () => {
      if (i < modalStepCurrent) { modalStepCurrent = i; }
      else { modalStepCurrent = Math.min(i + 1, total); }
      refreshStepsProgress();
    };
    track.appendChild(row);
  });

  const pct = Math.round(modalStepCurrent / total * 100);
  document.getElementById('modal-steps-bar').style.width = pct + '%';
  document.getElementById('modal-steps-pct').textContent = pct + '%';
}

function refreshStepsList() {
  const list = document.getElementById('modal-steps-list');
  list.innerHTML = '';
  modalSteps.forEach((step, idx) => {
    const el = document.createElement('div');
    el.className = 'step-item';
    el.innerHTML = `
      <span class="step-drag" draggable="true">⠿</span>
      <input class="step-name-input" value="${esc(step.name || '')}" placeholder="步驟名稱…" oninput="modalSteps[${idx}].name=this.value" />
      <div class="step-actions">
        <button class="step-del-btn" onclick="removeStep(${idx})">✕</button>
      </div>`;
    list.appendChild(el);
  });
}

function addStepToModal() {
  modalSteps.push({ name: '', done: false });
  refreshStepsList();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.step-name-input');
    if (inputs.length) inputs[inputs.length-1].focus();
  }, 50);
}

function removeStep(idx) {
  modalSteps.splice(idx, 1);
  if (modalStepCurrent > modalSteps.length) modalStepCurrent = modalSteps.length;
  refreshStepsList();
}

// Children in modal
function renderModalChildren(parentType, parentId) {
  const list = document.getElementById('modal-children-list');
  list.innerHTML = '';
  let children;
  if (parentType === 'epic') children = state.stories.filter(s => s.epicId === parentId);
  else children = state.subtasks.filter(s => s.storyId === parentId);

  if (children.length === 0) {
    list.innerHTML = `<div style="font-size:12px;color:var(--text-mute);">尚無子票</div>`;
    return;
  }
  children.forEach(c => {
    const el = document.createElement('div');
    el.className = 'child-item';
    el.innerHTML = `
      <span class="status-pill ${statusObj(c.status).cls}" style="font-size:10px;">${statusObj(c.status).label}</span>
      <span class="child-item-title">${esc(c.title || '未命名')}</span>
      <span class="child-item-id">${c.id}</span>`;
    el.onclick = () => {
      closeModal('ticket-modal');
      openEditModal(parentType === 'epic' ? 'story' : 'subtask', c.id);
    };
    list.appendChild(el);
  });
}

// Comments
function renderModalComments(comments) {
  const list = document.getElementById('modal-comments-list');
  list.innerHTML = '';
  if (!comments || comments.length === 0) {
    list.innerHTML = `<div style="font-size:12px;color:var(--text-mute);">還沒有留言</div>`;
    return;
  }
  comments.forEach(c => {
    const el = document.createElement('div');
    el.className = 'comment-item';
    const body = linkify(esc(c.body || ''));
    el.innerHTML = `
      <div class="comment-header">
        <span class="comment-author">${esc(c.author || '我')}</span>
        <span class="comment-time">${formatDateTime(c.time)}</span>
      </div>
      <div class="comment-body">${body}</div>`;
    list.appendChild(el);
  });
}

function submitComment() {
  const input = document.getElementById('modal-comment-input');
  const text = input.value.trim();
  if (!text || !currentModal) return;

  const obj = getObj(currentModal.type, currentModal.id);
  if (!obj && !currentModal.isNew) return;

  const comment = { body: text, author: '我', time: new Date().toISOString() };

  if (currentModal.isNew) {
    // Store in pending
    if (!window._pendingComments) window._pendingComments = [];
    window._pendingComments.push(comment);
    const all = [...(window._pendingComments || [])];
    renderModalComments(all);
  } else {
    obj.comments = obj.comments || [];
    obj.comments.push(comment);
    saveToLocal();
    syncToGas('upsert', { type: currentModal.type, data: obj });
    renderModalComments(obj.comments);
  }
  input.value = '';
}

function setupCommentShortcut() {
  document.getElementById('modal-comment-input').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitComment(); }
  });
}

// ── SAVE ───────────────────────────────────────────────────
function saveCurrentTicket() {
  if (!currentModal) return;
  const { type, id, isNew, parentId } = currentModal;

  const title     = document.getElementById('modal-title').value.trim();
  const desc      = document.getElementById('modal-desc').value.trim();
  const assignee  = document.getElementById('modal-assignee').value.trim();
  const status    = getModalStatusValue();
  const steps     = modalSteps.filter(s => s.name.trim()).map((s, i) => ({
    ...s,
    done: i < modalStepCurrent,
    isCurrent: i === modalStepCurrent,
  }));
  const pendingComments = window._pendingComments || [];
  window._pendingComments = [];

  if (type === 'epic') {
    const brand    = document.getElementById('modal-brand').value.trim();
    const deadline = document.getElementById('modal-deadline').value;
    if (isNew) {
      const epic = { id, title, desc, brand, deadline, assignee, status, steps, comments: pendingComments, createdAt: new Date().toISOString() };
      state.epics.push(epic);
      syncToGas('upsert', { type: 'epic', data: epic });
    } else {
      const epic = state.epics.find(e => e.id === id);
      if (epic) { Object.assign(epic, { title, desc, brand, deadline, assignee, status, steps }); syncToGas('upsert', { type: 'epic', data: epic }); }
    }
  } else if (type === 'story') {
    if (isNew) {
      const story = { id, epicId: parentId, title, desc, assignee, status, steps, comments: pendingComments, createdAt: new Date().toISOString() };
      state.stories.push(story);
      const epic = state.epics.find(e => e.id === parentId);
      if (epic) { epic.storyIds = epic.storyIds || []; epic.storyIds.push(id); }
      syncToGas('upsert', { type: 'story', data: story });
    } else {
      const story = state.stories.find(s => s.id === id);
      if (story) { Object.assign(story, { title, desc, assignee, status, steps }); syncToGas('upsert', { type: 'story', data: story }); }
    }
  } else if (type === 'subtask') {
    if (isNew) {
      const sub = { id, storyId: parentId, title, desc, assignee, status, done: status==='done', comments: pendingComments, createdAt: new Date().toISOString() };
      state.subtasks.push(sub);
      const story = state.stories.find(s => s.id === parentId);
      if (story) { story.subtaskIds = story.subtaskIds || []; story.subtaskIds.push(id); }
      syncToGas('upsert', { type: 'subtask', data: sub });
    } else {
      const sub = state.subtasks.find(s => s.id === id);
      if (sub) { Object.assign(sub, { title, desc, assignee, status, done: status==='done' }); syncToGas('upsert', { type: 'subtask', data: sub }); }
    }
  }

  saveToLocal();
  closeModal('ticket-modal');
  renderAll();
  showToast('儲存成功！', 'success');
}

function deleteCurrentTicket() {
  if (!currentModal || currentModal.isNew) return;
  const { type, id } = currentModal;
  if (!confirm('確定刪除此票？相關子票也會一併移除。')) return;

  if (type === 'epic') {
    const stories = state.stories.filter(s => s.epicId === id);
    stories.forEach(story => {
      state.subtasks = state.subtasks.filter(s => s.storyId !== story.id);
    });
    state.stories = state.stories.filter(s => s.epicId !== id);
    state.epics = state.epics.filter(e => e.id !== id);
    syncToGas('delete', { type: 'epic', id });
  } else if (type === 'story') {
    state.subtasks = state.subtasks.filter(s => s.storyId !== id);
    state.stories = state.stories.filter(s => s.id !== id);
    syncToGas('delete', { type: 'story', id });
  } else {
    state.subtasks = state.subtasks.filter(s => s.id !== id);
    syncToGas('delete', { type: 'subtask', id });
  }

  saveToLocal();
  closeModal('ticket-modal');
  renderAll();
  showToast('已刪除', 'success');
}

function addChildFromModal() {}

// ── STAGES MODAL ───────────────────────────────────────────
function openManageStepsModal() {
  const stages = state.globalStages;
  const names = prompt('管理看板階段（每行一個，順序即為欄位順序）：\n\n' + stages.join('\n'));
  if (names === null) return;
  state.globalStages = names.split('\n').map(s => s.trim()).filter(Boolean);
  if (state.globalStages.length === 0) state.globalStages = ['待開始','進行中','完成'];
  saveToLocal();
  renderKanban();
  showToast('階段已更新', 'success');
}

// ── SETTINGS ───────────────────────────────────────────────
function openSettingsModal() {
  state.gasUrl = DEFAULT_GAS_URL;
  document.getElementById('gas-url-input').value = state.gasUrl;
  openModal('settings-modal');
}

function saveGasSettings() {
  const url = document.getElementById('gas-url-input').value.trim();
  state.gasUrl = url;
  saveToLocal();
  closeModal('settings-modal');
  document.getElementById('gas-config-banner').style.display = url ? 'none' : 'flex';
  showToast(url ? 'GAS 連線已設定！' : '已清除 GAS URL', 'success');
  if (url) loadFromGas();
}

async function loadFromGas() {
  if (!state.gasUrl) return;
  showLoading('從 Google Sheet 載入…');
  try {
    const res = await fetch(state.gasUrl + '?action=getAll');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.epics)    state.epics    = data.epics;
    if (data.stories)  state.stories  = data.stories;
    if (data.subtasks) state.subtasks = data.subtasks;
    saveToLocal();
    renderAll();
    showToast('載入成功！', 'success');
  } catch(e) {
    showToast('GAS 連線失敗：' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ── MODAL HELPERS ──────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  window._pendingComments = [];
}
function handleModalOverlayClick(e) {
  if (e.target === e.currentTarget) closeModal(e.currentTarget.id);
}

// ── TOAST ──────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const wrap = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${type==='success'?'✓':'✕'}</span>${msg}`;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── LOADING ────────────────────────────────────────────────
function showLoading(msg) {
  document.getElementById('loading-text').textContent = msg || '載入中…';
  document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}


// ── BRAND AUTOCOMPLETE ────────────────────────────────────
function onBrandInput(input) {
  const val = input.value.trim().toLowerCase();
  const dropdown = document.getElementById('brand-dropdown');
  const brands = [...new Set(state.epics.map(e => e.brand).filter(Boolean))];
  const matches = val
    ? brands.filter(b => b.toLowerCase().includes(val))
    : brands;

  if (matches.length === 0) { dropdown.classList.remove('open'); return; }

  dropdown.innerHTML = '';
  matches.forEach(brand => {
    const color = getBrandColor(brand);
    const opt = document.createElement('div');
    opt.className = 'brand-option';
    opt.innerHTML = `<div class="brand-option-dot" style="background:${color}"></div>${esc(brand)}`;
    opt.onmousedown = (e) => {
      e.preventDefault();
      input.value = brand;
      dropdown.classList.remove('open');
    };
    dropdown.appendChild(opt);
  });
  dropdown.classList.add('open');
}

function hideBrandDropdown() {
  setTimeout(() => {
    const d = document.getElementById('brand-dropdown');
    if (d) d.classList.remove('open');
  }, 150);
}

// ── UTILS ──────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s]+)/g, `<a href="$1" target="_blank" rel="noopener">$1</a>`);
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth()+1}/${dt.getDate()}`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function deadlineCls(d) {
  if (!d) return '';
  const dl = new Date(d + 'T00:00:00');
  const now = new Date(); now.setHours(0,0,0,0);
  const diff = (dl - now) / 86400000;
  if (diff < 0)  return 'overdue';
  if (diff <= 3) return 'soon';
  return '';
}

function statusObj(key) {
  return STATUSES.find(s => s.key === key) || STATUSES[0];
}

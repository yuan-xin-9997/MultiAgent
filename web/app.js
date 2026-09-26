const $ = (selector) => document.querySelector(selector);
const state = { tasks: [], models: [], capabilities: {}, selected: null, mode: 'new', detail: null, events: [], diff: '' };
const roleNames = { planning: '规划 Agent', implementation: '实现 Agent', testing: '测试 Agent', review: 'Review Agent' };
const roleHints = { planning: '拆解任务、设计方案', implementation: '修改代码并提交', testing: '补充测试、分析失败', review: '独立审查代码和验收条件' };
const statusNames = { queued: '排队中', planning: '规划中', awaiting_plan_approval: '待批准计划', approved: '待实现', implementing: '实现中', testing: '测试中', reviewing: 'Review 中', awaiting_user_acceptance: '待验收', publish_requested: '待发布', publishing: '发布中', awaiting_manual_pr: '待手动创建 PR', completed: '已完成', paused: '已暂停', failed: '失败' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notice(message) { const box = $('#notice'); box.textContent = message; box.classList.toggle('hidden', !message); }
async function api(path, method='GET', data) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const value = await response.json();
  if (response.status === 401 && path !== '/api/login') $('#login-overlay').classList.remove('hidden');
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}
function field(label, name, type='text', value='') {
  const wrap = el('div', 'field');
  const title = el('label', '', label); title.htmlFor = name;
  const input = type === 'textarea' ? el('textarea') : el('input');
  if (type !== 'textarea') input.type = type;
  input.id = name; input.name = name; input.value = value;
  wrap.append(title, input); return wrap;
}
function renderTasks() {
  const list = $('#tasks'); list.replaceChildren(); $('#task-count').textContent = `${state.tasks.length} 个任务`;
  if (!state.tasks.length) { const empty = el('div', 'empty'); empty.append(el('strong', '', '还没有任务'), el('span', '', '从右侧创建第一个 Coding 任务。')); list.append(empty); return; }
  for (const item of state.tasks) {
    const button = el('button', `task-entry ${state.selected === item.id ? 'active' : ''}`);
    const top = el('div'); top.append(el('small', '', item.repo), el('span', `status ${item.status}`, statusNames[item.status] || item.status));
    button.append(top, el('strong', '', item.title), el('small', '', new Date(item.updated_at).toLocaleString('zh-CN')));
    button.addEventListener('click', () => selectTask(item.id)); list.append(button);
  }
}
function renderNew() {
  state.mode = 'new'; state.selected = null; renderTasks();
  const root = $('#content'); root.replaceChildren();
  const header = el('div', 'content-header'); const head = el('div'); head.append(el('p', '', 'NEW TASK'), el('h2', '', '创建 Coding 任务'), el('p', '', '四个角色的模型由你逐一指定。')); header.append(head); root.append(header);
  const form = el('form'); form.id = 'task-form';
  const grid = el('div', 'form-grid');
  grid.append(field('任务标题', 'title'), field('GitHub 仓库（owner/repo）', 'repo', 'text', 'yuan-xin-9997/PolicyAnalysisSystem'));
  grid.append(field('基线分支', 'base_branch', 'text', 'main'), field('测试命令（在隔离容器中运行）', 'test_command', 'text', 'PYTHONPATH=src/app/backend python -m pytest -q src/tests/backend'));
  form.append(grid, field('需求说明', 'description', 'textarea'), field('验收条件', 'acceptance', 'textarea'));
  form.append(el('h3', 'section-title', 'Agent 模型分配'));
  const roles = el('div', 'form-grid');
  for (const [role, name] of Object.entries(roleNames)) {
    const card = el('div', 'role-card'); card.append(el('strong', '', name), el('p', '', roleHints[role]));
    const select = el('select'); select.name = `model_${role}`; select.required = true;
    const choices = state.models.filter(m => m.available && m.roles.includes(role) && (!['implementation', 'testing'].includes(role) || m.adapter !== 'chat'));
    for (const model of choices) { const option = el('option', '', `${model.label} · ${model.adapter}`); option.value = model.id; select.append(option); }
    if (!choices.length) { const option = el('option', '', '没有可用模型'); option.value = ''; select.append(option); }
    card.append(select); roles.append(card);
  }
  form.append(roles);
  const actions = el('div', 'actions'); const submit = el('button', 'primary', '创建并开始规划'); submit.type = 'submit'; actions.append(submit); form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); notice(''); submit.disabled = true;
    const values = new FormData(form); const selected = {};
    for (const role of Object.keys(roleNames)) selected[role] = values.get(`model_${role}`);
    try {
      const item = await api('/api/tasks', 'POST', { title: values.get('title'), repo: values.get('repo'), base_branch: values.get('base_branch'), description: values.get('description'), acceptance: values.get('acceptance'), test_command: values.get('test_command'), models: selected });
      await refreshList(); await selectTask(item.id);
    } catch (error) { notice(error.message); } finally { submit.disabled = false; }
  });
  root.append(form);
}
function block(title, text, code=false) {
  const wrap = el('div', 'detail-block'); wrap.append(el('h3', '', title));
  wrap.append(el(code ? 'pre' : 'p', '', text || '尚无内容')); return wrap;
}
async function action(name) {
  try { notice(''); await api(`/api/tasks/${state.selected}/${name}`, 'POST'); await selectTask(state.selected); }
  catch (error) { notice(error.message); }
}
function renderDetail() {
  const item = state.detail; if (!item) return;
  const root = $('#content'); root.replaceChildren();
  const header = el('div', 'content-header'); const head = el('div'); head.append(el('p', '', `${item.repo} · ${item.base_branch}`), el('h2', '', item.title), el('span', `status ${item.status}`, statusNames[item.status] || item.status)); header.append(head); root.append(header);
  if (item.error) root.append(block('需要处理', item.error));
  const chips = el('div', 'model-chips'); for (const [role, model] of Object.entries(item.models)) chips.append(el('span', 'model-chip', `${roleNames[role]}：${model.label || model.id}`));
  const modelBlock = el('div', 'detail-block'); modelBlock.append(el('h3', '', '本任务模型'), chips); root.append(modelBlock);
  root.append(block('需求', item.description), block('验收条件', item.acceptance));
  if (item.plan) root.append(block('规划方案', item.plan));
  if (item.test_output) root.append(block('测试结果', item.test_output, true));
  if (item.review) root.append(block('Review 意见', item.review));
  if (state.diff) root.append(block('代码差异', state.diff, true));
  if (item.pr_url) { const wrap = el('div', 'detail-block'); wrap.append(el('h3', '', item.status === 'awaiting_manual_pr' ? '前往 GitHub 创建 PR' : 'GitHub Pull Request')); const link = el('a', '', item.pr_url); link.href = item.pr_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; wrap.append(link); root.append(wrap); }
  const actions = el('div', 'actions');
  if (item.status === 'awaiting_plan_approval') { const button = el('button', 'primary', '批准计划并开始实现'); button.onclick = () => action('approve'); actions.append(button); }
  if (item.status === 'awaiting_user_acceptance') { const button = el('button', 'primary', state.capabilities.github_pr_ready ? '验收并创建 GitHub PR' : '验收并推送分支'); button.onclick = () => action('publish'); actions.append(button); }
  if (actions.children.length) root.append(actions);
  root.append(el('h3', 'section-title', '执行记录'));
  const log = el('div', 'events'); for (const event of state.events) { const row = el('div', 'event'); row.append(el('time', '', new Date(event.at).toLocaleString('zh-CN')), el('b', '', event.role), el('span', '', event.message)); log.append(row); } root.append(log);
}
async function selectTask(id) {
  state.mode = 'detail'; state.selected = id; renderTasks();
  try {
    const [detail, events, diff] = await Promise.all([api(`/api/tasks/${id}`), api(`/api/tasks/${id}/events`), api(`/api/tasks/${id}/diff`)]);
    if (state.selected !== id) return;
    state.detail = detail; state.events = events; state.diff = diff.diff; renderDetail();
  } catch (error) { notice(error.message); }
}
async function refreshList() {
  state.tasks = await api('/api/tasks'); renderTasks();
}
async function bootstrap() {
  try {
    [state.models, state.capabilities] = await Promise.all([api('/api/models'), api('/api/capabilities')]); await refreshList();
    $('#connection').textContent = '已连接';
    if (!state.capabilities.codex_enabled) notice('111 当前无法连接 OpenAI，Codex 暂停选择；101 本地模型可以继续使用。');
    if (state.selected) await selectTask(state.selected); else renderNew();
  } catch (error) { if (!error.message.includes('请先登录')) notice(error.message); }
}
$('#new-task').addEventListener('click', renderNew);
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); try { await api('/api/login', 'POST', { password: $('#login-password').value }); $('#login-overlay').classList.add('hidden'); $('#login-password').value = ''; notice(''); await bootstrap(); } catch (error) { notice(error.message); }
});
bootstrap();
setInterval(async () => { if (!$('#login-overlay').classList.contains('hidden')) return; try { await refreshList(); if (state.mode === 'detail' && state.selected) await selectTask(state.selected); } catch (_) {} }, 5000);

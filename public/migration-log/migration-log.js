(function () {
  const state = { files: [] };

  function text(value) {
    return value == null ? '' : String(value);
  }

  function create(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = text(content);
    return node;
  }

  function renderStatus(data) {
    const grid = document.getElementById('status-grid');
    grid.innerHTML = '';
    (data.status || []).forEach((item) => {
      const wrapper = create('div', 'status-item');
      wrapper.append(create('dt', null, item.label));
      wrapper.append(create('dd', null, item.value));
      grid.appendChild(wrapper);
    });
  }

  function renderTimeline(data) {
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';
    (data.timeline || []).forEach((item) => {
      const row = create('li');
      const copy = create('div');
      copy.append(create('h3', null, item.title));
      copy.append(create('p', 'muted', item.detail));
      row.append(create('time', null, item.when), copy);
      timeline.appendChild(row);
    });
  }

  function renderDecisions(data) {
    const list = document.getElementById('decision-list');
    list.innerHTML = '';
    (data.decisions || []).forEach((item) => {
      const card = create('article', 'decision-item');
      card.append(create('h3', null, item.title));
      card.append(create('p', 'muted', item.detail));
      list.appendChild(card);
    });
  }

  function renderModules(data) {
    const grid = document.getElementById('module-grid');
    grid.innerHTML = '';
    (data.modules || []).forEach((module) => {
      const card = create('article', 'module-card');
      card.append(create('h3', null, module.name));
      card.append(create('p', 'muted', module.summary));
      if (module.items && module.items.length) {
        const ul = create('ul');
        module.items.forEach((entry) => ul.append(create('li', null, entry)));
        card.append(ul);
      }
      grid.appendChild(card);
    });
  }

  function renderFiles(files) {
    const table = document.getElementById('file-table');
    table.innerHTML = '';
    files.forEach((file) => {
      const row = create('article', 'file-row');
      const detail = create('div');
      detail.append(create('strong', null, file.change));
      detail.append(create('p', 'muted', file.rationale));
      row.append(create('div', 'file-path', file.path));
      row.append(detail);
      row.append(create('span', `badge ${file.badge || 'changed'}`, file.type));
      table.appendChild(row);
    });
  }

  function renderValidation(data) {
    const grid = document.getElementById('validation-grid');
    grid.innerHTML = '';
    (data.validation || []).forEach((group) => {
      const card = create('article', 'validation-card');
      card.append(create('h3', null, group.name));
      const ul = create('ul');
      (group.items || []).forEach((item) => {
        const li = create('li');
        li.append(create('span', item.statusClass || 'result-warn', item.status));
        li.append(document.createTextNode(` - ${item.detail}`));
        ul.append(li);
      });
      card.append(ul);
      grid.appendChild(card);
    });
  }

  function bindFilter() {
    const filter = document.getElementById('file-filter');
    filter.addEventListener('input', () => {
      const needle = filter.value.trim().toLowerCase();
      if (!needle) {
        renderFiles(state.files);
        return;
      }
      renderFiles(state.files.filter((file) => {
        return `${file.path} ${file.type} ${file.change} ${file.rationale}`.toLowerCase().includes(needle);
      }));
    });
  }

  async function init() {
    const response = await fetch('./migration-log.json', { cache: 'no-store' });
    const data = await response.json();
    state.files = data.files || [];
    document.getElementById('intro-copy').textContent = data.summary;
    renderStatus(data);
    renderTimeline(data);
    renderDecisions(data);
    renderModules(data);
    renderFiles(state.files);
    renderValidation(data);
    bindFilter();
  }

  init().catch((error) => {
    document.getElementById('intro-copy').textContent = `No se pudo cargar el registro: ${error.message}`;
  });
}());

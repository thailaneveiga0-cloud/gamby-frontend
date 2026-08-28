/**
 * learning.js — Central de Aprendizado GAMBY
 *
 * Usuários: visualizam materiais ativos, buscam, filtram por categoria.
 * Desenvolvedora: cria, edita, publica, despublica, exclui, faz upload.
 */

import {
  getLearningMaterials,
  getLearningCategories,
  getLearningMaterial,
  createLearningMaterial,
  updateLearningMaterial,
  publishLearningMaterial,
  unpublishLearningMaterial,
  deleteLearningMaterial,
  uploadLearningFile,
  formatDuration,
  formatFileSize,
  LEARNING_TYPE_LABELS,
  LEARNING_CATEGORIES
} from './services/learning-service.js';

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _safeUrl(url) {
  const v = String(url || '').trim();
  if (!v) return '';
  try {
    const p = new URL(v, window.location.origin);
    if (['http:', 'https:'].includes(p.protocol)) return p.href;
    return '';
  } catch { return ''; }
}

/* ─── State ───────────────────────────────────────────────────────────────── */

let _container    = null;
let _isDev        = false;
let _materials    = [];
let _categories   = [];
let _filterCat    = '';
let _filterType   = '';
let _search       = '';
let _editingId    = null;

const TYPE_ICONS = {
  video:        '▶',
  pdf:          '📄',
  guide:        '⚡',
  tutorial:     '🎓',
  release_note: '🆕',
  announcement: '📢'
};

/* ─── Init ────────────────────────────────────────────────────────────────── */

export async function initLearningPage(container, { isDeveloper = false, sessionRole } = {}) {
  _container = container;
  _isDev     = isDeveloper || sessionRole === 'desenvolvedora';
  _filterCat = '';
  _filterType = '';
  _search     = '';

  renderShell();
  await loadData();
}

function renderShell() {
  _container.innerHTML = `
    <div class="lp-page">
      <div class="lp-header">
        <div class="lp-header-left">
          <h1 class="lp-title">Central de Aprendizado</h1>
          <p class="lp-subtitle">Tutoriais, apostilas e novidades para dominar o GAMBY</p>
        </div>
        ${_isDev ? `<button class="lp-btn-new" id="lpNewBtn">+ Novo Material</button>` : ''}
      </div>

      <div class="lp-toolbar">
        <input class="lp-search" id="lpSearch" placeholder="Buscar materiais..." type="search">
        <select class="lp-select" id="lpFilterType">
          <option value="">Todos os tipos</option>
          ${Object.entries(LEARNING_TYPE_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <select class="lp-select" id="lpFilterCat">
          <option value="">Todas as categorias</option>
        </select>
      </div>

      <div id="lpCategoryChips" class="lp-chips"></div>

      <div id="lpGrid" class="lp-grid">
        <div class="lp-loading">Carregando materiais...</div>
      </div>

      <div id="lpModal"  class="lp-modal-overlay" hidden></div>
      <div id="lpViewer" class="lp-modal-overlay" hidden></div>
    </div>
  `;

  _container.querySelector('#lpSearch')?.addEventListener('input', e => {
    _search = e.target.value.trim();
    renderGrid();
  });
  _container.querySelector('#lpFilterType')?.addEventListener('change', e => {
    _filterType = e.target.value;
    renderGrid();
  });
  _container.querySelector('#lpFilterCat')?.addEventListener('change', e => {
    _filterCat = e.target.value;
    renderGrid();
  });
  _container.querySelector('#lpNewBtn')?.addEventListener('click', () => openMaterialModal(null));
}

/* ─── Data loading ────────────────────────────────────────────────────────── */

async function loadData() {
  try {
    const [mats, cats] = await Promise.all([
      getLearningMaterials({ activeOnly: !_isDev, limit: 200 }),
      getLearningCategories()
    ]);
    _materials  = mats.materials || [];
    _categories = cats.categories || [];
    populateCategoryFilter();
    renderGrid();
  } catch (err) {
    _container.querySelector('#lpGrid').innerHTML =
      `<div class="lp-empty">Erro ao carregar materiais: ${_esc(err?.message || 'Tente novamente.')}</div>`;
  }
}

function populateCategoryFilter() {
  const sel = _container.querySelector('#lpFilterCat');
  if (!sel) return;
  _categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.category;
    opt.textContent = `${c.category} (${c.count})`;
    sel.appendChild(opt);
  });
}

/* ─── Grid rendering ──────────────────────────────────────────────────────── */

function renderGrid() {
  const grid = _container.querySelector('#lpGrid');
  if (!grid) return;

  let filtered = _materials;
  if (_filterCat)  filtered = filtered.filter(m => m.category === _filterCat);
  if (_filterType) filtered = filtered.filter(m => m.type     === _filterType);
  if (_search) {
    const q = _search.toLowerCase();
    filtered = filtered.filter(m =>
      m.title?.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    grid.innerHTML = `<div class="lp-empty">Nenhum material encontrado.</div>`;
    return;
  }

  // Featured first
  const featured   = filtered.filter(m => m.isFeatured);
  const regular    = filtered.filter(m => !m.isFeatured);
  const sorted     = [...featured, ...regular];

  grid.innerHTML = sorted.map(m => renderCard(m)).join('');

  // Bind card actions
  grid.querySelectorAll('[data-view-id]').forEach(el => {
    el.addEventListener('click', () => openViewer(el.dataset.viewId));
  });
  if (_isDev) {
    grid.querySelectorAll('[data-edit-id]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); openMaterialModal(el.dataset.editId); });
    });
    grid.querySelectorAll('[data-toggle-id]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); togglePublish(el.dataset.toggleId, el.dataset.active === 'true'); });
    });
    grid.querySelectorAll('[data-delete-id]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); confirmDelete(el.dataset.deleteId, el.dataset.title); });
    });
  }
}

function renderCard(m) {
  const typeLabel = LEARNING_TYPE_LABELS[m.type] || _esc(m.type);
  const icon      = TYPE_ICONS[m.type] || '📁';
  const dur       = formatDuration(m.durationSecs);
  const size      = formatFileSize(m.fileSizeBytes);
  const _mid      = _esc(String(m.id ?? ''));
  const _mtitle   = _esc(m.title || '');

  const devActions = _isDev ? `
    <div class="lp-card-dev-actions">
      <button class="lp-dev-btn" data-edit-id="${_mid}" title="Editar">✏</button>
      <button class="lp-dev-btn ${m.isActive ? 'lp-dev-btn-warn' : 'lp-dev-btn-ok'}"
        data-toggle-id="${_mid}" data-active="${m.isActive ? 'true' : 'false'}"
        title="${m.isActive ? 'Despublicar' : 'Publicar'}">
        ${m.isActive ? '⏸' : '▶'}
      </button>
      <button class="lp-dev-btn lp-dev-btn-danger" data-delete-id="${_mid}" data-title="${_mtitle}" title="Excluir">🗑</button>
    </div>
  ` : '';

  const descText = m.description ? m.description.slice(0, 100) + (m.description.length > 100 ? '…' : '') : '';

  return `
    <div class="lp-card ${!m.isActive ? 'lp-card-draft' : ''} ${m.isFeatured ? 'lp-card-featured' : ''} lp-cursor-row"
         data-view-id="${_mid}"
      ${m.isFeatured ? `<div class="lp-card-badge lp-badge-featured">Destaque</div>` : ''}
      ${!m.isActive  ? `<div class="lp-card-badge lp-badge-draft">Rascunho</div>` : ''}
      <div class="lp-card-icon">${icon}</div>
      <div class="lp-card-type">${typeLabel}</div>
      <h3 class="lp-card-title">${_mtitle}</h3>
      ${descText ? `<p class="lp-card-desc">${_esc(descText)}</p>` : ''}
      <div class="lp-card-meta">
        <span class="lp-card-category">${_esc(m.category || '')}</span>
        ${dur  ? `<span class="lp-card-dur">⏱ ${_esc(dur)}</span>` : ''}
        ${size ? `<span class="lp-card-size">📦 ${_esc(size)}</span>` : ''}
        ${m.viewCount ? `<span class="lp-card-views">👁 ${Number(m.viewCount)}</span>` : ''}
      </div>
      ${devActions}
    </div>
  `;
}

/* ─── Viewer modal ────────────────────────────────────────────────────────── */

async function openViewer(id) {
  const viewer = _container.querySelector('#lpViewer');
  viewer.innerHTML = `<div class="lp-modal"><p class="lp-loading-text">Carregando...</p></div>`;
  viewer.style.display = 'flex';

  try {
    const m = await getLearningMaterial(id);
    const _vVideoUrl = _safeUrl(m.videoUrl);
    const _vFileUrl  = _safeUrl(m.fileUrl);
    const _vMid      = _esc(String(m.id ?? ''));
    viewer.innerHTML = `
      <div class="lp-modal">
        <button class="lp-modal-close" id="viewerClose">✕</button>
        <div class="lp-viewer-header">
          <div class="lp-card-type">${LEARNING_TYPE_LABELS[m.type] || _esc(m.type)}</div>
          <h2 class="lp-viewer-title">${_esc(m.title)}</h2>
          ${m.description ? `<p class="lp-viewer-desc">${_esc(m.description)}</p>` : ''}
        </div>
        <div class="lp-viewer-body">
          ${_vVideoUrl ? `
            <video controls class="lp-video-player">
              <source src="${_esc(_vVideoUrl)}">
              Seu navegador não suporta vídeo HTML5.
            </video>` : ''}
          ${_vFileUrl && !_vVideoUrl ? `
            <div class="lp-loading-wrap">
              <a href="${_esc(_vFileUrl)}" target="_blank" rel="noopener"
                 class="lp-download-btn">
                📄 Abrir / Baixar Apostila PDF
              </a>
            </div>` : ''}
          ${!_vVideoUrl && !_vFileUrl ? `<div class="lp-empty">Nenhum arquivo anexado ainda.</div>` : ''}
        </div>
        <div class="lp-viewer-footer">
          <span class="lp-card-category">${_esc(m.category || '')}</span>
          ${_isDev ? `
            <button class="lp-btn-edit-viewer" data-edit-id="${_vMid}">Editar material</button>
          ` : ''}
        </div>
      </div>
    `;
  } catch (err) {
    viewer.innerHTML = `
      <div class="lp-modal">
        <button class="lp-modal-close" id="viewerClose">✕</button>
        <p class="lp-err-msg">Erro: ${_esc(err?.message || 'Tente novamente.')}</p>
      </div>
    `;
  }

  viewer.querySelector('#viewerClose')?.addEventListener('click', () => { viewer.style.display = 'none'; });
  viewer.querySelector('[data-edit-id]')?.addEventListener('click', e => {
    viewer.style.display = 'none';
    openMaterialModal(e.target.dataset.editId);
  });
  viewer.addEventListener('click', e => { if (e.target === viewer) viewer.style.display = 'none'; });
}

/* ─── Developer: create/edit modal ───────────────────────────────────────── */

async function openMaterialModal(id) {
  _editingId = id;
  const modal = _container.querySelector('#lpModal');
  let existing = null;

  if (id) {
    try { existing = await getLearningMaterial(id); } catch {}
  }

  modal.innerHTML = `
    <div class="lp-modal lp-modal-form">
      <button class="lp-modal-close" id="modalClose">✕</button>
      <h2 class="lp-modal-title">${id ? 'Editar Material' : 'Novo Material'}</h2>
      <form id="lpMaterialForm" class="lp-form">
        <label class="lp-label">Título *
          <input class="lp-input" name="title" required value="${_esc(existing?.title || '')}" placeholder="Título do material">
        </label>
        <label class="lp-label">Descrição
          <textarea class="lp-input lp-textarea" name="description" placeholder="Descrição breve">${_esc(existing?.description || '')}</textarea>
        </label>
        <div class="lp-form-row">
          <label class="lp-label">Tipo *
            <select class="lp-input" name="type" required>
              ${Object.entries(LEARNING_TYPE_LABELS).map(([v,l]) =>
                `<option value="${v}" ${existing?.type === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <label class="lp-label">Categoria *
            <select class="lp-input" name="category" required>
              ${LEARNING_CATEGORIES.map(c =>
                `<option value="${c}" ${existing?.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="lp-label">URL de Vídeo (externo ou local)
          <input class="lp-input" name="videoUrl" value="${_esc(existing?.videoUrl || '')}" placeholder="https://... ou /uploads/learning/...">
        </label>
        <label class="lp-label">URL de Arquivo (PDF)
          <input class="lp-input" name="fileUrl" value="${_esc(existing?.fileUrl || '')}" placeholder="https://... ou /uploads/learning/...">
        </label>
        <label class="lp-label">Visibilidade
          <select class="lp-input" name="visibility">
            <option value="all"      ${(existing?.visibility||'all')==='all'      ? 'selected' : ''}>Todos os planos</option>
            <option value="economic" ${existing?.visibility==='economic'          ? 'selected' : ''}>Econômico+</option>
            <option value="pro"      ${existing?.visibility==='pro'               ? 'selected' : ''}>PRO</option>
          </select>
        </label>
        <label class="lp-checkbox-label">
          <input type="checkbox" name="isFeatured" ${existing?.isFeatured ? 'checked' : ''}>
          Material em destaque
        </label>
        ${id ? `
          <div class="lp-upload-section">
            <div class="lp-label">Upload de arquivo (substituir atual)</div>
            <input type="file" id="lpFileInput" class="lp-file-input" accept=".pdf,video/mp4,video/webm,video/quicktime">
            <button type="button" class="lp-btn-upload" id="lpUploadBtn">Enviar arquivo</button>
            <span id="lpUploadStatus" class="lp-upload-status"></span>
          </div>
        ` : ''}
        <div class="lp-form-actions">
          <button type="button" class="lp-btn-cancel" id="modalCancelBtn">Cancelar</button>
          <button type="submit" class="lp-btn-save">
            ${id ? 'Salvar alterações' : 'Criar material'}
          </button>
        </div>
      </form>
    </div>
  `;

  modal.style.display = 'flex';

  modal.querySelector('#modalClose')?.addEventListener('click',  () => { modal.style.display = 'none'; });
  modal.querySelector('#modalCancelBtn')?.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  // Upload button
  modal.querySelector('#lpUploadBtn')?.addEventListener('click', async () => {
    const file = modal.querySelector('#lpFileInput')?.files?.[0];
    if (!file) return;
    const statusEl = modal.querySelector('#lpUploadStatus');
    statusEl.textContent = 'Enviando...';
    try {
      const type = file.type.startsWith('video/') ? 'video' : 'pdf';
      await uploadLearningFile(id, file, type);
      statusEl.style.color = '#22c55e';
      statusEl.textContent = 'Upload concluído!';
    } catch (err) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = err?.message || 'Erro no upload.';
    }
  });

  // Form submit
  modal.querySelector('#lpMaterialForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const data = {
      title:       fd.get('title'),
      description: fd.get('description') || null,
      type:        fd.get('type'),
      category:    fd.get('category'),
      videoUrl:    fd.get('videoUrl') || null,
      fileUrl:     fd.get('fileUrl')  || null,
      visibility:  fd.get('visibility'),
      isFeatured:  fd.get('isFeatured') === 'on'
    };
    try {
      if (id) {
        await updateLearningMaterial(id, data);
      } else {
        await createLearningMaterial(data);
      }
      modal.style.display = 'none';
      await loadData();
    } catch (err) {
      alert(err?.message || 'Erro ao salvar material.');
    }
  });
}

/* ─── Publish / Unpublish ─────────────────────────────────────────────────── */

async function togglePublish(id, isActive) {
  try {
    if (isActive) {
      await unpublishLearningMaterial(id);
    } else {
      await publishLearningMaterial(id);
    }
    await loadData();
  } catch (err) {
    alert(err?.message || 'Erro ao alterar status.');
  }
}

/* ─── Delete ──────────────────────────────────────────────────────────────── */

async function confirmDelete(id, title) {
  if (!confirm(`Excluir o material "${title}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await deleteLearningMaterial(id);
    await loadData();
  } catch (err) {
    alert(err?.message || 'Erro ao excluir material.');
  }
}

/* ─── Styles ──────────────────────────────────────────────────────────────── */

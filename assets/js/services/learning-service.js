/**
 * learning-service.js — Frontend API client for the Learning Center
 *
 * All calls go through httpRequest (JWT + tenant header auto-injected).
 * Developers get extra management endpoints.
 */

import { httpRequest } from '../http.js';

const BASE = '/v1/learning';

/* ─── Read (all authenticated users) ─────────────────────────────────────── */

export async function getLearningMaterials({ type, category, search, limit = 50, offset = 0, activeOnly } = {}) {
  const params = new URLSearchParams();
  if (type)      params.set('type',     type);
  if (category)  params.set('category', category);
  if (search)    params.set('search',   search);
  if (limit)     params.set('limit',    String(limit));
  if (offset)    params.set('offset',   String(offset));
  if (activeOnly !== undefined) params.set('activeOnly', String(activeOnly));
  const qs = params.toString() ? `?${params}` : '';
  return httpRequest(`${BASE}/materials${qs}`);
}

export async function getLearningMaterial(id) {
  return httpRequest(`${BASE}/materials/${id}`);
}

export async function getLearningCategories() {
  return httpRequest(`${BASE}/categories`);
}

/* ─── Write (desenvolvedora only) ─────────────────────────────────────────── */

export async function createLearningMaterial(data) {
  return httpRequest(`${BASE}/materials`, {
    method: 'POST',
    body:   JSON.stringify(data)
  });
}

export async function updateLearningMaterial(id, data) {
  return httpRequest(`${BASE}/materials/${id}`, {
    method: 'PATCH',
    body:   JSON.stringify(data)
  });
}

export async function publishLearningMaterial(id) {
  return httpRequest(`${BASE}/materials/${id}/publish`, { method: 'POST' });
}

export async function unpublishLearningMaterial(id) {
  return httpRequest(`${BASE}/materials/${id}/unpublish`, { method: 'POST' });
}

export async function deleteLearningMaterial(id) {
  return httpRequest(`${BASE}/materials/${id}`, { method: 'DELETE' });
}

export async function uploadLearningFile(materialId, file, fileType = 'pdf') {
  const formData = new FormData();
  formData.append('file', file);
  return httpRequest(`${BASE}/materials/${materialId}/upload?type=${fileType}`, {
    method: 'POST',
    body:   formData
    // Content-Type NOT set — browser sets multipart boundary automatically
  });
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

export function formatDuration(secs) {
  if (!secs) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatFileSize(bytes) {
  if (!bytes) return null;
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const LEARNING_TYPE_LABELS = {
  video:        'Vídeo',
  pdf:          'Apostila PDF',
  guide:        'Guia Rápido',
  tutorial:     'Tutorial',
  release_note: 'Novidade',
  announcement: 'Comunicado'
};

export const LEARNING_CATEGORIES = [
  'Começando no GAMBY',
  'PDV',
  'Produtos',
  'Financeiro',
  'Estoque',
  'Planos e Pagamentos',
  'Segurança',
  'WhatsApp',
  'Marketplace',
  'Auditoria',
  'Multiempresa',
  'Novidades'
];

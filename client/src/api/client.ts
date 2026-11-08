import type { User, Project, ProjectMember, Version, Comment, Reply, CommentStatus } from './types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'request failed' }));
    throw new Error(data?.error || 'request failed');
  }
  return res.json() as Promise<T>;
}

export interface NewCommentInput {
  selector: string;
  text_excerpt: string;
  page_url: string;
  step: string;
  state: string;
  state_mode: string;
  x: number;
  y: number;
  body: string;
}

export const api = {
  me: () => request<User | null>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  signup: (email: string, password: string, name?: string) =>
    request<User>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  login: (email: string, password: string) =>
    request<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  listProjects: () => request<Project[]>('/projects'),
  createProject: (name: string) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  updateProject: (id: string, name: string) =>
    request<{ id: string; name: string }>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),

  listMembers: (projectId: string) => request<ProjectMember[]>(`/projects/${projectId}/members`),
  addMember: (projectId: string, email: string) =>
    request<ProjectMember>(`/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  removeMember: (projectId: string, email: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/members/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    }),

  listVersions: (projectId: string) => request<Version[]>(`/projects/${projectId}/versions`),
  createVersion: (projectId: string, label: string, url: string) =>
    request<Version>(`/projects/${projectId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ label, url }),
    }),
  updateVersion: (id: string, patch: { label?: string; url?: string }) =>
    request<{ id: string; label: string; url: string }>(`/versions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteVersion: (id: string) => request<{ ok: boolean }>(`/versions/${id}`, { method: 'DELETE' }),

  listComments: (versionId: string) => request<Comment[]>(`/versions/${versionId}/comments`),
  createComment: (versionId: string, input: NewCommentInput) =>
    request<Comment>(`/versions/${versionId}/comments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  createReply: (commentId: string, body: string) =>
    request<Reply>(`/comments/${commentId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  updateComment: (
    commentId: string,
    patch: { status: CommentStatus; resolved_version_id?: string },
  ) =>
    request<Comment>(`/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteComment: (commentId: string) =>
    request<{ ok: boolean }>(`/comments/${commentId}`, { method: 'DELETE' }),
};

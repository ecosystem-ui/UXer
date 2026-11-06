export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  owner_name?: string;
  role?: 'owner' | 'viewer';
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

export interface Version {
  id: string;
  project_id: string;
  label: string;
  url: string;
  seq: number;
  created_at: string;
  open_count: number;
  resolved_count: number;
}

export interface Reply {
  id: string;
  comment_id: string;
  author_id: string;
  author?: User;
  body: string;
  created_at: string;
}

export type CommentStatus = 'open' | 'resolved';

export interface Comment {
  id: string;
  version_id: string;
  selector: string;
  text_excerpt: string;
  page_url: string;
  /** Wizard step id/label (captured from a stepper) so navigation can replay it. */
  step: string;
  /** View-state key the comment was captured in; empty means "any state". */
  state: string;
  /** How the state key was produced: 'declarative' | 'auto'. */
  state_mode: string;
  x: number;
  y: number;
  body: string;
  status: CommentStatus;
  author_id: string;
  author?: User;
  created_at: string;
  resolved_at: string | null;
  resolved_version_id: string | null;
  replies: Reply[];
}

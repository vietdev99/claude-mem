/**
 * Project Management Types
 */

import { ObjectId } from 'mongodb';

export type ProjectRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ProjectVisibility = 'private' | 'team' | 'public';

export interface Project {
  _id?: ObjectId;
  name: string;
  slug: string;
  description?: string;
  owner_id: string;
  visibility: ProjectVisibility;
  settings: {
    context_sharing: boolean;
    allow_member_invite: boolean;
  };
  created_at: Date;
  updated_at: Date;
}

export interface ProjectMember {
  _id?: ObjectId;
  project_id: string;
  user_id: string;
  role: ProjectRole;
  invited_by?: string;
  joined_at: Date;
}

export interface Observation {
  _id?: ObjectId;
  project_id: string;
  user_id: string;
  session_id: string;
  prompt_number: number;
  tool_name: string;
  tool_input: string;
  tool_response: string;
  observation_type?: string;
  observation_concept?: string;
  narrative?: string;
  keywords?: string;
  cwd?: string;
  created_at: Date;
}

export interface Session {
  _id?: ObjectId;
  project_id: string;
  user_id: string;
  content_session_id: string;
  memory_session_id?: string;
  started_at: Date;
  ended_at?: Date;
  prompt_count: number;
}

export interface UserPrompt {
  _id?: ObjectId;
  project_id: string;
  user_id: string;
  session_id: string;
  prompt_number: number;
  prompt_text: string;
  created_at: Date;
}

export interface Summary {
  _id?: ObjectId;
  project_id: string;
  user_id: string;
  session_id: string;
  summary_text: string;
  observation_ids: string[];
  created_at: Date;
}

// API Response types
export interface ProjectWithRole extends Project {
  role: ProjectRole;
  member_count?: number;
}

export interface ProjectMemberWithUser extends ProjectMember {
  username: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  visibility?: ProjectVisibility;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  visibility?: ProjectVisibility;
  settings?: {
    context_sharing?: boolean;
    allow_member_invite?: boolean;
  };
}

export interface AddMemberRequest {
  username: string;
  role?: ProjectRole;
}

export interface ContextQuery {
  project_id: string;
  user_id?: string;  // If not provided, get all team context
  limit?: number;
  include_observations?: boolean;
  include_summaries?: boolean;
  include_prompts?: boolean;
}

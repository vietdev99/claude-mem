/**
 * Project Management Service
 * Handles projects, members, and permissions
 */

import { ObjectId, Collection } from 'mongodb';
import { mongoConnection } from '../auth/MongoConnection.js';
import { logger } from '../../utils/logger.js';
import {
  Project,
  ProjectMember,
  ProjectRole,
  ProjectVisibility,
  ProjectWithRole,
  ProjectMemberWithUser,
  CreateProjectRequest,
  UpdateProjectRequest,
} from './types.js';

class ProjectService {
  private async getProjectsCollection(): Promise<Collection<Project>> {
    const db = await mongoConnection.getDb();
    return db.collection<Project>('projects');
  }

  private async getMembersCollection(): Promise<Collection<ProjectMember>> {
    const db = await mongoConnection.getDb();
    return db.collection<ProjectMember>('project_members');
  }

  /**
   * Generate URL-friendly slug from project name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  /**
   * Ensure unique slug by appending number if needed
   */
  private async ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
    const projects = await this.getProjectsCollection();
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const query: Record<string, unknown> = { slug };
      if (excludeId) {
        query._id = { $ne: new ObjectId(excludeId) };
      }
      const existing = await projects.findOne(query);
      if (!existing) break;
      slug = `${baseSlug}-${counter++}`;
    }

    return slug;
  }

  /**
   * Create a new project
   */
  async createProject(userId: string, data: CreateProjectRequest): Promise<Project> {
    const projects = await this.getProjectsCollection();
    const members = await this.getMembersCollection();

    // Validate name
    if (!data.name || data.name.trim().length < 2) {
      throw new Error('Project name must be at least 2 characters');
    }
    if (data.name.length > 100) {
      throw new Error('Project name must be less than 100 characters');
    }

    const slug = await this.ensureUniqueSlug(this.generateSlug(data.name));

    const project: Project = {
      name: data.name.trim(),
      slug,
      description: data.description?.trim() || '',
      owner_id: userId,
      visibility: data.visibility || 'team',
      settings: {
        context_sharing: true,
        allow_member_invite: true,
      },
      created_at: new Date(),
      updated_at: new Date(),
    };

    const result = await projects.insertOne(project);
    project._id = result.insertedId;

    // Add owner as member with 'owner' role
    await members.insertOne({
      project_id: result.insertedId.toString(),
      user_id: userId,
      role: 'owner',
      joined_at: new Date(),
    });

    logger.info('Project', `Project created: ${project.name} by user ${userId}`);

    return project;
  }

  /**
   * Get project by ID
   */
  async getProjectById(projectId: string): Promise<Project | null> {
    try {
      const projects = await this.getProjectsCollection();
      return await projects.findOne({ _id: new ObjectId(projectId) });
    } catch {
      return null;
    }
  }

  /**
   * Get project by slug
   */
  async getProjectBySlug(slug: string): Promise<Project | null> {
    const projects = await this.getProjectsCollection();
    return await projects.findOne({ slug });
  }

  /**
   * Get all projects for a user (owned + member of)
   */
  async getUserProjects(userId: string): Promise<ProjectWithRole[]> {
    const projects = await this.getProjectsCollection();
    const members = await this.getMembersCollection();

    // Get all project memberships for this user
    const memberships = await members.find({ user_id: userId }).toArray();
    const projectIds = memberships.map(m => new ObjectId(m.project_id));

    if (projectIds.length === 0) {
      return [];
    }

    // Get projects
    const projectList = await projects.find({ _id: { $in: projectIds } }).toArray();

    // Create role map
    const roleMap = new Map<string, ProjectRole>();
    memberships.forEach(m => roleMap.set(m.project_id, m.role));

    // Get member counts
    const memberCounts = await members.aggregate([
      { $match: { project_id: { $in: projectIds.map(id => id.toString()) } } },
      { $group: { _id: '$project_id', count: { $sum: 1 } } }
    ]).toArray();

    const countMap = new Map<string, number>();
    memberCounts.forEach(mc => countMap.set(mc._id, mc.count));

    // Combine data
    return projectList.map(project => ({
      ...project,
      role: roleMap.get(project._id!.toString()) || 'viewer',
      member_count: countMap.get(project._id!.toString()) || 1,
    }));
  }

  /**
   * Update project
   */
  async updateProject(projectId: string, userId: string, data: UpdateProjectRequest): Promise<Project> {
    const projects = await this.getProjectsCollection();

    // Check permission
    const role = await this.getUserRole(projectId, userId);
    if (role !== 'owner' && role !== 'admin') {
      throw new Error('Only owner or admin can update project');
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (data.name) {
      if (data.name.trim().length < 2) {
        throw new Error('Project name must be at least 2 characters');
      }
      updates.name = data.name.trim();
      updates.slug = await this.ensureUniqueSlug(this.generateSlug(data.name), projectId);
    }

    if (data.description !== undefined) {
      updates.description = data.description.trim();
    }

    if (data.visibility) {
      updates.visibility = data.visibility;
    }

    if (data.settings) {
      // Merge with existing settings
      const project = await this.getProjectById(projectId);
      if (project) {
        updates.settings = {
          ...project.settings,
          ...data.settings,
        };
      }
    }

    await projects.updateOne(
      { _id: new ObjectId(projectId) },
      { $set: updates }
    );

    const updated = await this.getProjectById(projectId);
    if (!updated) {
      throw new Error('Project not found');
    }

    logger.info('Project', `Project updated: ${projectId}`);
    return updated;
  }

  /**
   * Delete project and all related data
   */
  async deleteProject(projectId: string, userId: string): Promise<void> {
    const projects = await this.getProjectsCollection();
    const members = await this.getMembersCollection();

    // Only owner can delete
    const role = await this.getUserRole(projectId, userId);
    if (role !== 'owner') {
      throw new Error('Only owner can delete project');
    }

    // Delete project
    await projects.deleteOne({ _id: new ObjectId(projectId) });

    // Delete all members
    await members.deleteMany({ project_id: projectId });

    // Delete related data (observations, sessions, summaries, prompts)
    const db = await mongoConnection.getDb();
    await Promise.all([
      db.collection('observations').deleteMany({ project_id: projectId }),
      db.collection('sessions').deleteMany({ project_id: projectId }),
      db.collection('summaries').deleteMany({ project_id: projectId }),
      db.collection('user_prompts').deleteMany({ project_id: projectId }),
    ]);

    logger.info('Project', `Project deleted: ${projectId}`);
  }

  /**
   * Get user's role in a project
   */
  async getUserRole(projectId: string, userId: string): Promise<ProjectRole | null> {
    const members = await this.getMembersCollection();
    const membership = await members.findOne({ project_id: projectId, user_id: userId });
    return membership?.role || null;
  }

  /**
   * Check if user can access project (for reading)
   */
  async canAccessProject(projectId: string, userId: string): Promise<boolean> {
    const project = await this.getProjectById(projectId);
    if (!project) return false;

    // Public projects are accessible to all
    if (project.visibility === 'public') return true;

    // Check membership
    const role = await this.getUserRole(projectId, userId);
    return role !== null;
  }

  /**
   * Check if user can write to project
   */
  async canWriteToProject(projectId: string, userId: string): Promise<boolean> {
    const role = await this.getUserRole(projectId, userId);
    return role === 'owner' || role === 'admin' || role === 'member';
  }

  /**
   * Get all members of a project
   */
  async getProjectMembers(projectId: string): Promise<ProjectMemberWithUser[]> {
    const members = await this.getMembersCollection();
    const users = await mongoConnection.getUsersCollection();

    const memberList = await members.find({ project_id: projectId }).toArray();
    const userIds = memberList.map(m => new ObjectId(m.user_id));

    const userList = await users.find({ _id: { $in: userIds } }).toArray();
    const userMap = new Map<string, string>();
    userList.forEach(u => userMap.set(u._id!.toString(), u.username));

    return memberList.map(m => ({
      ...m,
      username: userMap.get(m.user_id) || 'Unknown',
    }));
  }

  /**
   * Add member to project
   */
  async addMember(projectId: string, inviterId: string, targetUserId: string, role: ProjectRole = 'member'): Promise<ProjectMember> {
    const members = await this.getMembersCollection();
    const project = await this.getProjectById(projectId);

    if (!project) {
      throw new Error('Project not found');
    }

    // Check inviter permission
    const inviterRole = await this.getUserRole(projectId, inviterId);
    if (inviterRole !== 'owner' && inviterRole !== 'admin') {
      if (!project.settings.allow_member_invite || inviterRole !== 'member') {
        throw new Error('Not authorized to invite members');
      }
      // Members can only invite as member or viewer
      if (role === 'owner' || role === 'admin') {
        throw new Error('Cannot invite with higher role');
      }
    }

    // Cannot add as owner
    if (role === 'owner') {
      throw new Error('Cannot add member as owner');
    }

    // Check if already a member
    const existing = await members.findOne({ project_id: projectId, user_id: targetUserId });
    if (existing) {
      throw new Error('User is already a member');
    }

    const member: ProjectMember = {
      project_id: projectId,
      user_id: targetUserId,
      role,
      invited_by: inviterId,
      joined_at: new Date(),
    };

    const result = await members.insertOne(member);
    member._id = result.insertedId;

    logger.info('Project', `Member added to project ${projectId}: ${targetUserId} as ${role}`);

    return member;
  }

  /**
   * Update member role
   */
  async updateMemberRole(projectId: string, updaterId: string, targetUserId: string, newRole: ProjectRole): Promise<void> {
    const members = await this.getMembersCollection();

    // Check updater permission
    const updaterRole = await this.getUserRole(projectId, updaterId);
    if (updaterRole !== 'owner' && updaterRole !== 'admin') {
      throw new Error('Not authorized to update member roles');
    }

    // Cannot change owner
    const targetRole = await this.getUserRole(projectId, targetUserId);
    if (targetRole === 'owner') {
      throw new Error('Cannot change owner role');
    }

    // Cannot set as owner
    if (newRole === 'owner') {
      throw new Error('Cannot set member as owner');
    }

    // Admin cannot promote to admin
    if (updaterRole === 'admin' && newRole === 'admin') {
      throw new Error('Only owner can promote to admin');
    }

    await members.updateOne(
      { project_id: projectId, user_id: targetUserId },
      { $set: { role: newRole } }
    );

    logger.info('Project', `Member role updated in project ${projectId}: ${targetUserId} to ${newRole}`);
  }

  /**
   * Remove member from project
   */
  async removeMember(projectId: string, removerId: string, targetUserId: string): Promise<void> {
    const members = await this.getMembersCollection();

    // Check remover permission
    const removerRole = await this.getUserRole(projectId, removerId);

    // Can remove self (leave project)
    if (removerId === targetUserId) {
      const targetRole = await this.getUserRole(projectId, targetUserId);
      if (targetRole === 'owner') {
        throw new Error('Owner cannot leave project. Transfer ownership or delete project.');
      }
    } else {
      // Removing others requires permission
      if (removerRole !== 'owner' && removerRole !== 'admin') {
        throw new Error('Not authorized to remove members');
      }

      const targetRole = await this.getUserRole(projectId, targetUserId);
      if (targetRole === 'owner') {
        throw new Error('Cannot remove owner');
      }
      if (targetRole === 'admin' && removerRole !== 'owner') {
        throw new Error('Only owner can remove admins');
      }
    }

    await members.deleteOne({ project_id: projectId, user_id: targetUserId });

    logger.info('Project', `Member removed from project ${projectId}: ${targetUserId}`);
  }

  /**
   * Create indexes for collections
   */
  async createIndexes(): Promise<void> {
    const db = await mongoConnection.getDb();

    // Projects indexes
    const projects = db.collection('projects');
    await projects.createIndex({ slug: 1 }, { unique: true });
    await projects.createIndex({ owner_id: 1 });
    await projects.createIndex({ visibility: 1 });

    // Project members indexes
    const members = db.collection('project_members');
    await members.createIndex({ project_id: 1, user_id: 1 }, { unique: true });
    await members.createIndex({ user_id: 1 });

    // Observations indexes
    const observations = db.collection('observations');
    await observations.createIndex({ project_id: 1, created_at: -1 });
    await observations.createIndex({ project_id: 1, user_id: 1, created_at: -1 });
    await observations.createIndex({ session_id: 1 });

    // Sessions indexes
    const sessions = db.collection('sessions');
    await sessions.createIndex({ project_id: 1, started_at: -1 });
    await sessions.createIndex({ content_session_id: 1 }, { unique: true });

    // User prompts indexes
    const prompts = db.collection('user_prompts');
    await prompts.createIndex({ project_id: 1, created_at: -1 });
    await prompts.createIndex({ session_id: 1, prompt_number: 1 });

    // Summaries indexes
    const summaries = db.collection('summaries');
    await summaries.createIndex({ project_id: 1, created_at: -1 });
    await summaries.createIndex({ session_id: 1 });

    logger.info('Project', 'MongoDB indexes created');
  }
}

export const projectService = new ProjectService();

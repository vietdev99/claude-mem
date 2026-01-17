/**
 * ProjectRoutes - Project management endpoints
 * Handles project CRUD, members, and context
 */

import { Application, Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { projectService, contextService } from '../../../project/index.js';
import { jwtAuthMiddleware } from '../../../server/AuthMiddleware.js';
import { logger } from '../../../../utils/logger.js';
import { mongoConnection } from '../../../auth/MongoConnection.js';

export class ProjectRoutes extends BaseRouteHandler {
  setupRoutes(app: Application): void {
    // All project routes require authentication
    const auth = jwtAuthMiddleware;

    // Project CRUD
    app.post('/api/projects', auth, this.wrapHandler(this.handleCreateProject.bind(this)));
    app.get('/api/projects', auth, this.wrapHandler(this.handleGetProjects.bind(this)));
    app.get('/api/projects/:id', auth, this.wrapHandler(this.handleGetProject.bind(this)));
    app.put('/api/projects/:id', auth, this.wrapHandler(this.handleUpdateProject.bind(this)));
    app.delete('/api/projects/:id', auth, this.wrapHandler(this.handleDeleteProject.bind(this)));

    // Project members
    app.get('/api/projects/:id/members', auth, this.wrapHandler(this.handleGetMembers.bind(this)));
    app.post('/api/projects/:id/members', auth, this.wrapHandler(this.handleAddMember.bind(this)));
    app.put('/api/projects/:id/members/:userId', auth, this.wrapHandler(this.handleUpdateMemberRole.bind(this)));
    app.delete('/api/projects/:id/members/:userId', auth, this.wrapHandler(this.handleRemoveMember.bind(this)));

    // Context endpoints
    app.get('/api/projects/:id/observations', auth, this.wrapHandler(this.handleGetObservations.bind(this)));
    app.get('/api/projects/:id/prompts', auth, this.wrapHandler(this.handleGetPrompts.bind(this)));
    app.get('/api/projects/:id/summaries', auth, this.wrapHandler(this.handleGetSummaries.bind(this)));
    app.get('/api/projects/:id/context', auth, this.wrapHandler(this.handleGetContext.bind(this)));

    // Save context (from extension)
    app.post('/api/projects/:id/observations', auth, this.wrapHandler(this.handleSaveObservation.bind(this)));
    app.post('/api/projects/:id/prompts', auth, this.wrapHandler(this.handleSavePrompt.bind(this)));
    app.post('/api/projects/:id/summaries', auth, this.wrapHandler(this.handleSaveSummary.bind(this)));

    // Delete observation
    app.delete('/api/observations/:id', auth, this.wrapHandler(this.handleDeleteObservation.bind(this)));
  }

  // ============ Project CRUD ============

  private async handleCreateProject(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { name, description, visibility } = req.body;

    if (!name) {
      this.badRequest(res, 'Project name is required');
      return;
    }

    try {
      const project = await projectService.createProject(req.user.userId, {
        name,
        description,
        visibility,
      });

      res.status(201).json({
        id: project._id?.toString(),
        name: project.name,
        slug: project.slug,
        description: project.description,
        visibility: project.visibility,
        role: 'owner',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create project';
      this.badRequest(res, message);
    }
  }

  private async handleGetProjects(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projects = await projectService.getUserProjects(req.user.userId);

    res.json({
      projects: projects.map(p => ({
        id: p._id?.toString(),
        name: p.name,
        slug: p.slug,
        description: p.description,
        visibility: p.visibility,
        role: p.role,
        member_count: p.member_count,
        created_at: p.created_at,
      })),
    });
  }

  private async handleGetProject(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;

    // Check access
    const canAccess = await projectService.canAccessProject(projectId, req.user.userId);
    if (!canAccess) {
      this.notFound(res, 'Project not found');
      return;
    }

    const project = await projectService.getProjectById(projectId);
    if (!project) {
      this.notFound(res, 'Project not found');
      return;
    }

    const role = await projectService.getUserRole(projectId, req.user.userId);
    const members = await projectService.getProjectMembers(projectId);

    res.json({
      id: project._id?.toString(),
      name: project.name,
      slug: project.slug,
      description: project.description,
      visibility: project.visibility,
      settings: project.settings,
      role,
      member_count: members.length,
      created_at: project.created_at,
    });
  }

  private async handleUpdateProject(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;
    const { name, description, visibility, settings } = req.body;

    try {
      const project = await projectService.updateProject(projectId, req.user.userId, {
        name,
        description,
        visibility,
        settings,
      });

      res.json({
        id: project._id?.toString(),
        name: project.name,
        slug: project.slug,
        description: project.description,
        visibility: project.visibility,
        settings: project.settings,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update project';
      if (message.includes('Only')) {
        res.status(403).json({ error: message });
      } else {
        this.badRequest(res, message);
      }
    }
  }

  private async handleDeleteProject(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;

    try {
      await projectService.deleteProject(projectId, req.user.userId);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete project';
      if (message.includes('Only')) {
        res.status(403).json({ error: message });
      } else {
        this.badRequest(res, message);
      }
    }
  }

  // ============ Project Members ============

  private async handleGetMembers(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;

    const canAccess = await projectService.canAccessProject(projectId, req.user.userId);
    if (!canAccess) {
      this.notFound(res, 'Project not found');
      return;
    }

    const members = await projectService.getProjectMembers(projectId);

    res.json({
      members: members.map(m => ({
        id: m._id?.toString(),
        user_id: m.user_id,
        username: m.username,
        role: m.role,
        joined_at: m.joined_at,
      })),
    });
  }

  private async handleAddMember(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;
    const { username, role } = req.body;

    if (!username) {
      this.badRequest(res, 'Username is required');
      return;
    }

    try {
      // Find user by username
      const users = await mongoConnection.getUsersCollection();
      const targetUser = await users.findOne({ username });

      if (!targetUser) {
        this.notFound(res, 'User not found');
        return;
      }

      const member = await projectService.addMember(
        projectId,
        req.user.userId,
        targetUser._id!.toString(),
        role || 'member'
      );

      res.status(201).json({
        id: member._id?.toString(),
        user_id: member.user_id,
        username,
        role: member.role,
        joined_at: member.joined_at,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add member';
      if (message.includes('Not authorized') || message.includes('Cannot')) {
        res.status(403).json({ error: message });
      } else {
        this.badRequest(res, message);
      }
    }
  }

  private async handleUpdateMemberRole(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id: projectId, userId: targetUserId } = req.params;
    const { role } = req.body;

    if (!role) {
      this.badRequest(res, 'Role is required');
      return;
    }

    try {
      await projectService.updateMemberRole(projectId, req.user.userId, targetUserId, role);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update member';
      if (message.includes('Not authorized') || message.includes('Cannot')) {
        res.status(403).json({ error: message });
      } else {
        this.badRequest(res, message);
      }
    }
  }

  private async handleRemoveMember(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id: projectId, userId: targetUserId } = req.params;

    try {
      await projectService.removeMember(projectId, req.user.userId, targetUserId);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove member';
      if (message.includes('Not authorized') || message.includes('Cannot')) {
        res.status(403).json({ error: message });
      } else {
        this.badRequest(res, message);
      }
    }
  }

  // ============ Context Endpoints ============

  private async handleGetObservations(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;
    const { limit, offset, my_only } = req.query;
    const limitNum = limit ? parseInt(limit as string) : 50;
    const offsetNum = offset ? parseInt(offset as string) : 0;

    const canAccess = await projectService.canAccessProject(projectId, req.user.userId);
    if (!canAccess) {
      this.notFound(res, 'Project not found');
      return;
    }

    const result = await contextService.getObservations(projectId, {
      userId: my_only === 'true' ? req.user.userId : undefined,
      limit: limitNum,
      offset: offsetNum,
    });

    // Transform to frontend-compatible format with created_at_epoch
    const items = result.observations.map(obs => ({
      id: obs._id?.toString(),
      project: projectId,
      session_id: obs.session_id,
      prompt_number: obs.prompt_number,
      tool_name: obs.tool_name,
      tool_input: obs.tool_input,
      tool_response: obs.tool_response,
      observation_type: obs.observation_type,
      observation_concept: obs.observation_concept,
      narrative: obs.narrative,
      keywords: obs.keywords,
      cwd: obs.cwd,
      created_at: obs.created_at,
      created_at_epoch: obs.created_at ? new Date(obs.created_at).getTime() : Date.now(),
    }));

    res.json({
      items,
      hasMore: offsetNum + limitNum < result.total,
    });
  }

  private async handleGetPrompts(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;
    const { limit, offset, my_only } = req.query;
    const limitNum = limit ? parseInt(limit as string) : 50;
    const offsetNum = offset ? parseInt(offset as string) : 0;

    const canAccess = await projectService.canAccessProject(projectId, req.user.userId);
    if (!canAccess) {
      this.notFound(res, 'Project not found');
      return;
    }

    const result = await contextService.getPrompts(projectId, {
      userId: my_only === 'true' ? req.user.userId : undefined,
      limit: limitNum,
      offset: offsetNum,
    });

    // Transform to frontend-compatible format with created_at_epoch
    const items = result.prompts.map(p => ({
      id: p._id?.toString(),
      project: projectId,
      session_id: p.session_id,
      prompt_number: p.prompt_number,
      prompt_text: p.prompt_text,
      created_at: p.created_at,
      created_at_epoch: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
    }));

    res.json({
      items,
      hasMore: offsetNum + limitNum < result.total,
    });
  }

  private async handleGetSummaries(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;
    const { limit, offset, my_only } = req.query;
    const limitNum = limit ? parseInt(limit as string) : 50;
    const offsetNum = offset ? parseInt(offset as string) : 0;

    const canAccess = await projectService.canAccessProject(projectId, req.user.userId);
    if (!canAccess) {
      this.notFound(res, 'Project not found');
      return;
    }

    const result = await contextService.getSummaries(projectId, {
      userId: my_only === 'true' ? req.user.userId : undefined,
      limit: limitNum,
      offset: offsetNum,
    });

    // Transform to frontend-compatible format with created_at_epoch
    const items = result.summaries.map(s => ({
      id: s._id?.toString(),
      project: projectId,
      session_id: s.session_id,
      content: s.summary_text,
      observation_ids: s.observation_ids,
      created_at: s.created_at,
      created_at_epoch: s.created_at ? new Date(s.created_at).getTime() : Date.now(),
    }));

    res.json({
      items,
      hasMore: offsetNum + limitNum < result.total,
    });
  }

  private async handleGetContext(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;
    const { limit, my_only } = req.query;

    const canAccess = await projectService.canAccessProject(projectId, req.user.userId);
    if (!canAccess) {
      this.notFound(res, 'Project not found');
      return;
    }

    const context = await contextService.getContextForInjection({
      project_id: projectId,
      user_id: my_only === 'true' ? req.user.userId : undefined,
      limit: limit ? parseInt(limit as string) : 50,
    });

    res.json(context);
  }

  // ============ Save Context ============

  private async handleSaveObservation(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;

    const canWrite = await projectService.canWriteToProject(projectId, req.user.userId);
    if (!canWrite) {
      res.status(403).json({ error: 'Not authorized to write to this project' });
      return;
    }

    const {
      session_id,
      prompt_number,
      tool_name,
      tool_input,
      tool_response,
      observation_type,
      observation_concept,
      narrative,
      keywords,
      cwd,
    } = req.body;

    if (!session_id || !tool_name) {
      this.badRequest(res, 'session_id and tool_name are required');
      return;
    }

    const observation = await contextService.saveObservation(
      projectId,
      req.user.userId,
      session_id,
      {
        prompt_number: prompt_number || 1,
        tool_name,
        tool_input: tool_input || '',
        tool_response: tool_response || '',
        observation_type,
        observation_concept,
        narrative,
        keywords,
        cwd,
      }
    );

    res.status(201).json({
      id: observation._id?.toString(),
      created_at: observation.created_at,
    });
  }

  private async handleSavePrompt(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;

    const canWrite = await projectService.canWriteToProject(projectId, req.user.userId);
    if (!canWrite) {
      res.status(403).json({ error: 'Not authorized to write to this project' });
      return;
    }

    const { session_id, prompt_number, prompt_text } = req.body;

    if (!session_id || !prompt_text) {
      this.badRequest(res, 'session_id and prompt_text are required');
      return;
    }

    const prompt = await contextService.saveUserPrompt(
      projectId,
      req.user.userId,
      session_id,
      prompt_number || 1,
      prompt_text
    );

    res.status(201).json({
      id: prompt._id?.toString(),
      created_at: prompt.created_at,
    });
  }

  private async handleSaveSummary(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const projectId = req.params.id;

    const canWrite = await projectService.canWriteToProject(projectId, req.user.userId);
    if (!canWrite) {
      res.status(403).json({ error: 'Not authorized to write to this project' });
      return;
    }

    const { session_id, summary_text, observation_ids } = req.body;

    if (!session_id || !summary_text) {
      this.badRequest(res, 'session_id and summary_text are required');
      return;
    }

    const summary = await contextService.saveSummary(
      projectId,
      req.user.userId,
      session_id,
      summary_text,
      observation_ids || []
    );

    res.status(201).json({
      id: summary._id?.toString(),
      created_at: summary.created_at,
    });
  }

  private async handleDeleteObservation(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const observationId = req.params.id;

    try {
      await contextService.deleteObservation(observationId, req.user.userId);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete observation';
      if (message.includes('Only')) {
        res.status(403).json({ error: message });
      } else if (message.includes('not found')) {
        this.notFound(res, message);
      } else {
        this.badRequest(res, message);
      }
    }
  }
}

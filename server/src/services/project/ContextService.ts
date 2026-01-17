/**
 * Context Service
 * Handles observations, sessions, summaries, and prompts
 */

import { ObjectId, Collection } from 'mongodb';
import { mongoConnection } from '../auth/MongoConnection.js';
import { projectService } from './ProjectService.js';
import { logger } from '../../utils/logger.js';
import {
  Observation,
  Session,
  UserPrompt,
  Summary,
  ContextQuery,
} from './types.js';

class ContextService {
  private async getObservationsCollection(): Promise<Collection<Observation>> {
    const db = await mongoConnection.getDb();
    return db.collection<Observation>('observations');
  }

  private async getSessionsCollection(): Promise<Collection<Session>> {
    const db = await mongoConnection.getDb();
    return db.collection<Session>('sessions');
  }

  private async getPromptsCollection(): Promise<Collection<UserPrompt>> {
    const db = await mongoConnection.getDb();
    return db.collection<UserPrompt>('user_prompts');
  }

  private async getSummariesCollection(): Promise<Collection<Summary>> {
    const db = await mongoConnection.getDb();
    return db.collection<Summary>('summaries');
  }

  /**
   * Get or create session for a content_session_id
   */
  async getOrCreateSession(projectId: string, userId: string, contentSessionId: string): Promise<Session> {
    const sessions = await this.getSessionsCollection();

    let session = await sessions.findOne({ content_session_id: contentSessionId });

    if (!session) {
      session = {
        project_id: projectId,
        user_id: userId,
        content_session_id: contentSessionId,
        started_at: new Date(),
        prompt_count: 0,
      };
      const result = await sessions.insertOne(session);
      session._id = result.insertedId;
      logger.debug('Context', `Session created: ${contentSessionId}`);
    }

    return session;
  }

  /**
   * Save an observation
   */
  async saveObservation(
    projectId: string,
    userId: string,
    sessionId: string,
    data: {
      prompt_number: number;
      tool_name: string;
      tool_input: string;
      tool_response: string;
      observation_type?: string;
      observation_concept?: string;
      narrative?: string;
      keywords?: string;
      cwd?: string;
    }
  ): Promise<Observation> {
    const observations = await this.getObservationsCollection();

    const observation: Observation = {
      project_id: projectId,
      user_id: userId,
      session_id: sessionId,
      prompt_number: data.prompt_number,
      tool_name: data.tool_name,
      tool_input: data.tool_input,
      tool_response: data.tool_response,
      observation_type: data.observation_type,
      observation_concept: data.observation_concept,
      narrative: data.narrative,
      keywords: data.keywords,
      cwd: data.cwd,
      created_at: new Date(),
    };

    const result = await observations.insertOne(observation);
    observation._id = result.insertedId;

    return observation;
  }

  /**
   * Save a user prompt
   */
  async saveUserPrompt(
    projectId: string,
    userId: string,
    sessionId: string,
    promptNumber: number,
    promptText: string
  ): Promise<UserPrompt> {
    const prompts = await this.getPromptsCollection();

    const prompt: UserPrompt = {
      project_id: projectId,
      user_id: userId,
      session_id: sessionId,
      prompt_number: promptNumber,
      prompt_text: promptText,
      created_at: new Date(),
    };

    const result = await prompts.insertOne(prompt);
    prompt._id = result.insertedId;

    // Update session prompt count
    const sessions = await this.getSessionsCollection();
    await sessions.updateOne(
      { _id: new ObjectId(sessionId) },
      { $max: { prompt_count: promptNumber } }
    );

    return prompt;
  }

  /**
   * Save a summary
   */
  async saveSummary(
    projectId: string,
    userId: string,
    sessionId: string,
    summaryText: string,
    observationIds: string[]
  ): Promise<Summary> {
    const summaries = await this.getSummariesCollection();

    const summary: Summary = {
      project_id: projectId,
      user_id: userId,
      session_id: sessionId,
      summary_text: summaryText,
      observation_ids: observationIds,
      created_at: new Date(),
    };

    const result = await summaries.insertOne(summary);
    summary._id = result.insertedId;

    return summary;
  }

  /**
   * Get observations for a project
   */
  async getObservations(
    projectId: string,
    options: {
      userId?: string;
      limit?: number;
      offset?: number;
      sessionId?: string;
    } = {}
  ): Promise<{ observations: Observation[]; total: number }> {
    const observations = await this.getObservationsCollection();

    const query: Record<string, unknown> = { project_id: projectId };
    if (options.userId) {
      query.user_id = options.userId;
    }
    if (options.sessionId) {
      query.session_id = options.sessionId;
    }

    const [data, total] = await Promise.all([
      observations
        .find(query)
        .sort({ created_at: -1 })
        .skip(options.offset || 0)
        .limit(options.limit || 50)
        .toArray(),
      observations.countDocuments(query),
    ]);

    return { observations: data, total };
  }

  /**
   * Get user prompts for a project
   */
  async getPrompts(
    projectId: string,
    options: {
      userId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ prompts: UserPrompt[]; total: number }> {
    const prompts = await this.getPromptsCollection();

    const query: Record<string, unknown> = { project_id: projectId };
    if (options.userId) {
      query.user_id = options.userId;
    }

    const [data, total] = await Promise.all([
      prompts
        .find(query)
        .sort({ created_at: -1 })
        .skip(options.offset || 0)
        .limit(options.limit || 50)
        .toArray(),
      prompts.countDocuments(query),
    ]);

    return { prompts: data, total };
  }

  /**
   * Get summaries for a project
   */
  async getSummaries(
    projectId: string,
    options: {
      userId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ summaries: Summary[]; total: number }> {
    const summaries = await this.getSummariesCollection();

    const query: Record<string, unknown> = { project_id: projectId };
    if (options.userId) {
      query.user_id = options.userId;
    }

    const [data, total] = await Promise.all([
      summaries
        .find(query)
        .sort({ created_at: -1 })
        .skip(options.offset || 0)
        .limit(options.limit || 50)
        .toArray(),
      summaries.countDocuments(query),
    ]);

    return { summaries: data, total };
  }

  /**
   * Get context for Claude injection
   * Returns recent observations, summaries, and prompts
   */
  async getContextForInjection(query: ContextQuery): Promise<{
    observations: Observation[];
    summaries: Summary[];
    prompts: UserPrompt[];
  }> {
    const limit = query.limit || 50;

    const baseQuery: Record<string, unknown> = { project_id: query.project_id };
    if (query.user_id) {
      baseQuery.user_id = query.user_id;
    }

    const results = await Promise.all([
      query.include_observations !== false
        ? (await this.getObservationsCollection())
            .find(baseQuery)
            .sort({ created_at: -1 })
            .limit(limit)
            .toArray()
        : [],
      query.include_summaries !== false
        ? (await this.getSummariesCollection())
            .find(baseQuery)
            .sort({ created_at: -1 })
            .limit(10)
            .toArray()
        : [],
      query.include_prompts !== false
        ? (await this.getPromptsCollection())
            .find(baseQuery)
            .sort({ created_at: -1 })
            .limit(20)
            .toArray()
        : [],
    ]);

    return {
      observations: results[0],
      summaries: results[1],
      prompts: results[2],
    };
  }

  /**
   * Delete an observation (owner/admin only)
   */
  async deleteObservation(observationId: string, userId: string): Promise<void> {
    const observations = await this.getObservationsCollection();
    const observation = await observations.findOne({ _id: new ObjectId(observationId) });

    if (!observation) {
      throw new Error('Observation not found');
    }

    // Check permission
    const role = await projectService.getUserRole(observation.project_id, userId);
    if (role !== 'owner' && role !== 'admin') {
      throw new Error('Only owner or admin can delete observations');
    }

    await observations.deleteOne({ _id: new ObjectId(observationId) });
    logger.info('Context', `Observation deleted: ${observationId}`);
  }

  /**
   * Get sessions for a project
   */
  async getSessions(
    projectId: string,
    options: {
      userId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ sessions: Session[]; total: number }> {
    const sessions = await this.getSessionsCollection();

    const query: Record<string, unknown> = { project_id: projectId };
    if (options.userId) {
      query.user_id = options.userId;
    }

    const [data, total] = await Promise.all([
      sessions
        .find(query)
        .sort({ started_at: -1 })
        .skip(options.offset || 0)
        .limit(options.limit || 50)
        .toArray(),
      sessions.countDocuments(query),
    ]);

    return { sessions: data, total };
  }

  /**
   * End a session
   */
  async endSession(sessionId: string): Promise<void> {
    const sessions = await this.getSessionsCollection();
    await sessions.updateOne(
      { _id: new ObjectId(sessionId) },
      { $set: { ended_at: new Date() } }
    );
  }
}

export const contextService = new ContextService();

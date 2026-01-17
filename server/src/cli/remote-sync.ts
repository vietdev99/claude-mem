/**
 * Remote Sync Module
 *
 * Handles syncing observations, prompts, and summaries to remote server (MongoDB).
 * Reads configuration from ~/.claude-mem/credentials.json (written by VSCode extension).
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

const CREDENTIALS_PATH = path.join(homedir(), '.claude-mem', 'credentials.json');

export interface RemoteConfig {
  serverUrl: string;
  accessToken: string;
  projectId: string;
}

interface CredentialsFile {
  user?: { id: string; username: string; role: string };
  tokens?: { accessToken: string; refreshToken: string };
  currentProject?: { id: string; name: string };
  serverUrl?: string;
}

/**
 * Get remote sync configuration from credentials file
 * Returns null if not configured or missing required fields
 */
export function getRemoteConfig(): RemoteConfig | null {
  try {
    if (!existsSync(CREDENTIALS_PATH)) {
      return null;
    }

    const content = readFileSync(CREDENTIALS_PATH, 'utf-8');
    const credentials: CredentialsFile = JSON.parse(content);

    // Validate required fields
    if (!credentials.serverUrl || !credentials.tokens?.accessToken || !credentials.currentProject?.id) {
      return null;
    }

    return {
      serverUrl: credentials.serverUrl,
      accessToken: credentials.tokens.accessToken,
      projectId: credentials.currentProject.id,
    };
  } catch (error) {
    logger.debug('REMOTE', 'Failed to read credentials', { error: (error as Error).message });
    return null;
  }
}

/**
 * Sync observation to remote server
 */
export async function syncObservation(
  config: RemoteConfig,
  data: {
    session_id: string;
    tool_name: string;
    tool_input: string;
    tool_response: string;
    cwd: string;
    prompt_number?: number;
  }
): Promise<void> {
  const url = `${config.serverUrl}/api/projects/${config.projectId}/observations`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify({
      session_id: data.session_id,
      prompt_number: data.prompt_number || 1,
      tool_name: data.tool_name,
      tool_input: data.tool_input,
      tool_response: data.tool_response,
      cwd: data.cwd,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Remote sync observation failed: ${response.status} - ${errorText}`);
  }

  logger.debug('REMOTE', 'Observation synced to remote', { projectId: config.projectId });
}

/**
 * Sync user prompt to remote server
 */
export async function syncPrompt(
  config: RemoteConfig,
  data: {
    session_id: string;
    prompt_number: number;
    prompt_text: string;
  }
): Promise<void> {
  const url = `${config.serverUrl}/api/projects/${config.projectId}/prompts`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify({
      session_id: data.session_id,
      prompt_number: data.prompt_number,
      prompt_text: data.prompt_text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Remote sync prompt failed: ${response.status} - ${errorText}`);
  }

  logger.debug('REMOTE', 'Prompt synced to remote', { projectId: config.projectId });
}

/**
 * Sync summary to remote server
 */
export async function syncSummary(
  config: RemoteConfig,
  data: {
    session_id: string;
    summary_text: string;
  }
): Promise<void> {
  const url = `${config.serverUrl}/api/projects/${config.projectId}/summaries`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify({
      session_id: data.session_id,
      summary_text: data.summary_text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Remote sync summary failed: ${response.status} - ${errorText}`);
  }

  logger.debug('REMOTE', 'Summary synced to remote', { projectId: config.projectId });
}

import * as YAML from 'yaml';
import {
  ParsedWorkflow,
  ParsedAction,
  WorkflowFile,
  ActionFile
} from '../types';
import { diskFiles, FileSource } from '../utils/files';

/**
 * Parse a GitHub workflow YAML file
 */
export function parseWorkflow(
  filePath: string,
  files: FileSource = diskFiles
): ParsedWorkflow {
  const content = files.read(filePath);
  if (content === undefined) {
    throw new Error(`Workflow file not found: ${filePath}`);
  }

  try {
    const parsed = YAML.parse(content) as WorkflowFile;

    if (!parsed.name) {
      throw new Error('Workflow must have a name');
    }

    if (!parsed.jobs || Object.keys(parsed.jobs).length === 0) {
      throw new Error('Workflow must have at least one job');
    }

    return {
      type: 'workflow',
      file: parsed,
      path: filePath
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse workflow: ${error.message}`, {
        cause: error
      });
    }
    throw error;
  }
}

/**
 * Parse a GitHub action YAML file
 */
export function parseAction(
  filePath: string,
  files: FileSource = diskFiles
): ParsedAction {
  const content = files.read(filePath);
  if (content === undefined) {
    throw new Error(`Action file not found: ${filePath}`);
  }

  try {
    const parsed = YAML.parse(content) as ActionFile;

    if (!parsed.name) {
      throw new Error('Action must have a name');
    }

    if (!parsed.description) {
      throw new Error('Action must have a description');
    }

    if (!parsed.runs) {
      throw new Error('Action must have a runs section');
    }

    return {
      type: 'action',
      file: parsed,
      path: filePath
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse action: ${error.message}`, {
        cause: error
      });
    }
    throw error;
  }
}

/**
 * Auto-detect and parse either workflow or action file
 */
export function parseFile(
  filePath: string,
  files: FileSource = diskFiles
): ParsedWorkflow | ParsedAction {
  const content = files.read(filePath);
  if (content === undefined) {
    throw new Error(`File not found: ${filePath}`);
  }
  const parsed = YAML.parse(content);

  // Detect if it's a workflow or action based on structure
  if (parsed.jobs) {
    return parseWorkflow(filePath, files);
  } else if (parsed.runs) {
    return parseAction(filePath, files);
  } else {
    throw new Error(
      'Unable to determine file type. Must be either a workflow (with jobs) or action (with runs)'
    );
  }
}

import { parseFile } from './parser/workflow-parser';
import {
  mergeValidationResults,
  validateAction,
  validateWorkflow
} from './parser/validator';
import {
  ContractRecurse,
  validatePipelineContract
} from './parser/pipeline-contract-validator';
import { checkFileAdvisories, FailOn } from './advisories';
import type { AdvisoryReport, AdvisoryTarget } from './advisories';
import type { ReportEntry } from './report';
import type { PipelineContractSpec, ValidationResult } from './types';
import type { FileSource } from './utils/files';

/**
 * Looks up known security advisories for remote actions (network). The
 * CLI uses AdvisoryChecker; a library caller can pass its own client.
 */
export interface AdvisorySource {
  check(targets: AdvisoryTarget[]): Promise<AdvisoryReport>;
}

export interface ValidateFileOptions {
  files: FileSource;
  /** Reads the contract, when there is one; a throw fails that file. */
  contract?: () => PipelineContractSpec;
  recurse?: ContractRecurse;
  offline?: boolean;
  /** Without one, advisories aren't checked. */
  advisories?: AdvisorySource;
  /** Called as each stage starts (the CLI narrates them in text mode). */
  onStage?: (stage: 'workflow' | 'action' | 'contract', file: string) => void;
}

/**
 * What `secureci validate` checks for one workflow or action file: its
 * structure, expressions, injection, permissions and triggers, then the
 * contract (workflows only), then advisories for its `uses:` references.
 */
export async function validateFile(
  file: string,
  options: ValidateFileOptions
): Promise<{ result: ValidationResult; advisories?: AdvisoryReport }> {
  const { files } = options;
  const parsed = parseFile(file, files);
  let result: ValidationResult;

  if (parsed.type === 'workflow') {
    result = validateWorkflow(file, files);
    options.onStage?.('workflow', file);
  } else {
    result = validateAction(file, files);
    options.onStage?.('action', file);
  }

  let failOn: FailOn | undefined;
  if (options.contract) {
    options.onStage?.('contract', file);
    if (parsed.type !== 'workflow') {
      result = {
        valid: false,
        errors: [
          ...result.errors,
          {
            path: 'root',
            message:
              'Pipeline contracts validate job/step sequences and only apply to workflow files, not actions',
            severity: 'error' as const
          }
        ]
      };
    } else {
      const spec = options.contract();
      failOn = spec.advisories?.failOn;
      const contractResult = await validatePipelineContract(parsed, spec, {
        recurse: options.recurse,
        offline: options.offline,
        files
      });
      result = mergeValidationResults(result, contractResult);
    }
  }

  if (!options.advisories) return { result };
  // Known security advisories for the file's own uses: references.
  const { errors, report } = await checkFileAdvisories(
    parsed,
    options.advisories,
    failOn,
    files
  );
  return {
    result: {
      valid: result.valid && errors.every((e) => e.severity !== 'error'),
      errors: [...result.errors, ...errors]
    },
    advisories: report
  };
}

/** A file that couldn't be validated, as a report entry. */
export function failedEntry(file: string, error: unknown): ReportEntry {
  return {
    file,
    result: {
      valid: false,
      errors: [
        {
          path: 'root',
          message: error instanceof Error ? error.message : 'Unknown error',
          severity: 'error'
        }
      ]
    }
  };
}

/**
 * validateFile for each file, in order. A file that can't be validated
 * (missing, not YAML, a contract that can't be read) is an entry with a
 * `root` error, as in `secureci validate`.
 */
export async function validateFiles(
  paths: string[],
  options: ValidateFileOptions
): Promise<{ entries: ReportEntry[]; advisories: AdvisoryReport[] }> {
  const entries: ReportEntry[] = [];
  const advisories: AdvisoryReport[] = [];
  for (const file of paths) {
    try {
      const checked = await validateFile(file, options);
      if (checked.advisories) advisories.push(checked.advisories);
      entries.push({ file, result: checked.result });
    } catch (error) {
      entries.push(failedEntry(file, error));
    }
  }
  return { entries, advisories };
}

import { validateWorkflow, validateAction } from './validator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Validator', () => {
  const fixturesDir = path.join(__dirname, '../../test/fixtures');

  describe('validateWorkflow', () => {
    it('should validate a correct workflow', () => {
      const workflowPath = path.join(fixturesDir, 'simple-workflow.yml');
      const result = validateWorkflow(workflowPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const workflowPath = path.join(fixturesDir, 'invalid-workflow.yml');
      const result = validateWorkflow(workflowPath);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('reports invalid if: expressions with their location', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureci-if-'));
      const file = path.join(dir, 'wf.yml');
      fs.writeFileSync(
        file,
        [
          'name: If',
          'on: push',
          'jobs:',
          '  a:',
          '    runs-on: ubuntu-latest',
          "    if: matrix.os == 'linux'",
          '    steps:',
          '      - run: echo ok',
          '        if: ${{ success() }}',
          '      - run: echo bad',
          '        if: github.ref == ',
          '      - run: echo fn',
          '        if: bogus()'
        ].join('\n')
      );
      try {
        const result = validateWorkflow(file);
        expect(result.valid).toBe(false);
        expect(result.errors.map((e) => [e.path, e.message])).toEqual([
          [
            'jobs.a.if',
            expect.stringContaining("Unrecognized named-value: 'matrix'")
          ],
          ['jobs.a.steps[1].if', expect.any(String)],
          [
            'jobs.a.steps[2].if',
            expect.stringContaining("Unrecognized function: 'bogus'")
          ]
        ]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    describe('dangerous triggers (#46)', () => {
      function validate(lines: string[]) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureci-trig-'));
        const file = path.join(dir, 'wf.yml');
        fs.writeFileSync(file, lines.join('\n'));
        try {
          return validateWorkflow(file);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }

      it('fails a pull_request_target workflow that runs the PR head', () => {
        const result = validate([
          'name: PR',
          'on: pull_request_target',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '        with:',
          '          ref: ${{ github.event.pull_request.head.sha }}',
          '      - run: npm test'
        ]);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
          expect.objectContaining({
            path: 'jobs.build.steps[0]',
            severity: 'error',
            rule: 'secureci/dangerous-trigger'
          })
        ]);
      });

      it('passes with a warning when the trigger is used safely', () => {
        const result = validate([
          'name: PR',
          'on:',
          '  pull_request_target:',
          '    types: [opened]',
          'jobs:',
          '  label:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '      - run: echo labelling'
        ]);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([
          expect.objectContaining({
            path: 'on.pull_request_target',
            severity: 'warning'
          })
        ]);
      });
    });

    it('should validate job structure', () => {
      const workflowPath = path.join(fixturesDir, 'simple-workflow.yml');
      const result = validateWorkflow(workflowPath);

      expect(result.valid).toBe(true);
    });
  });

  describe('validateAction', () => {
    it('should validate a correct action', () => {
      const actionPath = path.join(fixturesDir, 'simple-action.yml');
      const result = validateAction(actionPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const actionPath = path.join(fixturesDir, 'invalid-action.yml');
      const result = validateAction(actionPath);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate composite action steps', () => {
      const actionPath = path.join(fixturesDir, 'simple-action.yml');
      const result = validateAction(actionPath);

      expect(result.valid).toBe(true);
    });
  });
});

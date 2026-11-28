import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { diskFiles, memoryFiles } from './files';

describe('memoryFiles', () => {
  const files = memoryFiles({
    '.github/workflows/ci.yml': 'name: CI',
    './.github/actions/build/action.yml': 'name: Build'
  });

  it('reads files by repository-relative path, however they are spelled', () => {
    expect(files.read('.github/workflows/ci.yml')).toBe('name: CI');
    expect(files.read('./.github/workflows/ci.yml')).toBe('name: CI');
    expect(files.read('/.github/workflows/ci.yml')).toBe('name: CI');
    expect(files.read('.github\\workflows\\ci.yml')).toBe('name: CI');
    expect(files.read('.github/actions/build/action.yml')).toBe('name: Build');
  });

  it('has only the files it was given', () => {
    expect(files.read('.github/workflows/other.yml')).toBeUndefined();
    expect(files.isFile('.github/workflows/ci.yml')).toBe(true);
    expect(files.isFile('.github/workflows')).toBe(false);
  });

  it('resolves `./` references against the repository root', () => {
    const root = files.root('.github/workflows/ci.yml');
    expect(files.resolve(root, './.github/actions/build')).toBe(
      '.github/actions/build'
    );
    expect(
      files.resolve(
        files.resolve(root, './.github/actions/build'),
        'action.yml'
      )
    ).toBe('.github/actions/build/action.yml');
    expect(files.relative(root, '.github/workflows/ci.yml')).toBe(
      '.github/workflows/ci.yml'
    );
  });

  it('never reaches outside the repository', () => {
    const root = files.root('.github/workflows/ci.yml');
    const escaped = files.resolve(root, '../../etc/passwd');
    expect(files.isFile(escaped)).toBe(false);
    expect(files.read(escaped)).toBeUndefined();
    expect(files.read('../.github/workflows/ci.yml')).toBeUndefined();
  });
});

describe('diskFiles', () => {
  it('reads files from disk and resolves against the repository root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureci-files-'));
    try {
      const workflows = path.join(dir, '.github', 'workflows');
      fs.mkdirSync(workflows, { recursive: true });
      const file = path.join(workflows, 'ci.yml');
      fs.writeFileSync(file, 'name: CI');
      expect(diskFiles.read(file)).toBe('name: CI');
      expect(diskFiles.read(path.join(dir, 'missing.yml'))).toBeUndefined();
      expect(diskFiles.isFile(file)).toBe(true);
      expect(diskFiles.isFile(workflows)).toBe(false);
      expect(diskFiles.root(file)).toBe(dir);
      expect(diskFiles.resolve(dir, './x', 'action.yml')).toBe(
        path.join(dir, 'x', 'action.yml')
      );
      expect(diskFiles.relative(dir, file)).toBe(
        path.join('.github', 'workflows', 'ci.yml')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

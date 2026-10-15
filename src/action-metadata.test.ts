import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

// The root action.yml is what GitHub Marketplace lists. Marketplace names must
// be unique: "Secure CI" (slug secure-ci) belongs to another publisher and
// "SecureCI" collides with an unrelated GitHub organization, so the listing
// uses a distinct name ("SecureCI GHA", slug secureci-gha).
describe('action.yml', () => {
  const action = YAML.parse(
    fs.readFileSync(path.join(__dirname, '..', 'action.yml'), 'utf8')
  );

  it('uses the Marketplace listing name', () => {
    expect(action.name).toBe('SecureCI GHA');
  });
});

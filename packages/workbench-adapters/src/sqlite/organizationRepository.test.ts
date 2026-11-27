import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openOrganizationRepository } from './organizationRepository.ts';

const team = { name: '招聘', description: '人才团队' };
const organization = { rootNodeId: 'lead', nodes: [{ id: 'lead', name: '负责人', type: 'role' as const, responsibility: '', assignee: null, parentIds: [], reviewRules: [], prompt: '', tools: [], tokenLimit: null, models: [] }] };

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE workbench_teams (id TEXT PRIMARY KEY, name TEXT, description TEXT, updated_at TEXT, updated_by TEXT);
    INSERT INTO workbench_teams(id,name,description) VALUES ('team-A','原名','');`);
  return { db, repository: openOrganizationRepository(db, 'signed-in-admin') };
}

test('a save publishes the team edits and an immutable organization revision together', async () => {
  const { db, repository } = fixture();
  try {
    assert.equal((await repository.load('team-A'))?.revision, 0);
    assert.equal(await repository.load('unknown'), null);
    assert.deepEqual(await repository.save('team-A', 0, { team, organization }), { revision: 1 });
    const second = { team: { ...team, name: '人才发展' }, organization };
    assert.deepEqual(await repository.save('team-A', 1, second), { revision: 2 });
    assert.deepEqual(await repository.load('team-A'), { revision: 2, ...second });
    assert.deepEqual(await repository.atRevision('team-A', 1), { revision: 1, team, organization });
    await assert.rejects(repository.save('team-A', 1, { team, organization }), { name: 'RevisionConflictError' });
    assert.deepEqual(await repository.load('team-A'), { revision: 2, ...second });
  } finally { db.close(); }
});

test('if the team update fails, the new revision is not visible', async () => {
  const { db, repository } = fixture();
  try {
    db.exec("CREATE TRIGGER fail_team BEFORE UPDATE ON workbench_teams BEGIN SELECT RAISE(ABORT,'failed to save team'); END");
    await assert.rejects(repository.save('team-A', 0, { team, organization }));
    assert.equal((await repository.load('team-A'))?.revision, 0);
    assert.equal(await repository.atRevision('team-A', 1), null);
  } finally { db.close(); }
});

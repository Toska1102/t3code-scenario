import type { DatabaseSync } from 'node:sqlite';
import { RevisionConflictError, type OrganizationRepository, type StoredOrganization } from '../../../workbench-core/src/teams/organization/SaveOrganization.ts';

type TeamRow = { name: string; description: string | null };
type SnapshotRow = { revision: number; snapshot: string };

function decode(row: SnapshotRow): StoredOrganization {
  return { ...JSON.parse(row.snapshot), revision: row.revision };
}

export function openOrganizationRepository(db: DatabaseSync, actor: string) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_organization_revisions (
    team_id TEXT NOT NULL REFERENCES workbench_teams(id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    snapshot TEXT NOT NULL,
    saved_by TEXT NOT NULL,
    PRIMARY KEY(team_id, revision)
  ) WITHOUT ROWID`);
  const teamById = db.prepare('SELECT name, description FROM workbench_teams WHERE id = ?');
  const latest = db.prepare('SELECT revision, snapshot FROM workbench_organization_revisions WHERE team_id = ? ORDER BY revision DESC LIMIT 1');
  const byRevision = db.prepare('SELECT revision, snapshot FROM workbench_organization_revisions WHERE team_id = ? AND revision = ?');
  const insert = db.prepare('INSERT INTO workbench_organization_revisions(team_id,revision,snapshot,saved_by) VALUES (?,?,?,?)');
  const update = db.prepare('UPDATE workbench_teams SET name = ?, description = ?, updated_at = ?, updated_by = ? WHERE id = ?');

  return {
    async load(teamId) {
      const row = latest.get(teamId) as SnapshotRow | undefined;
      if (row) return decode(row);
      const team = teamById.get(teamId) as TeamRow | undefined;
      if (!team) return null;
      const id = `${teamId}/root`;
      return {
        revision: 0,
        team: { ...team, description: team.description ?? '' },
        organization: { rootNodeId: id, nodes: [{ id, name: team.name, type: 'role', responsibility: '', assignee: null, parentIds: [], reviewRules: [], prompt: '', tools: [], tokenLimit: null, models: [] }] },
      };
    },
    async atRevision(teamId, revision) {
      const row = byRevision.get(teamId, revision) as SnapshotRow | undefined;
      return row ? decode(row) : null;
    },
    async save(teamId, expectedRevision, data) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!teamById.get(teamId)) throw new Error('找不到团队');
        const current = latest.get(teamId) as SnapshotRow | undefined;
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== expectedRevision) {
          throw new RevisionConflictError(expectedRevision, currentRevision);
        }
        const revision = currentRevision + 1;
        insert.run(teamId, revision, JSON.stringify(data), actor);
        update.run(data.team.name, data.team.description, new Date().toISOString(), actor, teamId);
        db.exec('COMMIT');
        return { revision };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } satisfies OrganizationRepository & {
    atRevision(teamId: string, revision: number): Promise<StoredOrganization | null>;
  };
}

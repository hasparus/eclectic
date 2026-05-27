import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {string} */
let tmpDir;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'memoriam-members-'));
	process.env.DATA_DIR = tmpDir;
});

afterEach(async () => {
	const platform = await import('$lib/server/platform_db.js');
	platform.closePlatformDb();
	const sites = await import('$lib/server/db.js');
	sites.closeAllDbs();
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.DATA_DIR;
});

describe('listUserSites', () => {
	it('returns sites the user belongs to with role', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite, listUserSites } = await import('$lib/server/sites.js');

		const u1 = upsertUserByEmail('one@example.com');
		const u2 = upsertUserByEmail('two@example.com');

		const s1 = createSite({ ownerUserId: u1.user_id, displayName: 'One A' });
		createSite({ ownerUserId: u1.user_id, displayName: 'One B' });
		createSite({ ownerUserId: u2.user_id, displayName: 'Two A' });

		const u1Sites = listUserSites(u1.user_id);
		expect(u1Sites.length).toBe(2);
		expect(u1Sites.every((s) => s.role === 'owner')).toBe(true);

		const u2Sites = listUserSites(u2.user_id);
		expect(u2Sites.length).toBe(1);
		expect(u2Sites[0].display_name).toBe('Two A');

		expect(s1.owner_user_id).toBe(u1.user_id);
	});
});

describe('invite flow', () => {
	it('issues, accepts, and lists membership', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { createInvite, acceptInvite, listMembers, listOutstandingInvites } = await import(
			'$lib/server/members.js'
		);

		const owner = upsertUserByEmail('owner@x.com');
		const invitee = upsertUserByEmail('invitee@x.com');
		const site = createSite({ ownerUserId: owner.user_id });

		const invite = createInvite(site.site_id, 'invitee@x.com', 'editor');
		expect(invite.email).toBe('invitee@x.com');
		expect(listOutstandingInvites(site.site_id).length).toBe(1);

		const result = acceptInvite(invite.invite_token, {
			user_id: invitee.user_id,
			email: invitee.email
		});
		expect(result.ok).toBe(true);
		expect(result.siteId).toBe(site.site_id);

		const members = listMembers(site.site_id);
		expect(members.length).toBe(2);
		const inviteeMember = members.find((m) => m.user_id === invitee.user_id);
		expect(inviteeMember?.role).toBe('editor');
		expect(listOutstandingInvites(site.site_id).length).toBe(0);
	});

	it('rejects invite for the wrong email', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { createInvite, acceptInvite } = await import('$lib/server/members.js');

		const owner = upsertUserByEmail('owner2@x.com');
		const wrong = upsertUserByEmail('wrong@x.com');
		const site = createSite({ ownerUserId: owner.user_id });

		const invite = createInvite(site.site_id, 'expected@x.com', 'editor');
		const result = acceptInvite(invite.invite_token, {
			user_id: wrong.user_id,
			email: wrong.email
		});
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('email_mismatch');
	});

	it('refuses to invite someone who is already a member', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { createInvite } = await import('$lib/server/members.js');

		const owner = upsertUserByEmail('owner3@x.com');
		const site = createSite({ ownerUserId: owner.user_id });

		expect(() => createInvite(site.site_id, 'owner3@x.com', 'editor')).toThrow(/already a member/);
	});

	it('expires after the TTL window', async () => {
		// Easier than waiting 14 days: backdate the invite row.
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { createInvite, acceptInvite } = await import('$lib/server/members.js');
		const { getPlatformDb } = await import('$lib/server/platform_db.js');

		const owner = upsertUserByEmail('owner4@x.com');
		const invitee = upsertUserByEmail('invitee4@x.com');
		const site = createSite({ ownerUserId: owner.user_id });

		const invite = createInvite(site.site_id, 'invitee4@x.com', 'editor');
		getPlatformDb()
			.prepare('UPDATE invites SET expires_at = ? WHERE invite_token = ?')
			.run(new Date(Date.now() - 1000).toISOString(), invite.invite_token);

		const result = acceptInvite(invite.invite_token, {
			user_id: invitee.user_id,
			email: invitee.email
		});
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('expired');
	});
});

describe('role management', () => {
	it('changes a non-owner role; refuses to remove last owner', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { createInvite, acceptInvite, changeMemberRole, removeMember } = await import(
			'$lib/server/members.js'
		);

		const owner = upsertUserByEmail('o@x.com');
		const friend = upsertUserByEmail('f@x.com');
		const site = createSite({ ownerUserId: owner.user_id });

		const invite = createInvite(site.site_id, 'f@x.com', 'viewer');
		acceptInvite(invite.invite_token, { user_id: friend.user_id, email: friend.email });

		changeMemberRole(site.site_id, friend.user_id, 'editor');
		const { listMembers } = await import('$lib/server/members.js');
		expect(listMembers(site.site_id).find((m) => m.user_id === friend.user_id)?.role).toBe(
			'editor'
		);

		expect(() => removeMember(site.site_id, owner.user_id)).toThrow(/last owner/);
		removeMember(site.site_id, friend.user_id);
		expect(listMembers(site.site_id).length).toBe(1);
	});

	it('transfers ownership and demotes the previous owner to editor', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite, getSite } = await import('$lib/server/sites.js');
		const { createInvite, acceptInvite, transferOwnership, listMembers } = await import(
			'$lib/server/members.js'
		);

		const a = upsertUserByEmail('a@x.com');
		const b = upsertUserByEmail('b@x.com');
		const site = createSite({ ownerUserId: a.user_id });
		const invite = createInvite(site.site_id, 'b@x.com', 'editor');
		acceptInvite(invite.invite_token, { user_id: b.user_id, email: b.email });

		transferOwnership(site.site_id, a.user_id, b.user_id);

		expect(getSite(site.site_id)?.owner_user_id).toBe(b.user_id);
		const members = listMembers(site.site_id);
		expect(members.find((m) => m.user_id === a.user_id)?.role).toBe('editor');
		expect(members.find((m) => m.user_id === b.user_id)?.role).toBe('owner');
	});

	it('refuses transfer from non-owner', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { createInvite, acceptInvite, transferOwnership } = await import(
			'$lib/server/members.js'
		);

		const a = upsertUserByEmail('a2@x.com');
		const b = upsertUserByEmail('b2@x.com');
		const site = createSite({ ownerUserId: a.user_id });
		const invite = createInvite(site.site_id, 'b2@x.com', 'editor');
		acceptInvite(invite.invite_token, { user_id: b.user_id, email: b.email });

		expect(() => transferOwnership(site.site_id, b.user_id, a.user_id)).toThrow(
			/Only an owner/
		);
	});
});

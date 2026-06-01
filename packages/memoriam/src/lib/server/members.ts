import { randomBytes } from 'node:crypto';
import { type } from 'arktype';
import { getPlatformDb } from '$lib/server/platform_db.js';
import { getUserByEmail } from '$lib/server/users.js';
import { parseRow, parseRowOptional, parseRows } from '$lib/server/db_row.js';
import type { SiteMember } from '$lib/server/sites.js';

export type Role = 'owner' | 'editor' | 'viewer';

const RoleSchema = type('"owner" | "editor" | "viewer"');

const SiteMemberWithEmailSchema = type({
	site_id: 'string',
	user_id: 'string',
	role: RoleSchema,
	created_at: 'string',
	email: 'string | null'
});
export type SiteMemberWithEmail = typeof SiteMemberWithEmailSchema.infer;

const InviteSchema = type({
	invite_token: 'string',
	site_id: 'string',
	email: 'string',
	role: RoleSchema,
	created_at: 'string',
	expires_at: 'string',
	accepted_at: 'string | null'
});
export type Invite = typeof InviteSchema.infer;

const AcceptInviteRowSchema = type({
	invite_token: 'string',
	site_id: 'string',
	email: 'string',
	role: RoleSchema,
	expires_at: 'string',
	accepted_at: 'string | null'
});

const ExistenceMarkerRowSchema = type({ '1': 'number' });
const RoleRowSchema = type({ role: RoleSchema });
const CountRowSchema = type({ n: 'number' });

const INVITE_TTL_DAYS = 14;

function nowIso(): string {
	return new Date().toISOString();
}

function isoAfterDays(days: number): string {
	return new Date(Date.now() + days * 86400 * 1000).toISOString();
}

function generateInviteToken(): string {
	return randomBytes(32).toString('base64url');
}

export function listMembers(siteId: string): SiteMemberWithEmail[] {
	const raw = getPlatformDb()
		.prepare(
			`SELECT m.site_id, m.user_id, m.role, m.created_at, u.email
			 FROM site_members m
			 LEFT JOIN users u ON u.user_id = m.user_id
			 WHERE m.site_id = ?
			 ORDER BY m.created_at ASC`
		)
		.all(siteId);
	return parseRows(SiteMemberWithEmailSchema, raw);
}

export function listOutstandingInvites(siteId: string): Invite[] {
	const raw = getPlatformDb()
		.prepare(
			`SELECT invite_token, site_id, email, role, created_at, expires_at, accepted_at
			 FROM invites
			 WHERE site_id = ? AND accepted_at IS NULL
			 ORDER BY created_at DESC`
		)
		.all(siteId);
	return parseRows(InviteSchema, raw);
}

export interface CreateInviteResult {
	ok: true;
	invite: Invite;
}

/**
 * Create a pending invite. If the email already belongs to a member,
 * throws; the caller should change their role instead.
 */
export function createInvite(siteId: string, email: string, role: Role): Invite {
	const normalized = email.trim().toLowerCase();
	const db = getPlatformDb();

	const existingUser = getUserByEmail(normalized);
	if (existingUser) {
		const member = parseRowOptional(
			ExistenceMarkerRowSchema,
			db
				.prepare(`SELECT 1 FROM site_members WHERE site_id = ? AND user_id = ?`)
				.get(siteId, existingUser.user_id)
		);
		if (member) {
			throw new Error(`${normalized} is already a member of this site`);
		}
	}

	const token = generateInviteToken();
	const createdAt = nowIso();
	const expiresAt = isoAfterDays(INVITE_TTL_DAYS);

	db.prepare(
		`INSERT INTO invites (invite_token, site_id, email, role, created_at, expires_at, accepted_at)
		 VALUES (?, ?, ?, ?, ?, ?, NULL)`
	).run(token, siteId, normalized, role, createdAt, expiresAt);

	return {
		invite_token: token,
		site_id: siteId,
		email: normalized,
		role,
		created_at: createdAt,
		expires_at: expiresAt,
		accepted_at: null
	};
}

export interface ConsumeInviteResult {
	ok: boolean;
	reason?: 'unknown' | 'expired' | 'already_consumed' | 'email_mismatch';
	siteId?: string;
	role?: Role;
}

/**
 * Accept an invite for the signed-in user. The user's email must match
 * the invite's email exactly (case-insensitive) — prevents an attacker
 * who guesses a token from grabbing access intended for someone else.
 */
export function acceptInvite(
	token: string,
	user: { user_id: string; email: string }
): ConsumeInviteResult {
	const db = getPlatformDb();
	const raw = db
		.prepare(
			`SELECT invite_token, site_id, email, role, expires_at, accepted_at
			 FROM invites WHERE invite_token = ?`
		)
		.get(token);
	const invite = parseRowOptional(AcceptInviteRowSchema, raw);

	if (!invite) return { ok: false, reason: 'unknown' };
	if (invite.accepted_at) return { ok: false, reason: 'already_consumed' };
	if (new Date(invite.expires_at).getTime() <= Date.now()) {
		return { ok: false, reason: 'expired' };
	}
	if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
		return { ok: false, reason: 'email_mismatch' };
	}

	const now = nowIso();
	db.exec('BEGIN IMMEDIATE');
	try {
		db.prepare(`UPDATE invites SET accepted_at = ? WHERE invite_token = ?`).run(now, token);
		db.prepare(
			`INSERT OR IGNORE INTO site_members (site_id, user_id, role, created_at)
			 VALUES (?, ?, ?, ?)`
		).run(invite.site_id, user.user_id, invite.role, now);
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}

	return { ok: true, siteId: invite.site_id, role: invite.role };
}

export function revokeInvite(siteId: string, token: string): void {
	getPlatformDb()
		.prepare(`DELETE FROM invites WHERE site_id = ? AND invite_token = ? AND accepted_at IS NULL`)
		.run(siteId, token);
}

export function changeMemberRole(siteId: string, userId: string, role: Role): void {
	getPlatformDb()
		.prepare(`UPDATE site_members SET role = ? WHERE site_id = ? AND user_id = ?`)
		.run(role, siteId, userId);
}

/**
 * Remove a member from a site. Refuses to remove the last owner —
 * caller should transfer ownership first.
 */
export function removeMember(siteId: string, userId: string): void {
	const db = getPlatformDb();
	const member = parseRowOptional(
		RoleRowSchema,
		db
			.prepare(`SELECT role FROM site_members WHERE site_id = ? AND user_id = ?`)
			.get(siteId, userId)
	);
	if (!member) return;

	if (member.role === 'owner') {
		const ownerCount = parseRow(
			CountRowSchema,
			db
				.prepare(`SELECT COUNT(*) AS n FROM site_members WHERE site_id = ? AND role = 'owner'`)
				.get(siteId)
		);
		if (ownerCount.n <= 1) {
			throw new Error('Cannot remove the last owner of a site');
		}
	}

	db.prepare(`DELETE FROM site_members WHERE site_id = ? AND user_id = ?`).run(siteId, userId);
}

/**
 * Transfer ownership from `fromUserId` to `toUserId`. Both must be
 * current members. The recipient is promoted to owner; the giver
 * becomes an editor (so they don't accidentally lock themselves out).
 */
export function transferOwnership(siteId: string, fromUserId: string, toUserId: string): void {
	const db = getPlatformDb();
	const from = parseRowOptional(
		RoleRowSchema,
		db
			.prepare(`SELECT role FROM site_members WHERE site_id = ? AND user_id = ?`)
			.get(siteId, fromUserId)
	);
	if (from?.role !== 'owner') {
		throw new Error('Only an owner can transfer ownership');
	}

	const to = parseRowOptional(
		RoleRowSchema,
		db
			.prepare(`SELECT role FROM site_members WHERE site_id = ? AND user_id = ?`)
			.get(siteId, toUserId)
	);
	if (!to) {
		throw new Error('Recipient must be a current member');
	}

	const now = nowIso();
	db.exec('BEGIN IMMEDIATE');
	try {
		db.prepare(
			`UPDATE site_members SET role = 'owner' WHERE site_id = ? AND user_id = ?`
		).run(siteId, toUserId);
		db.prepare(
			`UPDATE site_members SET role = 'editor' WHERE site_id = ? AND user_id = ?`
		).run(siteId, fromUserId);
		db.prepare(`UPDATE sites SET owner_user_id = ?, updated_at = ? WHERE site_id = ?`).run(
			toUserId,
			now,
			siteId
		);
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

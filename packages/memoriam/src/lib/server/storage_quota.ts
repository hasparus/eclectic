import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { siteAssetPath } from '$lib/server_config.js';

const DEFAULT_QUOTA_BYTES = 1_073_741_824; // 1 GiB

function getQuotaBytes(): number {
	const raw = env.MEMORIAM_SITE_QUOTA_BYTES;
	if (!raw) return DEFAULT_QUOTA_BYTES;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_QUOTA_BYTES;
	return n;
}

/**
 * Recursively sum the byte size of files under a directory.
 * Returns 0 if the directory doesn't exist yet.
 */
async function dirSize(dir: string): Promise<number> {
	let total = 0;
	let entries: import('node:fs').Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
		throw err;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			total += await dirSize(path);
		} else if (entry.isFile()) {
			try {
				const stat = await fs.stat(path);
				total += stat.size;
			} catch {
				// File disappeared mid-walk — ignore.
			}
		}
	}
	return total;
}

export interface QuotaStatus {
	usedBytes: number;
	quotaBytes: number;
	availableBytes: number;
	over: boolean;
}

/**
 * Compute current asset usage for a site. O(n) over the asset directory
 * — keep this off the request-blocking path for sites with thousands of
 * assets. For now, called on upload only.
 */
export async function getSiteStorageStatus(siteId: string): Promise<QuotaStatus> {
	const usedBytes = await dirSize(siteAssetPath(siteId));
	const quotaBytes = getQuotaBytes();
	return {
		usedBytes,
		quotaBytes,
		availableBytes: Math.max(0, quotaBytes - usedBytes),
		over: usedBytes >= quotaBytes
	};
}

/**
 * Pre-upload guard: returns true iff a new asset of `incomingBytes`
 * would fit under the site's quota. Computes current usage every call.
 */
export async function siteCanAccept(siteId: string, incomingBytes: number): Promise<boolean> {
	const status = await getSiteStorageStatus(siteId);
	return status.usedBytes + incomingBytes <= status.quotaBytes;
}

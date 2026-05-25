import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { mkdir, unlink, rm, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { siteAssetPath } from '$lib/server_config.js';

function ensureSiteAssetDir(siteId: string): string {
	const dir = siteAssetPath(siteId);
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function assetPath(siteId: string, assetId: string): string {
	return join(siteAssetPath(siteId), assetId);
}

function stem(assetId: string): string {
	const ext = extname(assetId);
	return ext ? assetId.slice(0, -ext.length) : assetId;
}

export function variantDir(siteId: string, assetId: string): string {
	return join(siteAssetPath(siteId), stem(assetId));
}

export function variantPath(siteId: string, assetId: string, width: number): string {
	return join(variantDir(siteId, assetId), `w${width}.webp`);
}

export type AssetData = ReadableStream | Buffer | Uint8Array;

export interface WriteResult {
	bytesWritten: number;
	sha256Hex: string;
}

/**
 * Stream a ReadableStream (web), Buffer, or Uint8Array to a file on
 * disk. Returns bytes written and the SHA-256 hex digest of the bytes
 * actually written, so callers can verify uploads match a claimed hash.
 */
async function streamToFile(filePath: string, data: AssetData): Promise<WriteResult> {
	let source: Readable;

	if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
		source = Readable.from([data]);
	} else {
		source = Readable.fromWeb(data as unknown as Parameters<typeof Readable.fromWeb>[0]);
	}

	let bytesWritten = 0;
	const hasher = createHash('sha256');

	const counter = new Transform({
		transform(chunk, _encoding, callback) {
			bytesWritten += chunk.length;
			hasher.update(chunk);
			callback(null, chunk);
		}
	});

	const dest = createWriteStream(filePath);
	await pipeline(source, counter, dest);

	return { bytesWritten, sha256Hex: hasher.digest('hex') };
}

export async function writeAsset(
	siteId: string,
	assetId: string,
	data: AssetData
): Promise<WriteResult> {
	ensureSiteAssetDir(siteId);
	return streamToFile(assetPath(siteId, assetId), data);
}

export async function writeVariant(
	siteId: string,
	assetId: string,
	width: number,
	data: AssetData
): Promise<WriteResult> {
	const dir = variantDir(siteId, assetId);
	await mkdir(dir, { recursive: true });
	return streamToFile(variantPath(siteId, assetId, width), data);
}

export function assetExists(siteId: string, assetId: string): boolean {
	return existsSync(assetPath(siteId, assetId));
}

export async function deleteAsset(siteId: string, assetId: string): Promise<void> {
	try {
		await unlink(assetPath(siteId, assetId));
	} catch {
		// File may not exist
	}

	const dir = variantDir(siteId, assetId);
	if (existsSync(dir)) {
		await rm(dir, { recursive: true });
	}
}

export interface ReadRange {
	start?: number;
	end?: number;
}

export function createAssetReadStream(
	siteId: string,
	assetId: string,
	range?: ReadRange
): ReadStream {
	return createReadStream(assetPath(siteId, assetId), range);
}

export function createVariantReadStream(siteId: string, assetId: string, width: number): ReadStream {
	return createReadStream(variantPath(siteId, assetId, width));
}

export async function assetSize(siteId: string, assetId: string): Promise<number> {
	const s = await stat(assetPath(siteId, assetId));
	return s.size;
}

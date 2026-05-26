import { getRequestEvent, query, command } from '$app/server';
import * as v from 'valibot';
import slugify from 'slugify';
import crypto from 'node:crypto';
import { documentSchema } from '$lib/document_schema.js';
import { collectNodeIdsInOrder } from '$lib/document_graph.js';
import {
	extractPageMetadata,
	extractPlainText,
	collectPageBodyNodeIds
} from '$lib/page_metadata.js';
import { requireAdminSession } from '$lib/server/auth.js';
import {
	platformSessionCookieName,
	createPlatformSession,
	deletePlatformSession,
	setPlatformSessionCookie,
	clearPlatformSessionCookie
} from '$lib/server/sessions.js';
import { issueMagicLink, consumeMagicLink } from '$lib/server/magic_link.js';
import { sendMagicLink } from '$lib/server/email.js';
import { upsertUserByEmail } from '$lib/server/users.js';
import { createSite as createSiteCore } from '$lib/server/sites.js';

/**
 * Per-site database accessor. Always resolves to the database for the
 * site that owns the current request (set by `hooks.server.js`). Helper
 * functions in this file call `db()` instead of holding a closure-scoped
 * reference, so the same code path works for any site.
 */
function db(): import('node:sqlite').DatabaseSync {
	const handle = getRequestEvent().locals.db;
	if (!handle) {
		throw new Error('No site resolved for this request');
	}
	return handle;
}

const requestMagicLinkInputSchema = v.object({
	email: v.pipe(v.string(), v.email())
});

const consumeMagicLinkInputSchema = v.object({
	token: v.string()
});

interface ErrorResult {
	ok: false;
	code: string;
	message: string;
}

function createPageUrlErrorResult(code: string, message: string): ErrorResult {
	return { ok: false, code, message };
}

function createAuthErrorResult(code: string, message: string): ErrorResult {
	return { ok: false, code, message };
}

interface DocumentRow {
	document_id: string;
	type: string;
	data: string;
	created_at?: string | null;
	updated_at?: string | null;
}

interface DocumentData {
	document_id: string;
	nodes: Record<string, any>;
}

interface PageDocumentRecord {
	document_id: string;
	nodes: Record<string, any>;
	created_at: string | null;
	updated_at: string | null;
}

interface PreviewMediaNode {
	type: string;
	src: string;
	width: number;
	height: number;
	alt: string;
	scale: number;
	focal_point_x: number;
	focal_point_y: number;
	object_fit: string;
	mime_type?: string;
}

interface PageSummary {
	document_id: string;
	title: string;
	description: string | null;
	preview_media_node: PreviewMediaNode | null;
	page_href: string;
	slug: string;
	created_at: string | null;
	updated_at: string | null;
}

interface InternalLinkPreview {
	document_id: string;
	title: string;
	description: string | null;
	preview_media_node: PreviewMediaNode | null;
}

interface PageTreeNode {
	document_id: string;
	title: string;
	preview_media_node: PreviewMediaNode | null;
	page_href: string;
	slug: string;
	created_at: string | null;
	updated_at: string | null;
	children: PageTreeNode[];
}

const saveDocumentInputSchema = v.object({
	document_id: v.string(),
	nodes: v.record(v.string(), v.any()),
	create: v.optional(v.boolean())
});

const updatePageSlugInputSchema = v.object({
	document_id: v.string(),
	slug: v.string()
});

const deletePageInputSchema = v.object({
	document_id: v.string()
});

const sql = (strings: TemplateStringsArray): string => strings.join('');

/**
 * Collect all node ids reachable from a root node by walking node /
 * node_array properties and annotation references.
 */
function collectNodeIds(
	rootId: string,
	nodes: Record<string, any>,
	excludeRoots?: Set<string>
): Set<string> {
	const collected = new Set<string>();
	const stack: string[] = [rootId];

	while (stack.length > 0) {
		const id = stack.pop();
		if (!id || collected.has(id)) continue;
		if (excludeRoots && excludeRoots.has(id) && id !== rootId) continue;

		collected.add(id);

		const node = nodes[id];
		if (!node) continue;

		const typeSchema = (documentSchema as Record<string, any>)[node.type];
		if (!typeSchema) continue;

		for (const [propName, propDef] of Object.entries(typeSchema.properties)) {
			const value = node[propName];
			if (value == null) continue;

			if (propDef.type === 'node' && typeof value === 'string') {
				stack.push(value);
			} else if (propDef.type === 'node_array' && Array.isArray(value)) {
				for (const childId of value) {
					stack.push(childId);
				}
			} else if (propDef.type === 'annotated_text' && value.annotations) {
				for (const annotation of value.annotations) {
					if (annotation.node_id) {
						stack.push(annotation.node_id);
					}
				}
			}
		}
	}

	return collected;
}



/**
 * @param {string} document_id
 * @param {Set<string>} node_ids
 * @param {Record<string, any>} all_nodes
 * @returns {DocumentData}
 */
function extractDocument( document_id: string, nodeIds: Iterable<string>, allNodes: Record<string, any>) {
	const nodes = {};
	for (const id of nodeIds) {
		if (allNodes[id]) {
			nodes[id] = allNodes[id];
		}
	}
	return { document_id, nodes };
}

/**
 * @param {string} document_id
 * @returns {DocumentData}
 */
function getDocFromDb( document_id: string) {
	const docRow = /** @type {DocumentRow | undefined} */ (
		db().prepare('SELECT * FROM documents WHERE document_id = ?').get(document_id)
	);

	if (!docRow) {
		throw new Error(`Document not found: ${document_id}`);
	}

	return JSON.parse(docRow.data);
}

/**
 * @param {string} document_id
 * @returns {DocumentData | null}
 */
function getOptionalDocFromDb( document_id: string) {
	const docRow = /** @type {DocumentRow | undefined} */ (
		db().prepare('SELECT * FROM documents WHERE document_id = ?').get(document_id)
	);

	if (!docRow) return null;
	return JSON.parse(docRow.data);
}

/**
 * @returns {string | null}
 */
function getHomePageIdFromDb() {
	const row = /** @type {{ value: string } | undefined } */ (
		db().prepare('SELECT value FROM site_settings WHERE key = ?').get('home_page_id')
	);

	return row?.value ?? null;
}



/**
 * @param {string} document_id
 * @returns {boolean}
 */
function isHomePageDocumentId( document_id: string) {
	return getHomePageIdFromDb() === document_id;
}

/**
 * @param {string} document_id
 * @returns {string | null}
 */
function getActiveSlugForDocumentId( document_id: string) {
	const row = /** @type {{ slug: string } | undefined } */ (
		db().prepare('SELECT slug FROM document_slugs WHERE document_id = ? AND is_active = 1').get(
			document_id
		)
	);

	return row?.slug ?? null;
}

/**
 * @param {string} slug
 * @returns {{ document_id: string, is_active: boolean, active_slug: string } | null}
 */
function resolveSlug( slug: string) {
	const row = /** @type {{ document_id: string, is_active: number } | undefined } */ (
		db().prepare('SELECT document_id, is_active FROM document_slugs WHERE slug = ?').get(slug)
	);

	if (!row) return null;

	const activeSlug = getActiveSlugForDocumentId(row.document_id);
	if (!activeSlug) {
		throw new Error(`Active slug not found for document: ${row.document_id}`);
	}

	return {
		document_id: row.document_id,
		is_active: row.is_active === 1,
		activeSlug
	};
}

/**
 * @returns {PageDocumentRecord[]}
 */
function listPageDocuments() {
	const rows = /** @type {DocumentRow[]} */ (
		db().prepare('SELECT * FROM documents WHERE type = ? ORDER BY document_id').all('page')
	);

	return rows.map((row) => {
		const doc = /** @type {DocumentData} */ (JSON.parse(row.data));
		return {
			document_id: doc.document_id,
			nodes: doc.nodes,
			created_at: row.created_at ?? null,
			updated_at: row.updated_at ?? null
		};
	});
}

/**
 * @param {string} title
 * @param {string} document_id
 * @returns {string}
 */
function createSlugCandidate( title: string, document_id: string) {
	const slug = slugify(title, { lower: true, strict: true, trim: true });
	return slug || document_id;
}

/**
 * @param {string} base_slug
 * @returns {string}
 */
function createUniqueSlug( baseSlug: string) {
	const slugExistsStmt = db().prepare(
		'SELECT document_id FROM document_slugs WHERE slug = ?'
	);

	let slug = baseSlug;
	let suffix = 2;

	while (true) {
		const row = /** @type {{ document_id: string } | undefined } */ (slugExistsStmt.get(slug));
		if (!row) return slug;
		slug = `${baseSlug}-${suffix}`;
		suffix += 1;
	}
}

/**
 * @param {string} href
 * @returns {{ slug: string, fragment: string }} | null
 */
function parseInternalPageHref( href: string) {
	if (!href) return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
	if (href.startsWith('//')) return null;
	if (!href.startsWith('/')) return null;

	const [pathPart, fragmentPart] = href.split('#');
	if (!pathPart || pathPart === '/') return null;

	const segments = pathPart.split('/').filter(Boolean);
	if (segments.length !== 1) return null;

	const slug = segments[0];
	if (!slug) return null;

	return {
		slug,
		fragment: fragmentPart ? `#${fragmentPart}` : ''
	};
}

/**
 * @param {string} href
 * @param {string | undefined} source_document_id
 * @returns {string | null}
 */
function normalizeInternalPageHref( href: string, sourceDocumentId: string | undefined) {
	const parsed = parseInternalPageHref(href);
	if (!parsed) return null;

	const resolved = resolveSlug(parsed.slug);
	if (!resolved) return null;
	if (sourceDocumentId && resolved.document_id === sourceDocumentId) return null;

	return resolved.document_id;
}

/**
 * @param {Record<string, any>} nodes
 * @param {Iterable<string>} node_ids
 * @param {string} source_document_id
 * @returns {string[]}
 */
function collectDocumentRefs( nodes: Record<string, any>, nodeIds: Iterable<string>, sourceDocumentId: string | undefined) {
	const refs = [];
	const seenRefs = new Set();

	for (const node_id of nodeIds) {
		const node = nodes[node_id];
		if (!node) continue;

		if (typeof node.href === 'string') {
			const targetDocumentId = normalizeInternalPageHref(node.href, sourceDocumentId);
			if (targetDocumentId && !seenRefs.has(targetDocumentId)) {
				seenRefs.add(targetDocumentId);
				refs.push(targetDocumentId);
			}
		}

		const typeSchema = (documentSchema as Record<string, any>)[node.type];
		if (!typeSchema) continue;

		for (const [propName, propDef] of Object.entries(typeSchema.properties)) {
			if (propDef.type !== 'annotated_text') continue;

			const value = node[propName];
			if (!value?.annotations) continue;

			for (const annotation of value.annotations) {
				const annotationNode = annotation?.node_id ? nodes[annotation.node_id] : null;
				if (!annotationNode || annotationNode.type !== 'link') continue;
				if (typeof annotationNode.href !== 'string') continue;

				const targetDocumentId = normalizeInternalPageHref(
					annotationNode.href,
					sourceDocumentId
				);

				if (targetDocumentId && !seenRefs.has(targetDocumentId)) {
					seenRefs.add(targetDocumentId);
					refs.push(targetDocumentId);
				}
			}
		}
	}

	return refs;
}

/**
 * @param {string} document_id
 * @param {Iterable<string>} node_ids
 * @param {Record<string, any>} all_nodes
 * @param {import('node:sqlite').StatementSync} delete_stmt
 * @param {import('node:sqlite').StatementSync} insert_stmt
 */
function updateAssetRefs( document_id: string, nodeIds: Iterable<string>, allNodes: Record<string, any>, delete_stmt: import("node:sqlite").StatementSync, insert_stmt: import("node:sqlite").StatementSync) {
	const assetIds = new Set();

	for (const node_id of nodeIds) {
		const node = allNodes[node_id];
		if (
			node &&
			(node.type === 'image' || node.type === 'video') &&
			typeof node.src === 'string' &&
			node.src &&
			!node.src.startsWith('blob:')
		) {
			assetIds.add(node.src);
		}
	}

	delete_stmt.run(document_id);
	for (const assetId of assetIds) {
		insert_stmt.run(assetId, document_id);
	}
}

/**
 * @param {string} source_document_id
 * @param {string[]} target_document_ids
 * @param {import('node:sqlite').StatementSync} delete_stmt
 * @param {import('node:sqlite').StatementSync} insert_stmt
 */
function updateDocumentRefs( sourceDocumentId: string | undefined, target_document_ids: string[], delete_stmt: import("node:sqlite").StatementSync, insert_stmt: import("node:sqlite").StatementSync) {
	delete_stmt.run(sourceDocumentId);
	for (const [ref_order, targetDocumentId] of target_document_ids.entries()) {
		insert_stmt.run(targetDocumentId, sourceDocumentId, ref_order);
	}
}

/**
 * @param {DocumentData} page_doc
 * @returns {{ nav_root_id: string | null, footer_root_id: string | null }}
 */
function getSharedRootIds( pageDoc: PageDocumentRecord | DocumentData) {
	const pageNode = pageDoc.nodes[pageDoc.document_id];

	return {
		navRootId: typeof pageNode?.nav === 'string' ? pageNode.nav : null,
		footerRootId: typeof pageNode?.footer === 'string' ? pageNode.footer : null
	};
}

/**
 * @param {string} document_id
 * @returns {DocumentData}
 */
function getCombinedDocument( document_id: string) {
	const pageDoc = getDocFromDb(document_id);
	const pageNode = pageDoc.nodes[pageDoc.document_id];
	const merged_nodes = { ...pageDoc.nodes };

	if (pageNode?.nav) {
		const nav_doc = getDocFromDb(pageNode.nav);
		Object.assign(merged_nodes, nav_doc.nodes);
	}

	if (pageNode?.footer) {
		const footer_doc = getDocFromDb(pageNode.footer);
		Object.assign(merged_nodes, footer_doc.nodes);
	}

	return {
		document_id: pageDoc.document_id,
		nodes: merged_nodes
	};
}

/**
 * @param {PageDocumentRecord} page_doc
 * @returns {PageSummary}
 */
function summarizePageDocument( pageDoc: PageDocumentRecord | DocumentData) {
	const metadata = extractPageMetadata({
		document_id: pageDoc.document_id,
		nodes: pageDoc.nodes
	});
	const activeSlug = getActiveSlugForDocumentId(pageDoc.document_id);

	// By invariant, only the home page has no active slug row. All other pages
	// must have an active slug, so a missing slug here implies `/`.
	return {
		document_id: pageDoc.document_id,
		title: metadata.title,
		description: metadata.description,
		preview_media_node: metadata.preview_media_node,
		page_href: activeSlug ? `/${activeSlug}` : '/',
		slug: activeSlug ?? '',
		created_at: pageDoc.created_at ?? null,
		updated_at: pageDoc.updated_at ?? null
	};
}

/**
 * @param {string} source_document_id
 * @returns {string[]}
 */
function getOutgoingRefs( sourceDocumentId: string | undefined) {
	const rows = /** @type {Array<{ target_document_id: string }>} */ (
		db().prepare(
			'SELECT target_document_id FROM document_refs WHERE source_document_id = ? ORDER BY ref_order, rowid'
		).all(sourceDocumentId)
	);

	return rows.map((row) => row.targetDocumentId);
}

/**
 * @param {string[]} refs
 * @param {Set<string>} assigned_page_ids
 * @param {Map<string, PageSummary>} summaries_by_id
 * @param {Map<string, string[]>} body_refs_by_page_id
 * @returns {PageTreeNode[]}
 */
function buildTreeChildren( refs: string[], assignedPageIds: Set<string>, summariesById: Map<string, PageSummary>, bodyRefsByPageId: Map<string, string[]>) {
	const children = [];

	for (const targetDocumentId of refs) {
		if (assignedPageIds.has(targetDocumentId)) continue;

		const summary = summariesById.get(targetDocumentId);
		if (!summary) continue;

		assignedPageIds.add(targetDocumentId);

		children.push({
			document_id: summary.document_id,
			title: summary.title,
			preview_media_node: summary.preview_media_node,
			page_href: summary.page_href,
			slug: summary.slug,
			created_at: summary.created_at,
			updated_at: summary.updated_at,
			children: buildTreeChildren(
				bodyRefsByPageId.get(targetDocumentId) ?? [],
				assignedPageIds,
				summariesById,
				bodyRefsByPageId
			)
		});
	}

	return children;
}

/**
 * @param {string} root_document_id
 * @param {Set<string>} assigned_page_ids
 * @param {Map<string, PageSummary>} summaries_by_id
 * @param {Map<string, string[]>} body_refs_by_page_id
 * @param {string[] | null} root_refs
 * @returns {PageTreeNode | null}
 */
function buildPageTreeNode( root_document_id: string, assignedPageIds: Set<string>, summariesById: Map<string, PageSummary>, bodyRefsByPageId: Map<string, string[]>,
	rootRefs = null
) {
	const summary = summariesById.get(root_document_id);
	if (!summary) return null;
	if (assignedPageIds.has(root_document_id)) return null;

	assignedPageIds.add(root_document_id);

	return {
		document_id: summary.document_id,
		title: summary.title,
		preview_media_node: summary.preview_media_node,
		page_href: summary.page_href,
		slug: summary.slug,
		created_at: summary.created_at,
		updated_at: summary.updated_at,
		children: buildTreeChildren(
			rootRefs ?? bodyRefsByPageId.get(root_document_id) ?? [],
			assignedPageIds,
			summariesById,
			bodyRefsByPageId
		)
	};
}

/**
 * @returns {{
 *   home_page_id: string | null,
 *   current_document_id: string | null,
 *   page_forest: PageTreeNode[]
 * }}
 */
function buildPageBrowserData() {
	const requestEvent = getRequestEvent();
	const pathname = requestEvent.url.pathname;
	const homePageId = getHomePageIdFromDb();
	const currentDocumentId =
		pathname === '/'
			? homePageId
			: resolveSlug(pathname.slice(1))?.document_id ?? null;
	const pageDocs = listPageDocuments();
	const pageDocsById = new Map(pageDocs.map((pageDoc) => [pageDoc.document_id, pageDoc]));
	const summaries = pageDocs.map(summarizePageDocument);
	const summariesById = new Map(summaries.map((summary) => [summary.document_id, summary]));

	const homePageDoc = homePageId ? pageDocsById.get(homePageId) ?? null : null;
	const { navRootId, footerRootId } = homePageDoc
		? getSharedRootIds(homePageDoc)
		: { navRootId: null, footerRootId: null };

	const bodyRefsByPageId = new Map();
	for (const pageDoc of pageDocs) {
		const bodyNodeIds = collectPageBodyNodeIds(pageDoc);
		bodyRefsByPageId.set(
			pageDoc.document_id,
			collectDocumentRefs(pageDoc.nodes, bodyNodeIds, pageDoc.document_id)
		);
	}

	const pageForest = [];
	const assignedPageIds = new Set();
	const incomingPageRefCounts = new Map();

	for (const pageDoc of pageDocs) {
		incomingPageRefCounts.set(pageDoc.document_id, 0);
	}

	for (const refs of bodyRefsByPageId.values()) {
		for (const targetDocumentId of refs) {
			if (!incomingPageRefCounts.has(targetDocumentId)) continue;
			incomingPageRefCounts.set(
				targetDocumentId,
				(incomingPageRefCounts.get(targetDocumentId) ?? 0) + 1
			);
		}
	}

	let homeLinkedPageIds = new Set();

	if (homePageId && summariesById.has(homePageId)) {
		const navRefs = navRootId ? getOutgoingRefs(navRootId) : [];
		const footerRefs = footerRootId ? getOutgoingRefs(footerRootId) : [];
		const homeBodyRefs = bodyRefsByPageId.get(homePageId) ?? [];

		homeLinkedPageIds = new Set([homePageId]);
		buildTreeChildren(
			[...navRefs, ...homeBodyRefs, ...footerRefs],
			homeLinkedPageIds,
			summariesById,
			bodyRefsByPageId
		);
	}

	const nonHomeRootSummaries = summaries
		.filter(
			(summary) =>
				summary.document_id !== homePageId &&
				!homeLinkedPageIds.has(summary.document_id) &&
				(incomingPageRefCounts.get(summary.document_id) ?? 0) === 0
		)
		.sort((a, b) => {
			const a_updated_at = a.updated_at ?? a.created_at ?? '';
			const b_updated_at = b.updated_at ?? b.created_at ?? '';

			if (a_updated_at !== b_updated_at) {
				return b_updated_at.localeCompare(a_updated_at);
			}

			return a.title.localeCompare(b.title);
		});

	if (homePageId && summariesById.has(homePageId)) {
		const navRefs = navRootId ? getOutgoingRefs(navRootId) : [];
		const footerRefs = footerRootId ? getOutgoingRefs(footerRootId) : [];
		const homeBodyRefs = bodyRefsByPageId.get(homePageId) ?? [];

		const homeRoot = buildPageTreeNode(
			homePageId,
			assignedPageIds,
			summariesById,
			bodyRefsByPageId,
			[...navRefs, ...homeBodyRefs, ...footerRefs]
		);

		if (homeRoot) {
			homeRoot.title = 'Home';
			pageForest.push(homeRoot);
		}
	}

	for (const summary of nonHomeRootSummaries) {
		if (assignedPageIds.has(summary.document_id)) continue;

		const rootNode = buildPageTreeNode(
			summary.document_id,
			assignedPageIds,
			summariesById,
			bodyRefsByPageId
		);

		if (rootNode) {
			pageForest.push(rootNode);
		}
	}

	return {
		home_page_id: homePageId,
		current_document_id: currentDocumentId,
		page_forest: pageForest
	};
}

/**
 * Get a document from the database, stitching in shared documents (nav, footer).
 */
export const getDocument = query(v.string(), async (slug) => {
	const resolved = resolveSlug(slug);

	if (!resolved) {
		throw new Error(`Page not found for slug: ${slug}`);
	}

	return {
		document: getCombinedDocument(resolved.document_id),
		slug: resolved.activeSlug,
		redirect_to_slug: resolved.is_active ? null : resolved.activeSlug
	};
});

/**
 * Resolve the configured home page and return its stitched document.
 */
export const getHomeDocument = query(v.void(), async () => {
	const homePageId = getHomePageIdFromDb();

	if (!homePageId) {
		throw new Error('Home page is not configured');
	}

	return {
		document: getCombinedDocument(homePageId),
		slug: getActiveSlugForDocumentId(homePageId),
		redirect_to_slug: null
	};
});

/**
 * Return the current shared nav and footer documents used for composing new pages.
 */
export const getSharedDocuments = query(v.void(), async () => {
	const homePageId = getHomePageIdFromDb();

	if (!homePageId) {
		throw new Error('Home page is not configured');
	}

	const homePageDoc = getDocFromDb(homePageId);
	const { navRootId, footerRootId } = getSharedRootIds(homePageDoc);

	if (!navRootId) {
		throw new Error('Home page nav document is not configured');
	}

	if (!footerRootId) {
		throw new Error('Home page footer document is not configured');
	}

	return {
		nav_document: getDocFromDb(navRootId),
		footer_document: getDocFromDb(footerRootId)
	};
});

/**
 * Issue a magic-link token for the given email and send the sign-in
 * link via Resend (or log it to stdout in dev when RESEND_API_KEY is
 * unset). Always returns `{ ok: true }` regardless of whether the
 * email was actually delivered — surfacing delivery results would let
 * attackers probe for registered emails.
 */
export const requestMagicLink = command(requestMagicLinkInputSchema, async ({ email }) => {
	const { url } = getRequestEvent();
	const issued = issueMagicLink(email);
	const link = `${url.origin}/auth/magic?token=${encodeURIComponent(issued.token)}`;
	await sendMagicLink(issued.email, link);
	return { ok: true };
});

/**
 * Consume a magic-link token: validates, upserts the user, creates a
 * platform session, and sets the session cookie.
 */
export const consumeMagicLinkToken = command(
	consumeMagicLinkInputSchema,
	async ({ token }) => {
		const { cookies } = getRequestEvent();
		const result = consumeMagicLink(token);
		if (!result.ok || !result.email) {
			return createAuthErrorResult(result.reason ?? 'unknown', 'Magic link is not valid.');
		}

		const user = upsertUserByEmail(result.email);
		const session = createPlatformSession(user.user_id);
		setPlatformSessionCookie(cookies, session.session_id);

		return { ok: true, userId: user.user_id, email: user.email };
	}
);

export const logout = command(v.void(), async () => {
	const { cookies } = getRequestEvent();
	const sessionId = cookies.get(platformSessionCookieName);

	if (sessionId) {
		deletePlatformSession(sessionId);
	}

	clearPlatformSessionCookie(cookies);

	return {
		ok: true
	};
});

const createSiteInputSchema = v.object({
	display_name: v.optional(v.string()),
	preferred_site_id: v.optional(v.string()),
	visibility: v.optional(v.picklist(['public', 'unlisted', 'private']))
});

/**
 * Create a new site owned by the authenticated user. Returns the
 * created site row. v1 has no per-user site quota — Phase 2 follow-up.
 */
export const createSite = command(createSiteInputSchema, async (input) => {
	const { locals } = getRequestEvent();
	if (!locals.userId) {
		return createAuthErrorResult('unauthenticated', 'Sign in first.');
	}

	const site = createSiteCore({
		ownerUserId: locals.userId,
		displayName: input.display_name,
		preferredSiteId: input.preferred_site_id,
		visibility: input.visibility
	});

	return { ok: true, site };
});

/**
 * Return page browser data for the pages drawer.
 */
export const getPageBrowserData = query(v.void(), async () => {
	requireAdminSession(getRequestEvent().locals);
	return buildPageBrowserData();
});

/**
 * Delete a page document and its related refs.
 */
export const deletePage = command(deletePageInputSchema, async ({ document_id }) => {
	requireAdminSession(getRequestEvent().locals);

	const homePageId = getHomePageIdFromDb();

	if (!document_id) {
		throw new Error('Document id is required');
	}

	if (document_id === homePageId) {
		throw new Error('The home page cannot be deleted');
	}

	const existingDoc = getOptionalDocFromDb(document_id);
	if (!existingDoc) {
		throw new Error(`Document not found: ${document_id}`);
	}

	const deleteDocument = db().prepare('DELETE FROM documents WHERE document_id = ? AND type = ?');
	const deleteAssetRefs = db().prepare('DELETE FROM asset_refs WHERE document_id = ?');
	const deleteOutgoingDocumentRefs = db().prepare(
		'DELETE FROM document_refs WHERE source_document_id = ?'
	);
	const deleteIncomingDocumentRefs = db().prepare(
		'DELETE FROM document_refs WHERE target_document_id = ?'
	);
	const deleteDocumentSlugs = db().prepare('DELETE FROM document_slugs WHERE document_id = ?');

	db().exec(sql`
		BEGIN IMMEDIATE
	`);

	try {
		deleteAssetRefs.run(document_id);
		deleteOutgoingDocumentRefs.run(document_id);
		deleteIncomingDocumentRefs.run(document_id);
		deleteDocumentSlugs.run(document_id);
		deleteDocument.run(document_id, 'page');

		db().exec(sql`
			COMMIT
		`);
	} catch (err) {
		db().exec(sql`
			ROLLBACK
		`);
		throw err;
	}

	return {
		ok: true,
		document_id
	};
});

/**
 * Return a lightweight preview for a simple internal page href like `/some-slug`.
 */
export const getInternalLinkPreview = query(v.string(), async (href) => {
	const parsed = parseInternalPageHref(href);
	if (!parsed) {
		return null;
	}

	const resolved = resolveSlug(parsed.slug);
	if (!resolved) {
		return null;
	}

	const docRow = /** @type {DocumentRow | undefined} */ (
		db().prepare('SELECT type, data FROM documents WHERE document_id = ?').get(resolved.document_id)
	);
	if (!docRow || docRow.type !== 'page') {
		return null;
	}

	const pageDoc = /** @type {DocumentData} */ (JSON.parse(docRow.data));
	const metadata = extractPageMetadata(pageDoc);

	return /** @type {InternalLinkPreview} */ ({
		document_id: resolved.document_id,
		title: metadata.title,
		description: metadata.description,
		preview_media_node: metadata.preview_media_node
	});
});

/**
 * Save a document to the database, splitting shared documents (nav, footer) back out.
 */
function rewriteInternalPageHref( href: string, targetDocumentId, new_slug: string) {
	const parsed = parseInternalPageHref(href);
	if (!parsed) return href;

	const resolved = resolveSlug(parsed.slug);
	if (resolved?.document_id !== targetDocumentId) return href;

	return `/${new_slug}${parsed.fragment}`;
}

function rewriteInternalPageHrefs( nodes: Record<string, any>, targetDocumentId, new_slug: string) {
	for (const node of Object.values(nodes)) {
		if (!node || typeof node !== 'object') continue;

		if (typeof node.href === 'string') {
			node.href = rewriteInternalPageHref(node.href, targetDocumentId, new_slug);
		}

		const typeSchema = (documentSchema as Record<string, any>)[node.type];
		if (!typeSchema) continue;

		for (const [propName, propDef] of Object.entries(typeSchema.properties)) {
			if (propDef.type !== 'annotated_text') continue;

			const value = node[propName];
			if (!value?.annotations) continue;

			for (const annotation of value.annotations) {
				const annotationNode = annotation?.node_id ? nodes[annotation.node_id] : null;
				if (!annotationNode || annotationNode.type !== 'link') continue;
				if (typeof annotationNode.href !== 'string') continue;

				annotationNode.href = rewriteInternalPageHref(
					annotationNode.href,
					targetDocumentId,
					new_slug
				);
			}
		}
	}
}

function insertActiveSlug( document_id: string, slug: string, insert_slug_stmt: import("node:sqlite").StatementSync, deactivate_slug_stmt: import("node:sqlite").StatementSync) {
	deactivate_slug_stmt.run(document_id);
	insert_slug_stmt.run(slug, document_id, 1, new Date().toISOString());
}

function moveActiveSlugToHistory( document_id: string, insert_slug_stmt: import("node:sqlite").StatementSync, deactivate_slug_stmt: import("node:sqlite").StatementSync, delete_slug_stmt: import("node:sqlite").StatementSync) {
	const current_slug = getActiveSlugForDocumentId(document_id);
	if (!current_slug) return null;

	delete_slug_stmt.run(current_slug);
	insert_slug_stmt.run(current_slug, document_id, 0, new Date().toISOString());
	deactivate_slug_stmt.run(document_id);
	return current_slug;
}

function assignActiveSlug( document_id: string, slug: string, insert_slug_stmt: import("node:sqlite").StatementSync, deactivate_slug_stmt: import("node:sqlite").StatementSync, delete_slug_stmt: import("node:sqlite").StatementSync) {
	delete_slug_stmt.run(slug);
	insertActiveSlug(document_id, slug, insert_slug_stmt, deactivate_slug_stmt);
}

export const saveDocument = command(saveDocumentInputSchema, async (combinedDoc) => {
	requireAdminSession(getRequestEvent().locals);

	const allNodes = structuredClone(combinedDoc.nodes);
	const pageNode = allNodes[combinedDoc.document_id];

	if (!pageNode) {
		throw new Error(`Root node not found: ${combinedDoc.document_id}`);
	}

	if (combinedDoc.create) {
		const existingDoc = getOptionalDocFromDb(combinedDoc.document_id);
		if (existingDoc) {
			throw new Error(`Document already exists: ${combinedDoc.document_id}`);
		}
	}

	const navRootId = pageNode.nav;
	const footerRootId = pageNode.footer;

	const navNodeIds = navRootId ? new Set(collectNodeIdsInOrder(navRootId, allNodes)) : new Set();
	const footerNodeIds = footerRootId
		? new Set(collectNodeIdsInOrder(footerRootId, allNodes))
		: new Set();

	const excludeRoots = new Set();
	if (navRootId) excludeRoots.add(navRootId);
	if (footerRootId) excludeRoots.add(footerRootId);

	const pageNodeIds = collectNodeIds(combinedDoc.document_id, allNodes, excludeRoots);
	const pageDoc = extractDocument(combinedDoc.document_id, pageNodeIds, allNodes);

	const upsert = db().prepare(
		'INSERT INTO documents (document_id, type, data, created_at, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
	);

	const deleteAssetRefs = db().prepare('DELETE FROM asset_refs WHERE document_id = ?');
	const insertAssetRef = db().prepare(
		'INSERT OR IGNORE INTO asset_refs (asset_id, document_id) VALUES (?, ?)'
	);

	const deleteDocumentRefs = db().prepare('DELETE FROM document_refs WHERE source_document_id = ?');
	const insertDocumentRef = db().prepare(
		'INSERT OR REPLACE INTO document_refs (target_document_id, source_document_id, ref_order) VALUES (?, ?, ?)'
	);

	const deleteSlug = db().prepare('DELETE FROM document_slugs WHERE slug = ?');
	const deactivateActiveSlug = db().prepare(
		'UPDATE document_slugs SET is_active = 0 WHERE document_id = ? AND is_active = 1'
	);
	const insertSlug = db().prepare(
		'INSERT INTO document_slugs (slug, document_id, is_active, created_at) VALUES (?, ?, ?, ?)'
	);

	db().exec(sql`
		BEGIN IMMEDIATE
	`);

	try {
		const existingPageRow = /** @type {DocumentRow | undefined} */ (
			db().prepare('SELECT created_at FROM documents WHERE document_id = ?').get(combinedDoc.document_id)
		);
		const nowIso = new Date().toISOString();
		const created_at = existingPageRow?.created_at ?? nowIso;

		upsert.run(combinedDoc.document_id, 'page', JSON.stringify(pageDoc), created_at, nowIso);
		updateAssetRefs(
			combinedDoc.document_id,
			pageNodeIds,
			allNodes,
			deleteAssetRefs,
			insertAssetRef
		);
		updateDocumentRefs(
			combinedDoc.document_id,
			collectDocumentRefs(allNodes, pageNodeIds, combinedDoc.document_id),
			deleteDocumentRefs,
			insertDocumentRef
		);

		if (navRootId && navNodeIds.size > 0) {
			const nav_doc = extractDocument(navRootId, navNodeIds, allNodes);
			const existingNavRow = /** @type {DocumentRow | undefined} */ (
				db().prepare('SELECT created_at FROM documents WHERE document_id = ?').get(navRootId)
			);
			const nav_created_at = existingNavRow?.created_at ?? nowIso;
			upsert.run(navRootId, 'nav', JSON.stringify(nav_doc), nav_created_at, nowIso);
			updateAssetRefs(navRootId, navNodeIds, allNodes, deleteAssetRefs, insertAssetRef);
			updateDocumentRefs(
				navRootId,
				collectDocumentRefs(allNodes, navNodeIds, navRootId),
				deleteDocumentRefs,
				insertDocumentRef
			);
		}

		if (footerRootId && footerNodeIds.size > 0) {
			const footer_doc = extractDocument(footerRootId, footerNodeIds, allNodes);
			const existingFooterRow = /** @type {DocumentRow | undefined} */ (
				db().prepare('SELECT created_at FROM documents WHERE document_id = ?').get(footerRootId)
			);
			const footer_created_at = existingFooterRow?.created_at ?? nowIso;
			upsert.run(footerRootId, 'footer', JSON.stringify(footer_doc), footer_created_at, nowIso);
			updateAssetRefs(
				footerRootId,
				footerNodeIds,
				allNodes,
				deleteAssetRefs,
				insertAssetRef
			);
			updateDocumentRefs(
				footerRootId,
				collectDocumentRefs(allNodes, footerNodeIds, footerRootId),
				deleteDocumentRefs,
				insertDocumentRef
			);
		}

		let activeSlug = getActiveSlugForDocumentId(combinedDoc.document_id);

		if (combinedDoc.create && !activeSlug && !isHomePageDocumentId(combinedDoc.document_id)) {
			const metadata = extractPageMetadata(pageDoc);
			const baseSlug = createSlugCandidate(metadata.title, combinedDoc.document_id);
			activeSlug = createUniqueSlug(baseSlug);
			insertActiveSlug(combinedDoc.document_id, activeSlug, insertSlug, deactivateActiveSlug);
		}

		const persistedPage = getOptionalDocFromDb(combinedDoc.document_id);
		if (!persistedPage) {
			throw new Error(`Failed to persist page document: ${combinedDoc.document_id}`);
		}

		db().exec(sql`
			COMMIT
		`);
	} catch (err) {
		db().exec(sql`
			ROLLBACK
		`);
		throw err;
	}

	return {
		ok: true,
		document_id: combinedDoc.document_id,
		slug: isHomePageDocumentId(combinedDoc.document_id)
			? null
			: getActiveSlugForDocumentId(combinedDoc.document_id),
		created: !!combinedDoc.create
	};
});

export const updatePageSlug = command(updatePageSlugInputSchema, async (input) => {
	requireAdminSession(getRequestEvent().locals);

	const normalizedSlug = slugify(input.slug, { lower: true, strict: true, trim: true });

	if (!normalizedSlug) {
		return createPageUrlErrorResult('page_url_empty', 'Page URL cannot be empty');
	}

	const existingDoc = getOptionalDocFromDb(input.document_id);
	if (!existingDoc) {
		return createPageUrlErrorResult('page_not_found', `Document not found: ${input.document_id}`);
	}

	const homePageId = getHomePageIdFromDb();
	if (homePageId === input.document_id) {
		return createPageUrlErrorResult('home_page_url_locked', 'The home page URL cannot be changed');
	}

	const currentActiveSlug = getActiveSlugForDocumentId(input.document_id);
	if (!currentActiveSlug) {
		return createPageUrlErrorResult(
			'active_slug_missing',
			`Active slug not found for document: ${input.document_id}`
		);
	}

	if (normalizedSlug === currentActiveSlug) {
		return {
			ok: true,
			slug: currentActiveSlug
		};
	}

	const existingSlug = /** @type {{ document_id: string, is_active: number } | undefined} */ (
		db().prepare('SELECT document_id, is_active FROM document_slugs WHERE slug = ?').get(normalizedSlug)
	);

	if (existingSlug && existingSlug.document_id !== input.document_id && existingSlug.is_active === 1) {
		return createPageUrlErrorResult(
			'page_url_used_by_other_page',
			'That Page URL is already in use by another page. Rename that page first.'
		);
	}

	const deleteSlug = db().prepare('DELETE FROM document_slugs WHERE slug = ?');
	const deactivateActiveSlug = db().prepare(
		'UPDATE document_slugs SET is_active = 0 WHERE document_id = ? AND is_active = 1'
	);
	const insertSlug = db().prepare(
		'INSERT INTO document_slugs (slug, document_id, is_active, created_at) VALUES (?, ?, ?, ?)'
	);

	db().exec(sql`
		BEGIN IMMEDIATE
	`);

	let newActiveSlug = null;

	try {
		moveActiveSlugToHistory(
			input.document_id,
			insertSlug,
			deactivateActiveSlug,
			deleteSlug
		);
		assignActiveSlug(
			input.document_id,
			normalizedSlug,
			insertSlug,
			deactivateActiveSlug,
			deleteSlug
		);

		newActiveSlug = getActiveSlugForDocumentId(input.document_id);
		if (!newActiveSlug) {
			throw new Error('Failed to assign new active slug');
		}

		const pageRows = /** @type {DocumentRow[]} */ (
			db().prepare('SELECT * FROM documents WHERE type IN (?, ?, ?) ORDER BY document_id').all(
				'page',
				'nav',
				'footer'
			)
		);

		const upsert = db().prepare(
			'INSERT INTO documents (document_id, type, data, created_at, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
		);
		const deleteDocumentRefs = db().prepare('DELETE FROM document_refs WHERE source_document_id = ?');
		const insertDocumentRef = db().prepare(
			'INSERT OR REPLACE INTO document_refs (target_document_id, source_document_id, ref_order) VALUES (?, ?, ?)'
		);

		const nowIso = new Date().toISOString();

		for (const row of pageRows) {
			const doc = JSON.parse(row.data);
			rewriteInternalPageHrefs(doc.nodes, input.document_id, newActiveSlug);
			upsert.run(
				row.document_id,
				row.type,
				JSON.stringify(doc),
				row.created_at ?? nowIso,
				nowIso
			);

			const rootId = row.document_id;
			const nodeIds = collectNodeIds(rootId, doc.nodes);
			updateDocumentRefs(
				rootId,
				collectDocumentRefs(doc.nodes, nodeIds, rootId),
				deleteDocumentRefs,
				insertDocumentRef
			);
		}

		db().exec(sql`
			COMMIT
		`);
	} catch (err) {
		db().exec(sql`
			ROLLBACK
		`);
		throw err;
	}

	return {
		ok: true,
		document_id: input.document_id,
		page_href: `/${newActiveSlug}`
	};
});

import { getRequestEvent, query, command } from '$app/server';
import { type } from 'arktype';
import { Result, ok, err } from 'neverthrow';
import { errOf, fromUnknown, type AppError } from '$lib/server/app_error.js';
import { rpcFromResult } from '$lib/server/rpc_result.js';

// Note on optional fields: arktype's `'key?'` means "key may be
// absent". It does NOT accept `{ key: undefined }`, while SvelteKit's
// `devalue`-based remote call protocol preserves explicit `undefined`
// keys. So every optional field must also accept `undefined`:
//
//   'next?': 'string | undefined'  ← idiomatic
//   'next?': 'string'               ← rejects { next: undefined }
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
import { sendMagicLink, sendInvite } from '$lib/server/email.js';
import { upsertUserByEmail } from '$lib/server/users.js';
import {
	createSite as createSiteCore,
	getSite as getSiteCore,
	getSiteMember,
	listUserSites
} from '$lib/server/sites.js';
import {
	createInvite,
	listMembers,
	listOutstandingInvites,
	revokeInvite,
	changeMemberRole,
	removeMember,
	transferOwnership
} from '$lib/server/members.js';
import { getUser } from '$lib/server/users.js';
import { checkRateLimit } from '$lib/server/rate_limit.js';
import { issueShortCode } from '$lib/server/short_codes.js';
import {
	createPerson as createPersonCore,
	getPerson as getPersonCore,
	updatePerson as updatePersonCore,
	addParentEdge as addParentEdgeCore,
	removeParentEdge as removeParentEdgeCore,
	createCouple as createCoupleCore,
	removeCouple as removeCoupleCore,
	deletePerson as deletePersonCore,
	getCoupleById,
	setSiteSubject as setSiteSubjectCore,
	getSiteSubjectId,
	getTreeRootedAt,
	userCanEditPerson,
	linkPersonToSite,
	importParsedGedcom
} from '$lib/server/people.js';
import {
	refreshSiteTreeDoc,
	refreshTreeDocsForPerson,
	refreshSitePageBroadcastDoc,
	refreshDocumentDoc
} from '$lib/server/automerge_server.js';
import { getPlatformDb } from '$lib/server/platform_db.js';

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

const requestMagicLinkInputSchema = type({
	email: 'string.email',
	'next?': 'string | undefined'
});

const consumeMagicLinkInputSchema = type({
	token: 'string'
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

const saveDocumentInputSchema = type({
	document_id: 'string',
	// `nodes` is a free-form svedit document tree; the document_schema
	// validates the shape later. Typed as a permissive record so
	// downstream access (`nodes[id].nav`, etc.) doesn't trip TS.
	nodes: type({ '[string]': 'unknown' }).as<Record<string, any>>(),
	'create?': 'boolean | undefined'
});

const updatePageSlugInputSchema = type({
	document_id: 'string',
	slug: 'string'
});

const deletePageInputSchema = type({
	document_id: 'string'
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
export const getDocument = query(type('string'), async (slug) => {
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
export const getHomeDocument = query(type('undefined'), async () => {
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
export const getSharedDocuments = query(type('undefined'), async () => {
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

// Rate-limit magic-link requests: at most 5 per email per hour, and at
// most 30 per IP per hour (each IP can't request links for many emails
// to bypass the per-email cap). The response is uniform regardless of
// rate-limit state so attackers can't use the endpoint to fingerprint
// registered emails.
// Rate caps live in env so the e2e suite (one IP, dozens of sign-ins
// per run) can crank `MEMORIAM_MAGIC_LINK_RATE_PER_IP` without
// loosening the production defaults. Production keeps 5 emails / 30 IP
// per hour; dev/test override via `.env` or `playwright.config.ts`.
import { env as privateEnv } from '$env/dynamic/private';
const MAGIC_LINK_RATE_PER_EMAIL = {
	max: Number(privateEnv.MEMORIAM_MAGIC_LINK_RATE_PER_EMAIL ?? 5),
	windowMs: 60 * 60 * 1000
};
const MAGIC_LINK_RATE_PER_IP = {
	max: Number(privateEnv.MEMORIAM_MAGIC_LINK_RATE_PER_IP ?? 30),
	windowMs: 60 * 60 * 1000
};

/**
 * Issue a magic-link token for the given email and send the sign-in
 * link via Resend (or log it to stdout in dev when RESEND_API_KEY is
 * unset). Always returns `{ ok: true }` regardless of whether the
 * email was actually delivered or rate-limited — surfacing those
 * results would let attackers probe for registered emails or DOS
 * mailboxes.
 */
export const requestMagicLink = command(requestMagicLinkInputSchema, async ({ email, next }) => {
	const { url, getClientAddress } = getRequestEvent();
	const normalized = email.trim().toLowerCase();

	const emailCheck = checkRateLimit(`mlink:email:${normalized}`, MAGIC_LINK_RATE_PER_EMAIL);
	const ipCheck = checkRateLimit(`mlink:ip:${getClientAddress()}`, MAGIC_LINK_RATE_PER_IP);
	if (!emailCheck.ok || !ipCheck.ok) {
		console.warn(
			`[auth] rate-limited magic-link request for ${normalized} from ${getClientAddress()}`
		);
		return { ok: true };
	}

	const issued = issueMagicLink(normalized);
	const params = new URLSearchParams({ token: issued.token });
	if (next && next.startsWith('/')) params.set('next', next);
	const link = `${url.origin}/auth/magic?${params.toString()}`;
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

export const logout = command(type('undefined'), async () => {
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

const createSiteInputSchema = type({
	'display_name?': 'string | undefined',
	'preferred_site_id?': 'string | undefined',
	'visibility?': "'public' | 'unlisted' | 'private' | undefined"
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
export const getPageBrowserData = query(type('undefined'), async () => {
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

	const siteIdForBroadcast = getRequestEvent().locals.siteId;
	if (siteIdForBroadcast) refreshSitePageBroadcastDoc(siteIdForBroadcast);

	return {
		ok: true,
		document_id
	};
});

/**
 * Return a lightweight preview for a simple internal page href like `/some-slug`.
 */
export const getInternalLinkPreview = query(type('string'), async (href) => {
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

	// Live multiplayer:
	//   * Per-document Automerge doc gets the post-save snapshot so
	//     any peer with this document's Session attached merges in
	//     the change at the op level.
	//   * Per-site broadcast doc ticks so peers viewing other pages
	//     on this site re-fetch the page list / nav / footer.
	const siteIdForBroadcast = getRequestEvent().locals.siteId;
	if (siteIdForBroadcast) {
		// Refresh the page document, the nav, and the footer — each
		// is a separate `documents` row that `saveDocument` might
		// have touched.
		refreshDocumentDoc(siteIdForBroadcast, combinedDoc.document_id);
		if (navRootId) refreshDocumentDoc(siteIdForBroadcast, navRootId);
		if (footerRootId) refreshDocumentDoc(siteIdForBroadcast, footerRootId);
		refreshSitePageBroadcastDoc(siteIdForBroadcast);
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

	const siteIdForBroadcast = getRequestEvent().locals.siteId;
	if (siteIdForBroadcast) refreshSitePageBroadcastDoc(siteIdForBroadcast);

	return {
		ok: true,
		document_id: input.document_id,
		page_href: `/${newActiveSlug}`
	};
});


// --- Site listing + member management ---

const inviteMemberInputSchema = type({
	site_id: 'string',
	email: 'string.email',
	role: "'editor' | 'viewer'"
});

const changeMemberRoleInputSchema = type({
	site_id: 'string',
	user_id: 'string',
	role: "'owner' | 'editor' | 'viewer'"
});

const removeMemberInputSchema = type({
	site_id: 'string',
	user_id: 'string'
});

const revokeInviteInputSchema = type({
	site_id: 'string',
	invite_token: 'string'
});

const transferOwnershipInputSchema = type({
	site_id: 'string',
	to_user_id: 'string'
});

const siteIdInputSchema = type({ site_id: 'string' });

function requireOwner(siteId: string, userId: string): void {
	const member = getSiteMember(siteId, userId);
	if (!member || member.role !== "owner") {
		throw new Error("Only the site owner can do that");
	}
}

function requireMember(siteId: string, userId: string): void {
	const member = getSiteMember(siteId, userId);
	if (!member) throw new Error("Not a member of this site");
}

/** Sites the current user belongs to. */
export const listMySites = query(type('undefined'), async () => {
	const { locals } = getRequestEvent();
	if (!locals.userId) return { ok: false as const, sites: [] };
	return { ok: true as const, sites: listUserSites(locals.userId) };
});

/** Member list + outstanding invites for a site. Owner-only. */
export const listSiteMembers = query(siteIdInputSchema, async ({ site_id }) => {
	const { locals } = getRequestEvent();
	if (!locals.userId) throw new Error("Sign in first");
	requireMember(site_id, locals.userId);
	const site = getSiteCore(site_id);
	if (!site) throw new Error("Site not found");
	return {
		site,
		members: listMembers(site_id),
		invites: listOutstandingInvites(site_id)
	};
});

export const inviteMember = command(inviteMemberInputSchema, async ({ site_id, email, role }) => {
	const { locals, url } = getRequestEvent();
	if (!locals.userId) return createAuthErrorResult("unauthenticated", "Sign in first.");
	requireOwner(site_id, locals.userId);
	const site = getSiteCore(site_id);
	if (!site) return createAuthErrorResult("not_found", "Site not found");
	try {
		const invite = createInvite(site_id, email, role);
		const link = `${url.origin}/auth/invite?token=${encodeURIComponent(invite.invite_token)}`;
		const inviter = locals.userId ? getUser(locals.userId) : null;
		await sendInvite(invite.email, link, site.display_name, inviter?.email ?? null);
		return { ok: true as const, invite_token: invite.invite_token, email: invite.email };
	} catch (err) {
		return createAuthErrorResult("invite_failed", err instanceof Error ? err.message : "Could not invite");
	}
});

export const revokeMemberInvite = command(revokeInviteInputSchema, async ({ site_id, invite_token }) => {
	const { locals } = getRequestEvent();
	if (!locals.userId) return createAuthErrorResult("unauthenticated", "Sign in first.");
	requireOwner(site_id, locals.userId);
	revokeInvite(site_id, invite_token);
	return { ok: true };
});

export const changeMemberRoleCommand = command(changeMemberRoleInputSchema, async ({ site_id, user_id, role }) => {
	const { locals } = getRequestEvent();
	if (!locals.userId) return createAuthErrorResult("unauthenticated", "Sign in first.");
	requireOwner(site_id, locals.userId);
	changeMemberRole(site_id, user_id, role);
	return { ok: true };
});

export const removeMemberCommand = command(removeMemberInputSchema, async ({ site_id, user_id }) => {
	const { locals } = getRequestEvent();
	if (!locals.userId) return createAuthErrorResult("unauthenticated", "Sign in first.");
	// Owners can remove others; anyone can remove themselves.
	if (user_id !== locals.userId) requireOwner(site_id, locals.userId);
	try {
		removeMember(site_id, user_id);
		return { ok: true };
	} catch (err) {
		return createAuthErrorResult("remove_failed", err instanceof Error ? err.message : "Could not remove");
	}
});

export const transferSiteOwnership = command(transferOwnershipInputSchema, async ({ site_id, to_user_id }) => {
	const { locals } = getRequestEvent();
	if (!locals.userId) return createAuthErrorResult("unauthenticated", "Sign in first.");
	try {
		transferOwnership(site_id, locals.userId, to_user_id);
		return { ok: true };
	} catch (err) {
		return createAuthErrorResult("transfer_failed", err instanceof Error ? err.message : "Could not transfer");
	}
});


const issueSiteShortCodeInputSchema = type({
	site_id: 'string',
	'target_path?': 'string | undefined'
});

/**
 * Mint a permanent short code pointing at a (site, path). Any member
 * of the site can issue codes — they're the durable identifier we
 * print on grave markers, so caller-side rate limiting is more
 * appropriate than a hard refusal here.
 */
export const issueSiteShortCode = command(issueSiteShortCodeInputSchema, async ({ site_id, target_path }) => {
	const { locals } = getRequestEvent();
	if (!locals.userId) return createAuthErrorResult('unauthenticated', 'Sign in first.');
	requireMember(site_id, locals.userId);
	const path = target_path && target_path.startsWith('/') ? target_path : '/';
	const issued = issueShortCode(site_id, path);
	return { ok: true as const, short_code: issued };
});


// =============================================================
// Genealogy / family-tree (Phase A — read + minimal CRUD).
// Person records live in the platform DB; ACL grants write access
// to any site owner/editor whose site this person is linked to,
// plus explicit person_access grants.
//
// These handlers compose with `Result<T, AppError>` via neverthrow:
// authentication → per-person ACL check → DB write. The boundary
// adapter `rpcFromResult` turns the Result into the discriminated
// union shape we ship over the wire.
// =============================================================

// arktype's union-of-string-literals syntax wraps in a quoted string;
// keeping these as named symbols lets the genealogy schemas read
// like the underlying type aliases in `people_types.ts`.
const sexT = "'M' | 'F' | 'X' | 'U'";
const parentKindT = "'biological' | 'adoptive' | 'foster' | 'step' | 'unknown'";
const coupleKindT = "'marriage' | 'partnership' | 'engagement' | 'other'";
const coupleEndReasonT = "'divorce' | 'death' | 'annulment' | 'separation'";

// Loose ISO date: YYYY | YYYY-MM | YYYY-MM-DD. arktype's `narrow`
// lets us attach a custom predicate with its own diagnostic.
const isoDate = type('string').narrow(
	(s, ctx) =>
		/^-?\d{4}(-\d{2}(-\d{2})?)?$/.test(s) || ctx.mustBe('an ISO date (YYYY, YYYY-MM, or YYYY-MM-DD)')
);

const createPersonInputSchema = type({
	site_id: 'string',
	display_name: '1 <= string <= 200',
	'given_names?': 'string | null | undefined',
	'surname?': 'string | null | undefined',
	'sex?': `${sexT} | null | undefined`,
	'birth_date?': isoDate.or('null | undefined'),
	'birth_place?': 'string | null | undefined',
	'death_date?': isoDate.or('null | undefined'),
	'death_place?': 'string | null | undefined',
	'is_living?': 'boolean | undefined',
	'biography?': 'string | null | undefined'
});

/**
 * Resolve the signed-in user's id or fail with a uniform
 * `unauthenticated` AppError. Threaded through `.andThen` chains.
 */
function requireUser(userId: string | null | undefined): Result<string, AppError> {
	return userId ? ok(userId) : err(errOf('unauthenticated', 'Sign in first.'));
}

/** Site owner or editor (NOT viewer) can edit site-bound data. */
function requireSiteEdit(siteId: string, userId: string): Result<string, AppError> {
	const member = getSiteMember(siteId, userId);
	return member && (member.role === 'owner' || member.role === 'editor')
		? ok(userId)
		: err(errOf('forbidden', 'Editors and owners only.'));
}

/**
 * The user must have edit access to every listed person. Threads the
 * user id through on success so callers can chain further `.andThen`s.
 */
function requirePeopleEdit(personIds: string[], userId: string): Result<string, AppError> {
	for (const id of personIds) {
		if (!userCanEditPerson(id, userId)) {
			return err(errOf('forbidden', "You don't have edit access to one of those people."));
		}
	}
	return ok(userId);
}

export const createPerson = command(createPersonInputSchema, async (input) => {
	const { locals } = getRequestEvent();
	return rpcFromResult(
		requireUser(locals.userId)
			.andThen((userId) => requireSiteEdit(input.site_id, userId))
			.map((userId) => {
				const person = createPersonCore({
					owner_user_id: userId,
					display_name: input.display_name,
					given_names: input.given_names ?? null,
					surname: input.surname ?? null,
					sex: input.sex ?? null,
					birth_date: input.birth_date ?? null,
					birth_place: input.birth_place ?? null,
					death_date: input.death_date ?? null,
					death_place: input.death_place ?? null,
					is_living: input.is_living,
					biography: input.biography ?? null,
					link_to_site_id: input.site_id
				});
				refreshSiteTreeDoc(input.site_id);
				return { person };
			})
	);
});

const updatePersonInputSchema = type({
	person_id: 'string',
	'display_name?': '(1 <= string <= 200) | undefined',
	'given_names?': 'string | null | undefined',
	'surname?': 'string | null | undefined',
	'sex?': `${sexT} | null | undefined`,
	'birth_date?': isoDate.or('null | undefined'),
	'birth_place?': 'string | null | undefined',
	'death_date?': isoDate.or('null | undefined'),
	'death_place?': 'string | null | undefined',
	'is_living?': 'boolean | undefined',
	'biography?': 'string | null | undefined'
});

export const updatePerson = command(updatePersonInputSchema, async ({ person_id, ...patch }) => {
	const { locals } = getRequestEvent();
	return rpcFromResult(
		requireUser(locals.userId)
			.andThen((userId) => requirePeopleEdit([person_id], userId))
			.map(() => {
				const person = updatePersonCore(person_id, patch);
				refreshTreeDocsForPerson(person_id);
				return { person };
			})
	);
});

const setSiteSubjectInputSchema = type({
	site_id: 'string',
	person_id: 'string | null'
});

export const setSiteSubject = command(setSiteSubjectInputSchema, async ({ site_id, person_id }) => {
	const { locals } = getRequestEvent();
	return rpcFromResult(
		requireUser(locals.userId)
			.andThen((userId) => requireSiteEdit(site_id, userId))
			.andThen((userId) => (person_id ? requirePeopleEdit([person_id], userId) : ok(userId)))
			.map(() => {
				setSiteSubjectCore(site_id, person_id);
				refreshSiteTreeDoc(site_id);
				return {};
			})
	);
});

const addParentInputSchema = type({
	parent_id: 'string',
	child_id: 'string',
	'kind?': `${parentKindT} | undefined`,
	site_id: 'string'
});

export const addParentEdge = command(addParentInputSchema, async ({ parent_id, child_id, kind, site_id }) => {
	const { locals } = getRequestEvent();
	return rpcFromResult(
		requireUser(locals.userId)
			.andThen((userId) => requirePeopleEdit([parent_id, child_id], userId))
			.andThen(() =>
				// Wrap the cycle-check + insert in `Result.fromThrowable`
				// so a self-edge / cycle becomes `Err` instead of an
				// uncaught throw. The error code is stable for the UI.
				Result.fromThrowable(
					() => {
						linkPersonToSite(parent_id, site_id);
						linkPersonToSite(child_id, site_id);
						return addParentEdgeCore({ parent_id, child_id, kind });
					},
					(e) => fromUnknown('edge_failed', e, 'Could not add edge.')
				)()
			)
			.map((edge) => {
				refreshSiteTreeDoc(site_id);
				return { edge };
			})
	);
});

const removeParentInputSchema = type({
	parent_id: 'string',
	child_id: 'string'
});

export const removeParentEdge = command(removeParentInputSchema, async ({ parent_id, child_id }) => {
	const { locals } = getRequestEvent();
	return rpcFromResult(
		requireUser(locals.userId)
			.andThen((userId) => requirePeopleEdit([parent_id, child_id], userId))
			.map(() => {
				removeParentEdgeCore(parent_id, child_id);
				refreshTreeDocsForPerson(parent_id);
				refreshTreeDocsForPerson(child_id);
				return {};
			})
	);
});

const addCoupleInputSchema = type({
	person_a_id: 'string',
	person_b_id: 'string',
	'kind?': `${coupleKindT} | undefined`,
	'start_date?': isoDate.or('null | undefined'),
	'end_date?': isoDate.or('null | undefined'),
	'end_reason?': `${coupleEndReasonT} | null | undefined`,
	site_id: 'string'
});

export const addCouple = command(addCoupleInputSchema, async ({ site_id, ...input }) => {
	const { locals } = getRequestEvent();
	return rpcFromResult(
		requireUser(locals.userId)
			.andThen((userId) => requirePeopleEdit([input.person_a_id, input.person_b_id], userId))
			.map(() => {
				linkPersonToSite(input.person_a_id, site_id);
				linkPersonToSite(input.person_b_id, site_id);
				const couple = createCoupleCore(input);
				refreshSiteTreeDoc(site_id);
				return { couple };
			})
	);
});

const removeCoupleInputSchema = type({
	couple_id: 'string'
});

export const removeCouple = command(removeCoupleInputSchema, async ({ couple_id }) => {
	const { locals } = getRequestEvent();
	// Capture the partners *before* deletion so we know which docs
	// to refresh afterwards. `removeCouple` itself drops the row.
	const couple = getCoupleById(couple_id);
	return rpcFromResult(
		requireUser(locals.userId)
			.andThen((userId) => {
				if (!couple) return err(errOf('not_found', 'Couple not found.'));
				return requirePeopleEdit([couple.person_a_id, couple.person_b_id], userId);
			})
			.map(() => {
				removeCoupleCore(couple_id);
				if (couple) {
					refreshTreeDocsForPerson(couple.person_a_id);
					refreshTreeDocsForPerson(couple.person_b_id);
				}
				return {};
			})
	);
});

const deletePersonInputSchema = type({
	person_id: 'string'
});

export const deletePerson = command(deletePersonInputSchema, async ({ person_id }) => {
	const { locals } = getRequestEvent();
	// Capture site ids *before* deletion — `deletePerson` drops the
	// `person_memorials` rows along with everything else.
	const linkedSiteRows = getPlatformDb()
		.prepare(`SELECT site_id FROM person_memorials WHERE person_id = ?`)
		.all(person_id) as { site_id: string }[];
	return rpcFromResult(
		requireUser(locals.userId)
			.andThen((userId) => requirePeopleEdit([person_id], userId))
			.map(() => {
				deletePersonCore(person_id);
				for (const { site_id } of linkedSiteRows) refreshSiteTreeDoc(site_id);
				return {};
			})
	);
});

const getTreeInputSchema = type({
	site_id: 'string',
	'levels?': '(0 <= number.integer <= 10) | undefined'
});

export const getSiteTree = query(getTreeInputSchema, async ({ site_id, levels }) => {
	const subjectId = getSiteSubjectId(site_id);
	if (!subjectId) {
		return { ok: false as const, code: 'no_subject', message: 'No subject person set for this site.' };
	}
	const tree = getTreeRootedAt(subjectId, levels ?? 4);
	return { ok: true as const, tree };
});

export const getPersonRecord = query(type('string'), async (personId) => {
	const person = getPersonCore(personId);
	if (!person) return { ok: false as const, code: 'not_found', message: 'Person not found.' };
	return { ok: true as const, person };
});

// ---------------------------------------------------------------
// GEDCOM 7 import.
// The client parses the .ged file (via `$lib/gedcom.js` —
// browser-safe, no node imports) and posts the structured
// `ParsedGedcom` here. The server re-validates the shape, then
// runs `importParsedGedcom` in a single transaction.
// ---------------------------------------------------------------

const gedcomIndividualSchema = type({
	xref: 'string',
	display_name: 'string',
	'given_names?': 'string | null | undefined',
	'surname?': 'string | null | undefined',
	sex: "'M' | 'F' | 'X' | 'U'",
	'birth_date?': 'string | null | undefined',
	'birth_place?': 'string | null | undefined',
	'death_date?': 'string | null | undefined',
	'death_place?': 'string | null | undefined',
	'biography?': 'string | null | undefined',
	is_living: 'boolean'
});

const gedcomFamilySchema = type({
	xref: 'string',
	'partner_a_xref?': 'string | null | undefined',
	'partner_b_xref?': 'string | null | undefined',
	children_xrefs: 'string[]',
	'marr_date?': 'string | null | undefined',
	'marr_place?': 'string | null | undefined',
	'div_date?': 'string | null | undefined'
});

const importGedcomInputSchema = type({
	site_id: 'string',
	parsed: type({
		individuals: gedcomIndividualSchema.array(),
		families: gedcomFamilySchema.array()
	})
});

export const importGedcom = command(importGedcomInputSchema, async ({ site_id, parsed }) => {
	const { locals } = getRequestEvent();
	return rpcFromResult(
		requireUser(locals.userId)
			.andThen((userId) => requireSiteEdit(site_id, userId))
			.andThen((userId) =>
				Result.fromThrowable(
					() => importParsedGedcom(parsed, site_id, userId),
					(e) => fromUnknown('import_failed', e, 'Could not import GEDCOM.')
				)()
			)
			.map((result) => {
				refreshSiteTreeDoc(site_id);
				return { result };
			})
	);
});

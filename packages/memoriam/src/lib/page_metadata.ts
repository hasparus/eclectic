import { ASSET_BASE } from '$lib/config.js';
import { collectNodeIdsInOrder } from '$lib/document_graph.js';

// Shared helpers for extracting page-level metadata from a page
// document.

export interface PreviewMediaNode {
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

export interface PageMetadata {
	title: string;
	description: string | null;
	preview_media_node: PreviewMediaNode | null;
}

interface PageDoc {
	document_id: string;
	nodes: Record<string, any>;
}

interface AnnotatedText {
	text?: string;
}

export function extractPlainText(annotatedText: AnnotatedText | null | undefined): string {
	if (!annotatedText || typeof annotatedText.text !== 'string') return '';
	return annotatedText.text.trim();
}

export function collectPageBodyNodeIds(pageDoc: PageDoc | null | undefined): string[] {
	if (!pageDoc?.document_id || !pageDoc.nodes) {
		return [];
	}

	const pageRoot = pageDoc.nodes[pageDoc.document_id];

	if (!pageRoot?.body || !Array.isArray(pageRoot.body)) {
		return [pageDoc.document_id];
	}

	const bodyNodeIds: string[] = [pageDoc.document_id];
	const seenIds = new Set(bodyNodeIds);

	for (const childId of pageRoot.body) {
		const subtreeIds = collectNodeIdsInOrder(childId, pageDoc.nodes);
		for (const subtreeId of subtreeIds) {
			if (seenIds.has(subtreeId)) continue;
			seenIds.add(subtreeId);
			bodyNodeIds.push(subtreeId);
		}
	}

	return bodyNodeIds;
}

export function extractPageMetadata(pageDoc: PageDoc | null | undefined): PageMetadata {
	if (!pageDoc?.document_id || !pageDoc.nodes) {
		return {
			title: 'Editable Website',
			description: null,
			preview_media_node: null
		};
	}

	const bodyNodeIds = collectPageBodyNodeIds(pageDoc);
	const pageRoot = pageDoc.nodes[pageDoc.document_id];
	const explicitImageNode: PreviewMediaNode | null =
		typeof pageRoot?.image === 'string' ? pageDoc.nodes[pageRoot.image] ?? null : null;

	const explicitTitle = extractPlainText(pageRoot?.title);
	const explicitDescription = extractPlainText(pageRoot?.description);
	let headingTitle = '';
	let fallbackTitle = '';
	let fallbackDescription = '';
	let firstImageNode: PreviewMediaNode | null = null;
	let firstVideoNode: PreviewMediaNode | null = null;

	for (const nodeId of bodyNodeIds) {
		const node = pageDoc.nodes[nodeId];
		if (!node) continue;

		if (!firstImageNode && node.type === 'image') {
			firstImageNode = node;
		} else if (!firstVideoNode && node.type === 'video') {
			firstVideoNode = node;
		}

		if (node.type === 'text') {
			const text = extractPlainText(node.content);
			if (!text) continue;

			if (!headingTitle && (node.layout === 2 || node.layout === 3 || node.layout === 4)) {
				headingTitle = text;
			}

			if (!fallbackTitle) {
				fallbackTitle = text;
			}

			if (!fallbackDescription) {
				fallbackDescription = text;
			}
		}

		if (node.type === 'hero') {
			const heroTitle = extractPlainText(node.title);
			if (!fallbackTitle && heroTitle) {
				fallbackTitle = heroTitle;
			}

			const heroDescription = extractPlainText(node.description);
			if (!fallbackDescription && heroDescription) {
				fallbackDescription = heroDescription;
			}
		}

		if (node.type === 'link_collection_item') {
			const itemTitle = extractPlainText(node.title);
			if (!fallbackTitle && itemTitle) {
				fallbackTitle = itemTitle;
			}

			const itemDescription = extractPlainText(node.description);
			if (!fallbackDescription && itemDescription) {
				fallbackDescription = itemDescription;
			}
		}
	}

	const previewMediaNode =
		explicitImageNode?.type === 'image' && explicitImageNode.src
			? explicitImageNode
			: firstImageNode || firstVideoNode;

	return {
		title: explicitTitle || headingTitle || fallbackTitle || 'Untitled page',
		description: explicitDescription || fallbackDescription || null,
		preview_media_node: previewMediaNode
	};
}

export function getMediaAssetUrl(mediaNode: PreviewMediaNode | null | undefined): string | null {
	if (!mediaNode?.src) return null;
	return `${ASSET_BASE}/${mediaNode.src}`;
}

export function getHeadMetadata(pageDoc: PageDoc | null | undefined): PageMetadata {
	return extractPageMetadata(pageDoc);
}

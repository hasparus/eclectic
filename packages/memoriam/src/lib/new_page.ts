import nanoid from '../routes/nanoid.js';
import { MEDIA_DEFAULTS } from '$lib/config.js';

interface SharedDoc {
	document_id: string;
	nodes: Record<string, any>;
}

interface SharedDocuments {
	nav_document: SharedDoc;
	footer_document: SharedDoc;
}

interface NewPageDocument {
	document_id: string;
	nodes: Record<string, any>;
}

/**
 * Create a new unsaved page document for the `/new` route.
 *
 * The page id is generated on the client up front and used for both:
 * - the document's `document_id`
 * - the root page node's `id`
 *
 * The shared nav / footer nodes are provided by the server so the new
 * page is composed from the current database-backed shared documents
 * rather than the demo seed data.
 */
export function createEmptyDoc(sharedDocuments: SharedDocuments): NewPageDocument {
	const pageId = nanoid();
	const pageImageId = nanoid();
	const proseId = nanoid();
	const headingId = nanoid();
	const paragraphId = nanoid();

	const navDocument = sharedDocuments?.nav_document;
	const footerDocument = sharedDocuments?.footer_document;

	if (!navDocument?.document_id || !navDocument?.nodes) {
		throw new Error('Missing nav document for new page creation');
	}

	if (!footerDocument?.document_id || !footerDocument?.nodes) {
		throw new Error('Missing footer document for new page creation');
	}

	return {
		document_id: pageId,
		nodes: {
			...structuredClone(navDocument.nodes),
			...structuredClone(footerDocument.nodes),
			[pageId]: {
				id: pageId,
				type: 'page',
				title: {
					text: '',
					annotations: []
				},
				description: {
					text: '',
					annotations: []
				},
				image: pageImageId,
				nav: navDocument.document_id,
				footer: footerDocument.document_id,
				body: [proseId]
			},
			[pageImageId]: {
				id: pageImageId,
				type: 'image',
				...MEDIA_DEFAULTS
			},
			[proseId]: {
				id: proseId,
				type: 'prose',
				layout: 1,
				colorset: 0,
				content: [headingId, paragraphId]
			},
			[headingId]: {
				id: headingId,
				type: 'text',
				layout: 2,
				content: {
					text: '',
					annotations: []
				}
			},
			[paragraphId]: {
				id: paragraphId,
				type: 'text',
				layout: 1,
				content: {
					text: '',
					annotations: []
				}
			}
		}
	};
}

import { describe, it, expect } from 'vitest';
import { constantTimeEqual } from '../src/lib/server/auth.js';

describe('constantTimeEqual', () => {
	it('returns true for identical strings', () => {
		expect(constantTimeEqual('hunter2', 'hunter2')).toBe(true);
	});

	it('returns false for different same-length strings', () => {
		expect(constantTimeEqual('hunter2', 'hunter3')).toBe(false);
	});

	it('returns false for strings of different lengths', () => {
		expect(constantTimeEqual('hunter', 'hunter2')).toBe(false);
		expect(constantTimeEqual('hunter2', 'hunter')).toBe(false);
	});

	it('returns true for two empty strings', () => {
		expect(constantTimeEqual('', '')).toBe(true);
	});

	it('handles unicode correctly', () => {
		expect(constantTimeEqual('café', 'café')).toBe(true);
		expect(constantTimeEqual('café', 'cafe')).toBe(false);
	});
});

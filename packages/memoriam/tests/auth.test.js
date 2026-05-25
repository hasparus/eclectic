import { describe, it, expect } from 'vitest';
import { constant_time_equal } from '../src/lib/server/auth.js';

describe('constant_time_equal', () => {
	it('returns true for identical strings', () => {
		expect(constant_time_equal('hunter2', 'hunter2')).toBe(true);
	});

	it('returns false for different same-length strings', () => {
		expect(constant_time_equal('hunter2', 'hunter3')).toBe(false);
	});

	it('returns false for strings of different lengths', () => {
		expect(constant_time_equal('hunter', 'hunter2')).toBe(false);
		expect(constant_time_equal('hunter2', 'hunter')).toBe(false);
	});

	it('returns true for two empty strings', () => {
		expect(constant_time_equal('', '')).toBe(true);
	});

	it('handles unicode correctly', () => {
		expect(constant_time_equal('café', 'café')).toBe(true);
		expect(constant_time_equal('café', 'cafe')).toBe(false);
	});
});

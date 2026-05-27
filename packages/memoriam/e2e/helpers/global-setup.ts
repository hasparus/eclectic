import { rmSync } from 'node:fs';

/**
 * Wipe the e2e data directory before the suite starts. Each test
 * creates the users / sites it needs from scratch — no shared
 * fixtures, so isolation comes from unique random emails per test
 * rather than a snapshot reset between tests.
 */
export default function globalSetup(): void {
	const dataDir = process.env.MEMORIAM_E2E_DATA_DIR;
	if (!dataDir) {
		throw new Error('MEMORIAM_E2E_DATA_DIR must be set before globalSetup runs');
	}
	rmSync(dataDir, { recursive: true, force: true });
}

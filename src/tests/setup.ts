// Vitest global setup: silence node:sqlite experimental warnings so test
// output stays readable. Per-file tmp data dirs are configured by each
// server test via configureWikiPaths().
const origEmit = process.emitWarning;
process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
	if (typeof warning === 'string' && warning.includes('SQLite')) return;
	return (origEmit as (...a: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;

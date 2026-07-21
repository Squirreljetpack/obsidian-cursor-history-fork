import { HistoryEntry, EditHistoryEntry, PreviewHistoryEntry } from './navigation-stack';

export enum CompareResult {
	IDENTICAL,
	SIMILAR,
	DIFFERENT,
}

export function compareEditSelections(
	a: EditHistoryEntry['selection'],
	b: EditHistoryEntry['selection'],
	jumpThreshold = 10
): CompareResult {
	const lineA = Math.min(a.startLine, a.endLine);
	const lineB = Math.min(b.startLine, b.endLine);

	if (lineA === lineB) return CompareResult.IDENTICAL;
	if (Math.abs(lineA - lineB) < jumpThreshold) return CompareResult.SIMILAR;
	return CompareResult.DIFFERENT;
}

export function comparePreviewSelections(
	a: PreviewHistoryEntry['selection'],
	b: PreviewHistoryEntry['selection'],
	jumpThreshold = 10
): CompareResult {
	if (a.scrollLine === b.scrollLine || Math.abs(a.scrollTop - b.scrollTop) < 10) {
		return CompareResult.IDENTICAL;
	}
	if (Math.abs(a.scrollLine - b.scrollLine) < jumpThreshold) {
		return CompareResult.SIMILAR;
	}
	return CompareResult.DIFFERENT;
}

export function shouldCreateNewEntry(
	current: HistoryEntry | null,
	incoming: HistoryEntry,
	isJump = false,
	jumpThreshold = 10
): boolean {
	if (!current) return true;
	if (current.filePath !== incoming.filePath) return true;
	if (current.mode !== incoming.mode) return true;

	if (current.mode === 'edit' && incoming.mode === 'edit') {
		const result = compareEditSelections(current.selection, incoming.selection, jumpThreshold);
		if (result === CompareResult.SIMILAR && isJump) return true;
		return result === CompareResult.DIFFERENT;
	} else if (current.mode === 'preview' && incoming.mode === 'preview') {
		const result = comparePreviewSelections(current.selection, incoming.selection, jumpThreshold);
		if (result === CompareResult.SIMILAR && isJump) return true;
		return result === CompareResult.DIFFERENT;
	}

	return true;
}

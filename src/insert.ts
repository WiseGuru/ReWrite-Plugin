import { App, MarkdownView, moment, normalizePath, Notice, TFile } from 'obsidian';
import { NoteTemplate } from './types';

export type InsertStage = 'cursor' | 'newFile' | 'append';

export interface InsertParams {
	app: App;
	template: NoteTemplate;
	content: string;
}

export interface InsertResult {
	mode: InsertStage;
	path?: string;
}

export async function insertOutput(params: InsertParams): Promise<InsertResult> {
	switch (params.template.insertMode) {
		case 'cursor':
			return insertAtCursor(params);
		case 'newFile':
			return insertNewFile(params);
		case 'append':
			return insertAppend(params);
	}
}

async function insertAtCursor(params: InsertParams): Promise<InsertResult> {
	const view = params.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		new Notice('No active editor; appending to the last edited note instead.');
		return insertAppend(params);
	}
	view.editor.replaceSelection(params.content);
	return { mode: 'cursor', path: view.file?.path };
}

async function insertAppend(params: InsertParams): Promise<InsertResult> {
	const view = params.app.workspace.getActiveViewOfType(MarkdownView);
	let file: TFile | null = view?.file ?? null;
	if (!file) {
		file = findLastEditedMarkdown(params.app);
	}
	if (!file) {
		new Notice('No note is open. Creating a new note.');
		return insertNewFile(params);
	}
	const existing = await params.app.vault.read(file);
	const needsBlankLine = existing.length > 0 && !existing.endsWith('\n\n');
	const separator = existing.length === 0 ? '' : needsBlankLine ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
	await params.app.vault.modify(file, existing + separator + params.content);
	return { mode: 'append', path: file.path };
}

async function insertNewFile(params: InsertParams): Promise<InsertResult> {
	const folder = params.template.newFileFolder.trim();
	const nameTemplate = params.template.newFileNameTemplate.trim() || 'ReWrite {{date}} {{time}}';
	const expanded = expandFilenameTemplate(nameTemplate);
	const filename = expanded.endsWith('.md') ? expanded : `${expanded}.md`;
	if (folder) {
		await ensureFolder(params.app, folder);
	}
	const path = normalizePath(folder ? `${folder}/${filename}` : filename);
	const file = await params.app.vault.create(path, params.content);
	await params.app.workspace.openLinkText(file.path, '', true);
	return { mode: 'newFile', path: file.path };
}

function expandFilenameTemplate(template: string): string {
	const now = moment();
	return template
		.replace(/\{\{date\}\}/g, now.format('YYYY-MM-DD'))
		.replace(/\{\{time\}\}/g, now.format('HHmmss'));
}

function findLastEditedMarkdown(app: App): TFile | null {
	const files = app.vault.getMarkdownFiles();
	let best: TFile | null = null;
	let bestMtime = -1;
	for (const f of files) {
		if (f.stat.mtime > bestMtime) {
			bestMtime = f.stat.mtime;
			best = f;
		}
	}
	return best;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const normalized = normalizePath(folder);
	if (app.vault.getAbstractFileByPath(normalized)) return;
	const parts = normalized.split('/');
	let current = '';
	for (const part of parts) {
		if (!part) continue;
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}

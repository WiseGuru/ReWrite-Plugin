import { NoteTemplate } from '../types';

const DEFAULT_TEMPLATES: NoteTemplate[] = [
	{
		id: 'tpl-default-general-cleanup',
		name: 'General cleanup',
		prompt:
			'You are a transcription editor. Clean up the voice transcript: '
			+ 'fix grammar and punctuation, remove filler words ("um", "uh", "like", '
			+ '"you know"), false starts, and self-corrections, and produce natural-sounding '
			+ 'written prose. Preserve the original meaning, structure, and approximate length. '
			+ 'Return only the cleaned transcript with no preamble, commentary, or markdown code fences.',
		insertMode: 'cursor',
		newFileFolder: '',
		newFileNameTemplate: 'ReWrite {{date}} {{time}}',
	},
	{
		id: 'tpl-default-todo-list',
		name: 'Todo list',
		prompt:
			'You are a task extractor. Read the voice transcript and produce a markdown '
			+ 'checkbox list of every actionable task mentioned, using "- [ ] " for each item. '
			+ 'When the transcript covers multiple topics, group related items under "##" '
			+ 'subheadings; otherwise emit a flat list. Keep task descriptions concise but '
			+ 'specific (include the "what" and any explicit owner or due date). Do not invent '
			+ 'tasks that were not spoken. Return only the list with no preamble or commentary.',
		insertMode: 'cursor',
		newFileFolder: '',
		newFileNameTemplate: 'ReWrite {{date}} {{time}}',
	},
	{
		id: 'tpl-default-daily-note',
		name: 'Daily note',
		prompt:
			'You are a daily-journal organizer. Restructure the voice transcript into a daily '
			+ 'note using "##" headings in this order, including a heading only when the '
			+ 'transcript actually covers it: Goals, Notes, Meals, Dreams. Under each heading, '
			+ "format content as natural prose or bullet points, whichever fits better. Fix grammar "
			+ "and remove filler words but preserve the speaker's voice. Return only the formatted "
			+ 'note with no preamble or commentary.',
		insertMode: 'newFile',
		newFileFolder: 'Daily Notes',
		newFileNameTemplate: '{{date}}',
	},
	{
		id: 'tpl-default-meeting-notes',
		name: 'Meeting notes',
		prompt:
			'You are a meeting-minutes formatter. Restructure the transcript into meeting notes '
			+ 'using these "##" sections (omit a section if nothing in the transcript applies): '
			+ 'Attendees, Summary, Action Items, Decisions. Format Action Items as a markdown '
			+ 'checkbox list ("- [ ] ") including the owner when one was stated. Keep Summary to '
			+ '2-4 sentences. Return only the formatted notes with no preamble or commentary.',
		insertMode: 'newFile',
		newFileFolder: 'Meetings',
		newFileNameTemplate: 'Meeting {{date}} {{time}}',
	},
	{
		id: 'tpl-default-idea-capture',
		name: 'Idea capture',
		prompt:
			'You are an idea archivist. Preserve the raw ideas from the transcript faithfully: '
			+ 'fix only grammar, punctuation, and filler words. Do not summarize, abridge, '
			+ 'reorder, or invent connections between ideas. Prepend a single one-sentence '
			+ 'summary of the core idea at the very top, followed by a blank line, then the '
			+ 'cleaned transcript. Return only that output with no preamble or commentary.',
		insertMode: 'append',
		newFileFolder: '',
		newFileNameTemplate: 'Idea {{date}} {{time}}',
	},
];

export function freshDefaultTemplates(): NoteTemplate[] {
	return DEFAULT_TEMPLATES.map((t) => ({ ...t }));
}

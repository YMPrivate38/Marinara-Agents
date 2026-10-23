## 0.9.0 — 2026-10-22
- Added: Agents in Author controls. Pick installed agents to run after every chapter, up to five. Checkers such as Continuity Checker, Prose Guardian and Fanfic Writer rewrite the chapter when they find problems. Trackers such as Character Tracker and World State keep notes that the author reads before the next chapter. Fanfic Writer replaces the built-in out-of-character check when you pick it. Each agent adds one model call per chapter.

## 0.8.0 — 2026-10-22
- Added: Story Writer now looks like the rest of the app and follows your theme. The Hide spoilers button sits above the spoilers.
- Added: Author controls on the New story form and in the reader: pick one of your prompt presets as a style guide, start from a character's first message or an alternate greeting, choose how many twists the author may add (None, Rare or Free, Rare by default), and turn the out-of-character check on or off with its score and rewrite limits. Presets are used as story style guides, with {{char}} and {{user}} filled in.
- Added: searchable pickers for characters and lorebooks instead of a long checklist.
- Fixed: character cards were mostly ignored. The plan is now built from your characters and lorebook, long card fields are no longer cut at 1,500 characters, and example dialogue is used.
- Changed: the author no longer ends every chapter on a cliffhanger and no longer invents twists, new threats or new characters unless you allow it.

## 0.7.0 — 2026-10-22
- Changed: Export EPUB now builds the book from your story's chapters. Story Writer no longer touches your chats, and it no longer asks for permission to read chats, add prompt text or run agents.
- Removed: the old Story Plan Keeper agent. The plan is now updated by Story Writer itself after each chapter.

## 0.6.0 — 2026-10-22
- Changed: Story Writer is now a reader instead of a chat. Pick a story from your shelf, press Write next chapter (or write up to 20 in a row), watch the progress, and read the chapters here. Each chapter in the list shows a spoiler-free teaser. The hidden plan stays hidden until you press Reveal spoilers.

## 0.5.0 — 2026-10-22
- Added: stories no longer need a chat. The server can now write a story chapter by chapter on its own (one chapter or up to 20 in a row), check each chapter for out-of-character writing and nonsense and rewrite it when it is bad, and update the hidden plan and the next beat. Each chapter also gets a spoiler-free teaser. The screens for this come in the next update.

## 0.4.0 — 2026-10-22
- Added: The New story form and the Plan panel now set chapter length (300-8000 words), point of view and tense. Every reply in a story is asked to be one complete chapter in that style, ending on a natural chapter break, with no extra model call. These settings are not spoilers, so the Plan panel shows them even while spoilers are hidden.
- Changed: Fanfic Writer is now the checker for out-of-character writing, so new stories get it as a quality check instead of a chapter planner.

## 0.3.0 — 2026-10-22
- Added: Each story now has a hidden plan (outline, secrets, twists, offscreen events, open threads, next beat). The new Story Plan Keeper agent updates it after every chapter, and the writer only ever receives the next beat. The New story form takes a premise and drafts the plan; the Plan button on each story shows it, with spoilers hidden until you choose Reveal spoilers. Needs the new prompt-context and agent-runtime permissions.

## 0.2.0 — 2026-10-22
- Added: Each story in the bookshelf has an Export EPUB button. It downloads the story as an EPUB 3 book, one chapter per author message, titled by the first heading when there is one. Needs the new chat-read permission.

## 0.1.0 — 2026-10-22
- Added: Story Writer is now a bookshelf. It lists your stories with an Open button, and a New story form (title, connection, optional character) creates a roleplay chat marked as a story with the Fanfic Writer agent switched on when it is installed. The install-check counter is gone.

## 0.0.1 — 2026-10-22
- Added: Story Writer appears as a Home tab. This first build only checks that the install works: it shows a button that stores a counter on the server.

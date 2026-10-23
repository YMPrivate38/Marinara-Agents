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

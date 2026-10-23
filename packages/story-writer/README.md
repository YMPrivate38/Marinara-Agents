# Story Writer

Serial fiction written in chapters by an author who knows things you don't. Install it, restart Marinara Engine when prompted, then open Home → Story Writer.

- **New story:** a title, an optional premise, optional characters and lorebooks, a connection, and how long each chapter is (words), the point of view and the tense.
- **Write next chapter**, or write up to 20 in a row. For each chapter Story Writer writes it, checks the characters stay in character and the events make sense, rewrites it when they do not (up to twice), then updates its hidden plan and picks what happens next.
- **Hidden plan:** outline, secrets, twists, offscreen activity and open threads. The writer is only ever told the next beat. The plan stays hidden until you press Reveal spoilers.
- **Chapter list:** each chapter shows a spoiler-free teaser. Read a chapter in the page.
- **Export EPUB** for your e-reader.

One model call is limited by the Engine's `AGENT_CALL_TIMEOUT_MS` (5 minutes by default). If a long chapter times out, raise it in the Engine's `.env` or shorten the chapter.

# Pull request

## Summary

<!-- One or two sentences. What changes, and why? -->

## Track / file ownership

<!-- Which ownership track does this PR sit in? If it spans tracks, list each and tag the
     owners. See docs/development.md for the full map. -->

- Track:

## Checklist

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes (unit + conformance + e2e).
- [ ] `npm run format` was run; no diff after.
- [ ] Tests added or updated for new behavior.
- [ ] If handlers changed, the **spec snapshot** in `spec/` still matches (re-snapshot if not).
- [ ] If a new MCP tool was added, `src/shared/tool-index.ts` is updated and
      `tests/unit/tool-count.test.ts` is bumped.
- [ ] Docs updated where relevant: [docs/mcp-tools.md](../docs/mcp-tools.md),
      [docs/slash-commands.md](../docs/slash-commands.md), [docs/architecture.md](../docs/architecture.md).
- [ ] No edits to files outside the declared track without a callout.

## How to test

<!-- Steps a reviewer can follow to verify behavior locally. -->

## Notes

<!-- Anything else worth flagging — design tradeoffs, follow-ups, screenshots, etc. -->

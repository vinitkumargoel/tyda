import React from "react";
import { Box } from "ink";

/**
 * Placeholder slot for a pinned tracker panel above the transcript.
 *
 * Track I will render the real ticking tracker; for Wave 1 we just
 * render whatever node the caller hands us. Renders nothing when the
 * `tracker` prop is null/undefined.
 */
export interface PinnedTrackerProps {
  tracker?: React.ReactNode | null;
}

export function PinnedTracker({ tracker }: PinnedTrackerProps): React.ReactElement | null {
  if (!tracker) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {tracker}
    </Box>
  );
}

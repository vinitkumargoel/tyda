import { loadState } from "../../store.js";
import { readSavedLocations } from "./_helpers.js";
import type { Response } from "../../../shared/response.js";
import type { SavedLocation } from "./_types.js";

export type GetSavedLocationsResult = Response<{ locations: SavedLocation[] }>;

export async function getSavedLocations(
  _args: Record<string, unknown>,
): Promise<GetSavedLocationsResult> {
  const state = await loadState();
  const locations = readSavedLocations(state);
  return {
    success: true,
    data: { locations },
    message: `Found ${locations.length} saved location(s).`,
  };
}

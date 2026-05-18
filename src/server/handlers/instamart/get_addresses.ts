import { mutate } from "../../store.js";
import type { OkResponse } from "../../../shared/response.js";
import type { InstamartAddress } from "./_types.js";

export async function getAddresses(): Promise<
  OkResponse<{ addresses: InstamartAddress[] }>
> {
  let addresses: InstamartAddress[] = [];
  await mutate((s) => {
    addresses = [...s.addresses.instamart];
  });
  return {
    success: true,
    data: { addresses },
    message: `Found ${addresses.length} saved Instamart address(es).`,
  };
}

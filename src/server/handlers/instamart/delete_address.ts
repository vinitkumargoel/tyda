import { mutate } from "../../store.js";
import type { OkResponse, ErrResponse } from "../../../shared/response.js";

export async function deleteAddress(args: {
  addressId: string;
}): Promise<OkResponse<{ addressId: string }> | ErrResponse> {
  let found = false;
  await mutate((s) => {
    const before = s.addresses.instamart.length;
    s.addresses.instamart = s.addresses.instamart.filter(
      (a) => a.id !== args.addressId,
    );
    found = s.addresses.instamart.length < before;
  });
  if (!found) {
    return {
      success: false,
      error: {
        code: "ADDRESS_NOT_FOUND",
        message: `No address found with id ${args.addressId}`,
      },
    };
  }
  return {
    success: true,
    data: { addressId: args.addressId },
    message: "Address removed.",
  };
}

import * as crypto from "node:crypto";
import { mutate } from "../../store.js";
import type { OkResponse, ErrResponse } from "../../../shared/response.js";
import type { InstamartAddress } from "./_types.js";

export interface CreateAddressInput {
  fullAddress?: string;
  addressLine?: string;
  addressLine2?: string;
  locality?: string;
  city?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  addressCategory?: string;
  addressTag?: string;
  userName?: string;
  userPhone?: string;
  receiverName?: string;
  receiverPhone?: string;
  // Legacy / TUI convenience aliases per track spec.
  flatNo?: string;
  line1?: string;
  area?: string;
  lat?: number;
  lng?: number;
  contactName?: string;
  contactPhone?: string;
}

function rid(): string {
  return `addr_${crypto.randomBytes(8).toString("hex")}`;
}

export async function createAddress(
  args: CreateAddressInput,
): Promise<OkResponse<{ address: InstamartAddress }> | ErrResponse> {
  // Tolerate both the spec shape and the convenience shape from the task brief.
  const line1 = args.addressLine ?? args.line1 ?? "";
  const flatNo = args.flatNo ?? args.addressLine2 ?? "";
  const area = args.area ?? args.locality ?? "";
  const city = args.city ?? "";
  const lat = args.latitude ?? args.lat ?? 0;
  const lng = args.longitude ?? args.lng ?? 0;
  const contactName = args.contactName ?? args.userName ?? "Guest";
  const contactPhone = args.contactPhone ?? args.userPhone ?? "";
  const addressCategory = args.addressCategory ?? "HOME";

  if (!line1 || !city) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "addressLine and city are required to create an address",
      },
    };
  }

  const newAddress: InstamartAddress = {
    id: rid(),
    flatNo,
    line1,
    line2: args.addressLine2 ?? "",
    locality: args.locality,
    area,
    city,
    postalCode: args.postalCode ?? "",
    addressCategory,
    addressTag: args.addressTag,
    lat,
    lng,
    contactName,
    contactPhone,
    receiverName: args.receiverName,
    receiverPhone: args.receiverPhone,
    createdAt: Date.now(),
  };

  await mutate((s) => {
    s.addresses.instamart.push(newAddress);
  });

  return {
    success: true,
    data: { address: newAddress },
    message: `Saved ${addressCategory} address for Instamart.`,
  };
}

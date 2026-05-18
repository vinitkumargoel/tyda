/**
 * Concrete Instamart-domain shapes. Imported by the store so the persisted
 * state has accurate types, and by the handlers.
 */

export interface InstamartAddress {
  id: string;
  flatNo: string;
  line1: string;
  line2: string;
  locality?: string;
  area: string;
  city: string;
  postalCode: string;
  addressCategory: string;
  addressTag?: string;
  lat: number;
  lng: number;
  contactName: string;
  contactPhone: string;
  receiverName?: string;
  receiverPhone?: string;
  createdAt: number;
}

export interface ProductVariant {
  spinId: string;
  label: string;
  price: number;
  stock: number;
}

export interface Product {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  variants: ProductVariant[];
  imageUrl: string | null;
  veg: boolean;
}

export interface InstamartCartItem {
  spinId: string;
  productId: string;
  name: string;
  brand: string | null;
  category: string;
  variantLabel: string;
  price: number;
  quantity: number;
}

export interface InstamartCart {
  addressId: string | null;
  items: InstamartCartItem[];
  updatedAt: number;
}

export interface InstamartBill {
  subtotal: number;
  deliveryFee: number;
  handlingFee: number;
  discount: number;
  total: number;
  appliedCoupon: string | null;
}

export interface InstamartOrderItemSnapshot {
  spinId: string;
  productId: string;
  name: string;
  variantLabel: string;
  price: number;
  quantity: number;
}

export interface InstamartOrder {
  id: string;
  addressId: string;
  items: InstamartOrderItemSnapshot[];
  bill: InstamartBill;
  paymentMethod: string;
  placedAt: number;
  etaMinutes: number;
  state: "PLACED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  stateStartedAt: number;
  speed: "fast" | "real";
  deliveryLat: number;
  deliveryLng: number;
  driverLat: number;
  driverLng: number;
  driverName: string;
}

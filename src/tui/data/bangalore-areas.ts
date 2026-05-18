/**
 * Curated lookup table of common Bangalore neighborhoods.
 *
 * Used by the `/address` slash flow (Track J) to:
 *  - Power the first-run picker when a user has no saved address.
 *  - Resolve `lat`/`lng` for `/address add "<line>, <area>, Bangalore"`.
 *
 * Coordinates are accurate to within ~0.01° of the named landmark; they're
 * intended for demo / sim purposes, not for navigation.
 */

export interface BangaloreArea {
  slug: string;
  name: string;
  pincode: string;
  lat: number;
  lng: number;
}

export const BANGALORE_AREAS: BangaloreArea[] = [
  {
    slug: "koramangala",
    name: "Koramangala 4th Block",
    pincode: "560034",
    lat: 12.9352,
    lng: 77.6245,
  },
  {
    slug: "indiranagar",
    name: "Indiranagar",
    pincode: "560038",
    lat: 12.9719,
    lng: 77.6412,
  },
  {
    slug: "hsr",
    name: "HSR Layout",
    pincode: "560102",
    lat: 12.9116,
    lng: 77.6473,
  },
  {
    slug: "whitefield",
    name: "Whitefield",
    pincode: "560066",
    lat: 12.9698,
    lng: 77.7499,
  },
  {
    slug: "jayanagar",
    name: "Jayanagar 4th Block",
    pincode: "560011",
    lat: 12.9250,
    lng: 77.5938,
  },
  {
    slug: "basavanagudi",
    name: "Basavanagudi",
    pincode: "560004",
    lat: 12.9423,
    lng: 77.5736,
  },
  {
    slug: "btm",
    name: "BTM Layout",
    pincode: "560029",
    lat: 12.9166,
    lng: 77.6101,
  },
  {
    slug: "marathahalli",
    name: "Marathahalli",
    pincode: "560037",
    lat: 12.9591,
    lng: 77.6974,
  },
  {
    slug: "sarjapur",
    name: "Sarjapur Road",
    pincode: "560035",
    lat: 12.9010,
    lng: 77.6874,
  },
  {
    slug: "mg-road",
    name: "MG Road",
    pincode: "560001",
    lat: 12.9756,
    lng: 77.6066,
  },
  {
    slug: "residency-road",
    name: "Residency Road",
    pincode: "560025",
    lat: 12.9684,
    lng: 77.6010,
  },
  {
    slug: "electronic-city",
    name: "Electronic City",
    pincode: "560100",
    lat: 12.8452,
    lng: 77.6602,
  },
];

/**
 * Case-insensitive lookup against an area's slug, full name, or first word
 * of the name. Returns undefined if no area matches.
 */
export function findArea(slugOrName: string): BangaloreArea | undefined {
  const needle = slugOrName.trim().toLowerCase();
  if (!needle) return undefined;

  for (const area of BANGALORE_AREAS) {
    if (area.slug.toLowerCase() === needle) return area;
    if (area.name.toLowerCase() === needle) return area;
    const firstWord = area.name.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (firstWord && firstWord === needle) return area;
  }
  return undefined;
}

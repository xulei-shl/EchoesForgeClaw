/** Blobatar 2's silhouette bands, shared by the landing page and editor. */

export type Shape =
  | "round"
  | "organic"
  | "boxy"
  | "capsule"
  | "nub"
  | "cloud"
  | "droplet"
  | "hexagon"
  | "sun"
  | "triangle";

export interface ShapeOption {
  name: Shape;
  /** The position in [0, 1) that selects it. */
  at: number;
}

/** Midpoints are copied deliberately so a package band change cannot hide. */
export const SHAPES: ShapeOption[] = [
  { name: "round", at: 0.11 },
  { name: "organic", at: 0.35 },
  { name: "boxy", at: 0.54 },
  { name: "capsule", at: 0.65 },
  { name: "nub", at: 0.745 },
  { name: "cloud", at: 0.825 },
  { name: "droplet", at: 0.888 },
  { name: "hexagon", at: 0.933 },
  { name: "sun", at: 0.965 },
  { name: "triangle", at: 0.99 },
];

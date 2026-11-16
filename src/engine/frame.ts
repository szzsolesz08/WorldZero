/** Render-frame layout shared by the worker (packing) and the renderer (unpacking). */

/** Floats per creature in a render frame: id, x, y, heading, size, hue, sat, pattern, shape, diet, flags, tribeHue. */
export const FRAME_STRIDE = 12;

export const FLAG = {
  resting: 1, fleeing: 2, hunting: 4, young: 8, infected: 16, tribe: 32, notable: 64,
  carrying: 128, raiding: 256, mating: 512, female: 1024,
} as const;

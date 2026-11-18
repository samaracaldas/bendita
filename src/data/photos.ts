import type { ImageMetadata } from 'astro';

/**
 * Product photos from Pexels (free Pexels License, no attribution required).
 * File name = product id.
 * Source IDs are listed in the README.
 */
const files = import.meta.glob<{ default: ImageMetadata }>('../assets/fotos/*.jpg', { eager: true });

export const PHOTOS: Record<string, ImageMetadata> = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [path.split('/').pop()!.replace('.jpg', ''), mod.default]),
);

// Tailwind-aware className merger. Same shape shadcn uses everywhere
// so any drop-in shadcn / aceternity component works without changes.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

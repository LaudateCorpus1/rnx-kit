export * from "./types";

import type { ResolutionContext, Resolution } from "./types";

export function resolve(
  context: ResolutionContext,
  moduleName: string,
  platform: string | null
): Resolution;

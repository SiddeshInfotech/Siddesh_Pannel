import { familyFor, isProductId } from './productIdentity';
import { isEntitledToAll } from './entity';

/** School clients receive scoped keys only. Device wrapping does not make a master safe. */
export function mayReleaseLegacyMasterKey(
  productId: string,
  classIds: string[],
  legacyDisabled: boolean,
): boolean {
  if (!isProductId(productId) || familyFor(productId) !== 'lab') return false;
  // Preserve the separate Lab product's existing migration policy.
  return !legacyDisabled && isEntitledToAll(classIds);
}

import { SetMetadata } from '@nestjs/common';

export const ADMIN_ACTION_KEY = 'admin_action';

/**
 * Decorate an admin controller method to have its execution automatically
 * recorded in admin_activity_log after a successful response.
 *
 * @param action  Dot-notation action name, e.g. 'product.create'
 * @param entityType  Optional override for entity_type; defaults to the part
 *                    before the first dot in action.
 */
export const AdminAction = (action: string, entityType?: string) =>
  SetMetadata(ADMIN_ACTION_KEY, { action, entityType: entityType ?? action.split('.')[0] });

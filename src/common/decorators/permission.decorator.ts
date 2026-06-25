import { SetMetadata } from '@nestjs/common';
import type { Permission as PermissionKey } from '../auth/permissions';

export const PERMISSION_KEY = 'required_permission';

/**
 * Declares which admin-panel permission an endpoint (or controller) requires.
 * Used together with {@link PermissionsGuard}: full admins always pass; staff
 * must have the named permission in their `permissions` array.
 *
 * Apply at the class level to cover every admin method in a controller:
 *
 *   @Permission('orders')
 *   @UseGuards(JwtAuthGuard, PermissionsGuard)
 *   export class OrdersController {}
 *
 * Endpoints guarded by PermissionsGuard WITHOUT this decorator are open to any
 * admin OR staff user (used for shared utilities like the dashboard / uploads).
 */
export const Permission = (permission: PermissionKey) => SetMetadata(PERMISSION_KEY, permission);

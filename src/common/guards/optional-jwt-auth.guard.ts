import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Optional JWT guard for routes that work for BOTH guests and logged-in users.
 *
 * Unlike the global JwtAuthGuard (which rejects requests without a valid token),
 * this guard attempts authentication but never throws: if a valid Bearer token is
 * present, req.user is populated; if it's missing or invalid, req.user is null and
 * the request proceeds as a guest.
 *
 * Used on POST /orders so an authenticated buyer's order is correctly tied to their
 * user_id (and appears in GET /orders/my), while guest checkout still works.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Never throw — return the user if authenticated, otherwise null (guest).
  handleRequest(_err: any, user: any) {
    return user || null;
  }
}

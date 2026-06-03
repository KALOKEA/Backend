import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DatabaseService } from '../../database/database.service';
import { ADMIN_ACTION_KEY } from '../decorators/admin-action.decorator';

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const meta = this.reflector.get<{ action: string; entityType: string }>(
      ADMIN_ACTION_KEY,
      context.getHandler(),
    );

    // Only log decorated endpoints.
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest();
    const adminId: string | undefined = req.user?.id;

    return next.handle().pipe(
      tap((result) => {
        // result is the already-transformed data field (TransformInterceptor
        // runs after this, so we receive the raw service return value here).
        const raw = result?.data ?? result;
        const entityId: string | undefined =
          raw?.id ??
          req.params?.id ??
          req.params?.imageId ??
          undefined;

        // Fire-and-forget — never let audit failures bubble up to the caller.
        Promise.resolve(
          this.db.client
            .from('admin_activity_log')
            .insert({
              admin_id: adminId ?? null,
              action: meta.action,
              entity_type: meta.entityType,
              entity_id: entityId ? String(entityId) : null,
              details: {
                method: req.method,
                path: req.path,
                // Record meaningful body keys (not values — avoid logging PII)
                body_keys: Object.keys(req.body ?? {}),
              },
            }),
        ).catch(() => {/* intentionally silent */});
      }),
    );
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * CorrelationIdMiddleware
 *
 * Attaches a unique request ID to every HTTP request so that all log lines,
 * errors, and external service calls within a single request can be traced
 * together. The ID is exposed as the X-Correlation-ID response header so the
 * frontend can include it in bug reports.
 *
 * If the caller already sends X-Correlation-ID (e.g. a load balancer or an
 * upstream service), we honour that value so the ID stays consistent across
 * distributed hops. A malformed or oversized caller-supplied value is
 * replaced with a fresh UUID to prevent log-injection.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private static readonly HEADER = 'x-correlation-id';
  private static readonly MAX_ID_LEN = 64;

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CorrelationIdMiddleware.HEADER] as string | undefined;

    // Validate incoming ID: only allow printable ASCII up to MAX_ID_LEN chars.
    const correlationId =
      incoming &&
      incoming.length <= CorrelationIdMiddleware.MAX_ID_LEN &&
      /^[\x20-\x7E]+$/.test(incoming)
        ? incoming
        : randomUUID();

    // Attach to the request object so services can read it via req.correlationId.
    (req as any).correlationId = correlationId;

    // Echo back on the response so clients can reference it in support tickets.
    res.setHeader(CorrelationIdMiddleware.HEADER, correlationId);

    next();
  }
}

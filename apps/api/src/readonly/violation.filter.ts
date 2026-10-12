import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuditService } from './audit.service'
import { ReadOnlyViolation } from './path-guard'

/** Violations raised deep in services (fs, commands) become 403 and are audited. */
@Catch()
export class ViolationFilter implements ExceptionFilter {
  constructor(private readonly audit: AuditService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request>()

    if (exception instanceof ReadOnlyViolation) {
      this.audit.record({ action: 'service', kind: '—', method: req.method, url: req.originalUrl, workspace: req.params?.id, verdict: 'blocked', rule: exception.rule, detail: exception.message })
      return res.status(403).json({ error: exception.message, rule: exception.rule })
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse()
      return res.status(exception.getStatus()).json(typeof body === 'string' ? { error: body } : body)
    }
    const message = exception instanceof Error ? exception.message : String(exception)
    return res.status(500).json({ error: message })
  }
}

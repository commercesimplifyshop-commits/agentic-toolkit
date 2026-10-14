import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { ModuleRef, Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { ACTION_KEY, ACTIONS, type ActionDef, type ActionId } from './actions'
import { AuditService } from './audit.service'
import { ReadOnlyViolation } from './path-guard'

/**
 * Global guard on every request: the route must declare an action, use an allowed HTTP method
 * and pass the action's input validator. Everything is audited; undeclared routes are blocked.
 */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly moduleRef: ModuleRef,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    const id = this.reflector.get<ActionId | undefined>(ACTION_KEY, context.getHandler())
    const base = { method: req.method, url: req.originalUrl, workspace: req.params?.id }

    const block = (rule: string, detail: string, action = id ?? 'desconhecida', kind = '—'): never => {
      this.audit.record({ ...base, action, kind, verdict: 'blocked', rule, detail })
      throw new ForbiddenException({ error: detail, rule })
    }

    if (!id) return block('route.undeclared', 'Rota sem ação declarada: bloqueada')
    const def: ActionDef = ACTIONS[id]
    if (!def.methods.includes(req.method as ActionDef['methods'][number])) {
      return block('route.method', `Método ${req.method} não permitido para ${id}`, id, def.kind)
    }

    try {
      def.validate?.({
        req,
        workspaceRoot: (wid) => this.moduleRef.get(WorkspacesService, { strict: false }).rootOf(wid),
      })
    } catch (err) {
      if (err instanceof ReadOnlyViolation) return block(err.rule, err.message, id, def.kind)
      return block('validator.error', (err as Error).message, id, def.kind)
    }

    this.audit.record({ ...base, action: id, kind: def.kind, verdict: 'allowed' })
    return true
  }
}

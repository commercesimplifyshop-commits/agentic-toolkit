import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'

export interface JobStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  detail?: string
}

export interface Job {
  id: string
  kind: string
  workspaceId: string
  status: 'running' | 'done' | 'error'
  steps: JobStep[]
  log: string[]
  error?: string
  /** Output of the job when it finishes (e.g. the id of the created document) */
  result?: Record<string, unknown>
  startedAt: string
  finishedAt?: string
}

/** In-memory background jobs (clone, analysis) with step-by-step progress. */
@Injectable()
export class JobsService {
  private readonly jobs = new Map<string, Job>()

  create(kind: string, workspaceId: string, steps: { id: string; label: string }[]): Job {
    const job: Job = {
      id: randomUUID(),
      kind,
      workspaceId,
      status: 'running',
      steps: steps.map((s) => ({ ...s, status: 'pending' })),
      log: [],
      startedAt: new Date().toISOString(),
    }
    this.jobs.set(job.id, job)
    return job
  }

  get(id: string) {
    return this.jobs.get(id)
  }

  step(job: Job, stepId: string, status: JobStep['status'], detail?: string) {
    const s = job.steps.find((x) => x.id === stepId)
    if (s) Object.assign(s, { status, detail })
  }

  log(job: Job, line: string) {
    job.log.push(line)
    if (job.log.length > 400) job.log.splice(0, job.log.length - 400)
  }

  /** Runs `fn` in the background, marking the job done or failed. */
  run(job: Job, fn: () => Promise<void>) {
    fn()
      .then(() => {
        job.status = 'done'
      })
      .catch((err: Error) => {
        job.status = 'error'
        job.error = err.message
        const running = job.steps.find((s) => s.status === 'running')
        if (running) Object.assign(running, { status: 'error', detail: err.message })
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString()
      })
  }
}

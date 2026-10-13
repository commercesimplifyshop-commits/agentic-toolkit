import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, ensureDataDirs, HOST, PORT } from './config/paths'
import { migrateLayout } from './config/migrate-layout'

async function bootstrap() {
  // the copy from the first layout runs before the folders of the new layout are created
  migrateLayout((message) => new Logger('Agentic Toolkit').log(message))
  ensureDataDirs()
  const { AppModule } = await import('./app.module')
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true })
  app.setGlobalPrefix('api')
  // Whiteboards may carry pasted images (base64)
  app.useBodyParser('json', { limit: '30mb' })

  // In production the API also serves the built SPA (apps/web/dist)
  const web = path.resolve(__dirname, '..', '..', 'web', 'dist')
  if (fs.existsSync(web)) {
    app.useStaticAssets(web)
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) return res.sendFile(path.join(web, 'index.html'))
      next()
    })
  }

  await app.listen(PORT, HOST)
  const log = new Logger('Agentic Toolkit')
  log.log(`API em http://${HOST}:${PORT}/api · dados em ${DATA_DIR}`)
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') log.warn('Servidor exposto fora do localhost: ele lê código-fonte, restrinja o acesso.')
}

bootstrap()

import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, ensureDataDirs, HOST, PORT } from './config/paths'

async function bootstrap() {
  ensureDataDirs()
  const { AppModule } = await import('./app.module')
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true })
  app.setGlobalPrefix('api')
  app.useBodyParser('json', { limit: '5mb' })

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
  const log = new Logger('StoreFlow')
  log.log(`API em http://${HOST}:${PORT}/api · dados em ${DATA_DIR}`)
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') log.warn('Servidor exposto fora do localhost: ele lê código-fonte, restrinja o acesso.')
}

bootstrap()

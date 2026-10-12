import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import yauzl from 'yauzl'
import { assertWritableTarget, isInside, ReadOnlyViolation } from '../readonly/path-guard'

const MAX_UNCOMPRESSED = 4 * 1024 ** 3 // 4 GB
const MAX_ENTRIES = 400_000

/**
 * Extracts an uploaded project zip into StoreFlow's data dir with zip-slip,
 * symlink and zip-bomb protection.
 */
@Injectable()
export class ZipService {
  extract(zipFile: string, dest: string, onProgress?: (files: number) => void): Promise<number> {
    assertWritableTarget(dest)
    fs.mkdirSync(dest, { recursive: true })
    return new Promise((resolve, reject) => {
      yauzl.open(zipFile, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (err, zip) => {
        if (err || !zip) return reject(err ?? new Error('Zip inválido'))
        let files = 0
        let total = 0
        const fail = (e: Error) => {
          zip.close()
          reject(e)
        }
        zip.on('entry', (entry: yauzl.Entry) => {
          const name = entry.fileName.replace(/\\/g, '/')
          const target = path.resolve(dest, name)
          if (!isInside(dest, target) || path.isAbsolute(name)) return fail(new ReadOnlyViolation(`Entrada fora da pasta de destino: ${name}`, 'zip.slip'))
          // Unix mode bits live in the high 16 bits; 0o120000 = symlink
          if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) return zip.readEntry()
          if (++files > MAX_ENTRIES) return fail(new Error('Zip com arquivos demais'))
          total += entry.uncompressedSize
          if (total > MAX_UNCOMPRESSED) return fail(new Error('Zip descompactado passa de 4 GB'))

          if (name.endsWith('/')) {
            fs.mkdirSync(target, { recursive: true })
            return zip.readEntry()
          }
          fs.mkdirSync(path.dirname(target), { recursive: true })
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) return fail(e ?? new Error('Falha ao ler o zip'))
            const out = fs.createWriteStream(target)
            stream.pipe(out)
            out.on('finish', () => {
              if (files % 500 === 0) onProgress?.(files)
              zip.readEntry()
            })
            out.on('error', fail)
          })
        })
        zip.on('end', () => resolve(files))
        zip.on('error', fail)
        zip.readEntry()
      })
    })
  }
}

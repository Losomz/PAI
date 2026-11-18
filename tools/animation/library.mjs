import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const component = /^[a-z0-9][a-z0-9_-]{0,63}$/
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const validPart = part => component.test(part) && !reserved.test(part)
export function checkId(id) {
  if (typeof id !== 'string' || id.split('/').length !== 2 || !id.split('/').every(validPart)) {
    throw Error('动画 ID 应为 分类/名称，使用小写字母、数字、下划线或短横线')
  }
  return id
}
export function checkCode(code) {
  if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > 512 * 1024) {
    throw Error('请提供非空的 JavaScript 源码，大小上限为 512 KiB')
  }
}
const hash = value => createHash('sha256').update(value).digest('hex')

// SQLite serializes library operations across desktop and stdio processes. Source files
// are canonical and remain ordinary UTF-8 files that external editors can replace directly.
export class AnimationLibrary {
  constructor(root) {
    fs.mkdirSync(root, { recursive: true })
    this.root = fs.realpathSync(root)
    const index = path.join(this.root, '.library.sqlite')
    if (fs.lstatSync(index, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('动画库索引须为本地文件')
    this.db = new DatabaseSync(index)
    this.db.exec('PRAGMA busy_timeout = 15000; CREATE TABLE IF NOT EXISTS installed (collection TEXT PRIMARY KEY)')
  }
  close() { this.db.close() }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  directory(id) {
    let directory = this.root
    for (const part of checkId(id).split('/')) {
      directory = path.join(directory, part)
      if (fs.lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('动画目录须位于本地库中')
    }
    return directory
  }

  read(id) {
    const dir = this.directory(id)
    const codePath = path.join(dir, 'animation.js')
    const manifestPath = path.join(dir, 'animation.json')
    for (const file of [manifestPath, codePath]) {
      const stat = fs.lstatSync(file, { throwIfNoEntry: false })
      if (!stat?.isFile()) throw Error('没有找到动画文件：' + id)
      if (stat.size > 512 * 1024) throw Error('动画文件过大：' + id)
    }
    const manifest = fs.readFileSync(manifestPath, 'utf8')
    const { name, template } = JSON.parse(manifest)
    const code = fs.readFileSync(codePath, 'utf8')
    return { id, name, template, code, codePath, revision: hash(manifest + '\0' + code) }
  }

  list() {
    const result = []
    for (const group of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!group.isDirectory() || !validPart(group.name)) continue
      for (const folder of fs.readdirSync(path.join(this.root, group.name), { withFileTypes: true })) {
        if (!folder.isDirectory() || !validPart(folder.name)) continue
        const id = group.name + '/' + folder.name
        const file = path.join(this.directory(id), 'animation.json')
        if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) continue
        const { name, template } = JSON.parse(fs.readFileSync(file, 'utf8'))
        result.push({ id, name, template })
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id))
  }

  install(collection, getTemplates) {
    const installed = () => this.db.prepare('SELECT 1 FROM installed WHERE collection = ?').get(collection)
    if (installed()) return
    this.transaction(() => {
      if (installed()) return
      for (const record of getTemplates()) {
        if (!fs.existsSync(this.directory(record.id))) this.insert(record)
      }
      this.db.prepare('INSERT INTO installed VALUES (?)').run(collection)
    })
  }

  insert({ id, name, template = null, code }) {
    checkCode(code)
    if (typeof name !== 'string' || !name.trim() || name.length > 120) throw Error('动画名称须为 1–120 个字符')
    const directory = this.directory(id)
    if (fs.existsSync(directory)) throw Error('动画 ID 已存在：' + id)
    fs.mkdirSync(path.dirname(directory), { recursive: true })
    const temp = fs.mkdtempSync(path.join(path.dirname(directory), '.new-'))
    try {
      fs.writeFileSync(path.join(temp, 'animation.json'), JSON.stringify({ name: name.trim(), template, instance: randomUUID() }, null, 2) + '\n')
      fs.writeFileSync(path.join(temp, 'animation.js'), code)
      fs.renameSync(temp, directory)
    } finally {
      fs.rmSync(temp, { recursive: true, force: true })
    }
  }

  create(record) {
    return this.transaction(() => {
      this.insert(record)
      return this.read(record.id)
    })
  }

  current(id, revision) {
    const item = this.read(id)
    if (item.revision !== revision) throw Error('动画已更改，请重新读取最新版本')
    return item
  }

  update(id, revision, code) {
    checkCode(code)
    return this.transaction(() => {
      const { codePath } = this.current(id, revision)
      const temp = path.join(path.dirname(codePath), '.' + randomUUID() + '.tmp')
      try {
        fs.writeFileSync(temp, code, { flag: 'wx' })
        fs.renameSync(temp, codePath)
      } finally {
        fs.rmSync(temp, { force: true })
      }
      return this.read(id)
    })
  }

  remove(id, revision) {
    return this.transaction(() => {
      this.current(id, revision)
      const dir = this.directory(id)
      const trash = path.join(this.root, '.trash')
      if (fs.lstatSync(trash, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('回收目录无效')
      fs.mkdirSync(trash, { recursive: true })
      const archivedPath = path.join(trash, id.replace('/', '--') + '-' + randomUUID())
      fs.renameSync(dir, archivedPath)
      return { id, archivedPath }
    })
  }
}

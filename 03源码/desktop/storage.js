"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function writableDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.xiaojian-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(probe, '');
  fs.unlinkSync(probe);
}
function dayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
class RecordStore {
  constructor({ userData, installDirectory, fallbackDirectory, validate }) {
    this.validate = validate;
    this.configFile = path.join(userData, 'storage-config.json');
    if (fs.existsSync(this.configFile)) {
      this.config = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      if (!this.config.dataRoot || !path.isAbsolute(this.config.dataRoot)) throw Error('存储设置无效，请检查 storage-config.json');
    } else {
      let dataRoot = path.join(installDirectory, '小笺数据');
      try { writableDirectory(dataRoot); } catch (_) { dataRoot = path.join(fallbackDirectory, '小笺数据'); writableDirectory(dataRoot); }
      this.config = { dataRoot, backupRoot: path.join(dataRoot, '备份'), autoBackup: true, backupRetention: 30 };
      atomicWrite(this.configFile, this.config);
    }
    this.config.backupRoot ||= path.join(this.config.dataRoot, '备份');
    this.config.autoBackup = this.config.autoBackup !== false;
    this.config.backupRetention = Number.isInteger(this.config.backupRetention) ? this.config.backupRetention : 30;
  }
  get file() { return path.join(this.config.dataRoot, '记录', 'records.json'); }
  info() { return { ...this.config, recordsFile: this.file, configFile: this.configFile, lastBackup: this.lastBackup || '' }; }
  load() {
    if (!fs.existsSync(this.file)) return null;
    return this.validate(JSON.parse(fs.readFileSync(this.file, 'utf8')));
  }
  backup(data, automatic = false) {
    this.validate(data);
    const name = automatic ? `小笺-自动备份-${dayKey()}.json` : `小笺-备份-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}.json`;
    const file = path.join(this.config.backupRoot, name);
    if (!automatic || !fs.existsSync(file)) atomicWrite(file, data);
    this.lastBackup = file;
    if (automatic) {
      // Only our daily snapshots are rotated. Manual backups are always retained.
      const snapshots = fs.readdirSync(this.config.backupRoot).filter(n => /^小笺-自动备份-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse();
      for (const name of snapshots.slice(this.config.backupRetention)) fs.unlinkSync(path.join(this.config.backupRoot, name));
    }
    return file;
  }
  save(data) {
    const valid = this.validate(data);
    let previous;
    try { previous = this.load(); }
    catch (error) {
      // A valid imported backup can repair a broken record file, preserving the raw original.
      const recovery = path.join(this.config.backupRoot, `小笺-备份-损坏原件-${crypto.randomUUID()}.json`);
      fs.mkdirSync(this.config.backupRoot, { recursive: true });
      fs.copyFileSync(this.file, recovery, fs.constants.COPYFILE_EXCL);
    }
    if (this.config.autoBackup) this.backup(previous || valid, true);
    atomicWrite(this.file, valid);
    return this.info();
  }
  setPreferences(input) {
    if (typeof input.autoBackup !== 'boolean' || !Number.isInteger(input.backupRetention) || input.backupRetention < 7 || input.backupRetention > 365) throw Error('自动备份保留数量应为 7 至 365 份');
    const next = { ...this.config, autoBackup: input.autoBackup, backupRetention: input.backupRetention };
    atomicWrite(this.configFile, next); this.config = next; return this.info();
  }
  changeDataRoot(directory) {
    const target = path.resolve(directory);
    if (target === this.config.dataRoot) return this.info();
    writableDirectory(target);
    const nextFile = path.join(target, '记录', 'records.json');
    const current = this.load();
    if (fs.existsSync(nextFile)) throw Error('所选目录已有小笺记录，请选择新的文件夹，以免覆盖其他记录。');
    if (current) atomicWrite(nextFile, current);
    const backupRoot = path.join(target, '备份');
    this.copyBackups(backupRoot);
    const next = { ...this.config, dataRoot: target, backupRoot };
    atomicWrite(this.configFile, next); this.config = next; return this.info();
  }
  changeBackupRoot(directory) {
    const backupRoot = path.resolve(directory);
    writableDirectory(backupRoot); this.copyBackups(backupRoot);
    const next = { ...this.config, backupRoot };
    atomicWrite(this.configFile, next); this.config = next; return this.info();
  }
  copyBackups(target) {
    writableDirectory(target);
    if (path.resolve(target) === path.resolve(this.config.backupRoot) || !fs.existsSync(this.config.backupRoot)) return;
    for (const name of fs.readdirSync(this.config.backupRoot).filter(n => /^小笺-(自动备份|备份)-.*\.json$/.test(n))) {
      const source = path.join(this.config.backupRoot, name), destination = path.join(target, name);
      if (!fs.existsSync(destination)) fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      else if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) fs.copyFileSync(source, path.join(target, `小笺-备份-迁移-${crypto.randomUUID()}.json`), fs.constants.COPYFILE_EXCL);
    }
  }
}
module.exports = { RecordStore, atomicWrite };

import fs from "fs";
import path from "path";

const DAY = 24 * 60 * 60 * 1000;

export const STAT_KEYS = [
  "edit_comments", // kampanya Reels'ında EDIT içeren yorum olayı (tekrarlar dahil)
  "unique_comments", // benzersiz yorum
  "dm_success",
  "dm_failed",
  "duplicate_webhooks",
  "api_errors",
  "public_reply_success",
  "public_reply_failed",
  "skipped_not_ready", // kampanya hazır değilken gelen yorumlar
];

// Kalıcı (JSON dosyası) kampanya deposu.
// Kişisel veri tutulmaz: yalnızca yorum ID'si, durum, zaman ve sayaçlar (kullanıcı ID'si / yorum metni yok).
export class JsonStore {
  constructor(file, { now = () => Date.now(), retentionMs = 30 * DAY, logger = console } = {}) {
    this.file = file;
    this.now = now;
    this.logger = logger;
    this.persistent = Boolean(file);
    this.data = { version: 1, records: {}, stats: Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) };
    this.load();
    this.prune(retentionMs);
  }

  load() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
        this.data.records = parsed.records ?? {};
        this.data.stats = { ...this.data.stats, ...(parsed.stats ?? {}) };
      }
    } catch (err) {
      this.logger.error(`EDIT store load failed, running in memory: ${err.code ?? err.message}`);
      this.persistent = false;
    }
  }

  save() {
    if (!this.persistent) return;
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file); // atomik yazım: yarım dosya kalmaz
    } catch (err) {
      this.logger.error(`EDIT store save failed: ${err.code ?? err.message}`);
      this.persistent = false;
    }
  }

  // Meta tekrar teslim penceresi geçtikten sonra eski kayıtları temizle
  prune(retentionMs) {
    const cutoff = this.now() - retentionMs;
    let removed = 0;
    for (const [id, rec] of Object.entries(this.data.records)) {
      if (rec.status !== "pending" && Date.parse(rec.updatedAt) < cutoff) {
        delete this.data.records[id];
        removed++;
      }
    }
    if (removed) this.save();
  }

  has(id) {
    return Object.hasOwn(this.data.records, id);
  }

  get(id) {
    return this.data.records[id];
  }

  create(id, fields) {
    const ts = new Date(this.now()).toISOString();
    this.data.records[id] = { status: "pending", attempts: 0, createdAt: ts, updatedAt: ts, ...fields };
    this.save();
    return this.data.records[id];
  }

  update(id, patch) {
    Object.assign(this.data.records[id], patch, { updatedAt: new Date(this.now()).toISOString() });
    this.save();
  }

  incr(stat, n = 1) {
    this.data.stats[stat] = (this.data.stats[stat] ?? 0) + n;
    this.save();
  }

  pendingIds() {
    return Object.entries(this.data.records)
      .filter(([, r]) => r.status === "pending")
      .map(([id]) => id);
  }

  summary() {
    const byStatus = {};
    for (const r of Object.values(this.data.records)) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return { stats: { ...this.data.stats }, recordsByStatus: byStatus, persistent: this.persistent };
  }
}

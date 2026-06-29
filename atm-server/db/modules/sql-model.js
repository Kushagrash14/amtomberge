import { ensureSchema, getPool } from '../config/sql.config.js';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const toDbValue = (value) => (value === undefined ? null : value);

const toPlain = (value) => {
  if (Array.isArray(value)) return value.map(toPlain);
  if (!value || typeof value !== 'object') return value;

  const plain = {};
  for (const key of Object.keys(value)) {
    plain[key] = value[key];
  }
  return plain;
};

const applyProjection = (value, projection) => {
  if (!projection || !value) return value;

  const apply = (item) => {
    if (!item) return item;
    const projected = Array.isArray(item) ? item : item;
    for (const [field, include] of Object.entries(projection)) {
      if (include === 0 || include === false) delete projected[field];
    }
    return projected;
  };

  return Array.isArray(value) ? value.map(apply) : apply(value);
};

class SqlQuery {
  constructor(executor, projection) {
    this.executor = executor;
    this.projection = projection;
    this.sortSpec = null;
    this.leanMode = false;
  }

  sort(spec) {
    this.sortSpec = spec;
    return this;
  }

  lean() {
    this.leanMode = true;
    return this;
  }

  async exec() {
    const result = await this.executor({
      sort: this.sortSpec,
      lean: this.leanMode,
      projection: this.projection,
    });
    const value = this.leanMode ? toPlain(result) : result;
    return applyProjection(value, this.projection);
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(callback) {
    return this.exec().finally(callback);
  }
}

export class SqlModel {
  static table = '';
  static fields = [];
  static writableFields = [];
  static defaults = {};
  static columnMap = {};

  constructor(data = {}) {
    Object.assign(this, data);
  }

  static dbTable() {
    return `\`${this.table}\``;
  }

  static column(field) {
    if (field === '_id') return '`id`';
    if (this.columnMap[field]) return this.columnMap[field];
    if (this.fields.includes(field) || field === 'id') return `\`${field}\``;
    throw new Error(`Unknown field ${field} for ${this.table}`);
  }

  static fromRow(row) {
    if (!row) return null;
    const data = {};
    for (const field of this.fields) {
      if (hasOwn(row, field)) data[field] = row[field];
    }
    if (hasOwn(row, 'id')) {
      data.id = row.id;
      data._id = String(row.id);
    }
    return new this(data);
  }

  static defaultValue(field) {
    const value = this.defaults[field];
    return typeof value === 'function' ? value() : value;
  }

  static normalizeInput(input = {}, includeDefaults = false) {
    const values = {};

    if (includeDefaults) {
      for (const field of Object.keys(this.defaults)) {
        if (!hasOwn(input, field)) values[field] = this.defaultValue(field);
      }
    }

    for (const field of this.writableFields) {
      if (hasOwn(input, field)) values[field] = toDbValue(input[field]);
    }

    return values;
  }

  static buildWhere(filter = {}) {
    const clauses = [];
    const params = [];

    for (const [field, value] of Object.entries(filter || {})) {
      const column = this.column(field);
      if (value === undefined) continue;
      if (value === null) {
        clauses.push(`${column} IS NULL`);
      } else {
        clauses.push(`${column} = ?`);
        params.push(value);
      }
    }

    return {
      sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  static buildOrder(sortSpec) {
    if (!sortSpec) return '';

    const entries = typeof sortSpec === 'string'
      ? sortSpec.split(/\s+/).filter(Boolean).map((field) => (
        field.startsWith('-') ? [field.slice(1), -1] : [field, 1]
      ))
      : Object.entries(sortSpec);

    if (!entries.length) return '';

    const fields = entries.map(([field, direction]) => {
      const order = direction === -1 || direction === 'desc' || direction === 'DESC' ? 'DESC' : 'ASC';
      return `${this.column(field)} ${order}`;
    });

    return `ORDER BY ${fields.join(', ')}`;
  }

  static find(filter = {}, projection) {
    return new SqlQuery(async ({ sort }) => {
      await ensureSchema();
      const { sql, params } = this.buildWhere(filter);
      const order = this.buildOrder(sort);
      const [rows] = await getPool().query(
        `SELECT * FROM ${this.dbTable()} ${sql} ${order}`,
        params,
      );
      return rows.map((row) => this.fromRow(row));
    }, projection);
  }

  static findOne(filter = {}, projection) {
    return new SqlQuery(async ({ sort }) => {
      await ensureSchema();
      const { sql, params } = this.buildWhere(filter);
      const order = this.buildOrder(sort);
      const [rows] = await getPool().query(
        `SELECT * FROM ${this.dbTable()} ${sql} ${order} LIMIT 1`,
        params,
      );
      return this.fromRow(rows[0]);
    }, projection);
  }

  static async create(input) {
    if (Array.isArray(input)) {
      const created = [];
      for (const item of input) created.push(await this.create(item));
      return created;
    }

    await ensureSchema();
    const values = this.normalizeInput(input, true);
    const fields = Object.keys(values);
    if (!fields.length) throw new Error(`No values provided for ${this.table}`);

    const columns = fields.map((field) => this.column(field)).join(', ');
    const placeholders = fields.map(() => '?').join(', ');
    const params = fields.map((field) => values[field]);
    const [result] = await getPool().query(
      `INSERT INTO ${this.dbTable()} (${columns}) VALUES (${placeholders})`,
      params,
    );

    return this.findOne({ id: result.insertId });
  }

  static getUpdateDocument(filter, update = {}, forInsert = false) {
    if (hasOwn(update, '$set') || hasOwn(update, '$setOnInsert')) {
      return {
        ...(forInsert ? filter : {}),
        ...(forInsert ? (update.$setOnInsert || {}) : {}),
        ...(update.$set || {}),
      };
    }

    return forInsert ? { ...filter, ...update } : { ...update };
  }

  static async findOneAndUpdate(filter = {}, update = {}, options = {}) {
    const existing = await this.findOne(filter);

    if (existing) {
      const patch = this.getUpdateDocument(filter, update, false);
      Object.assign(existing, patch);
      await existing.save();
      return options.new === false ? existing : existing;
    }

    if (!options.upsert) return null;
    const insertDoc = { ...filter, ...this.getUpdateDocument(filter, update, true) };
    return this.create(insertDoc);
  }

  static async deleteOne(filter = {}) {
    await ensureSchema();
    const { sql, params } = this.buildWhere(filter);
    const [result] = await getPool().query(
      `DELETE FROM ${this.dbTable()} ${sql} LIMIT 1`,
      params,
    );
    return { deletedCount: result.affectedRows || 0 };
  }

  static async countDocuments(filter = {}) {
    await ensureSchema();
    const { sql, params } = this.buildWhere(filter);
    const [rows] = await getPool().query(
      `SELECT COUNT(*) AS count FROM ${this.dbTable()} ${sql}`,
      params,
    );
    return Number(rows[0]?.count || 0);
  }

  async save() {
    const Model = this.constructor;
    await ensureSchema();

    if (!this.id) {
      const created = await Model.create(this);
      Object.assign(this, created);
      return this;
    }

    const values = Model.normalizeInput(this, false);
    const fields = Object.keys(values);
    if (!fields.length) return this;

    const assignments = fields.map((field) => `${Model.column(field)} = ?`).join(', ');
    const params = fields.map((field) => values[field]);
    params.push(this.id);

    await getPool().query(
      `UPDATE ${Model.dbTable()} SET ${assignments} WHERE \`id\` = ?`,
      params,
    );

    const fresh = await Model.findOne({ id: this.id });
    Object.assign(this, fresh);
    return this;
  }
}

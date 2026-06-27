import { SqlModel } from '../sql-model.js';

const timestamps = ['createdAt', 'updatedAt'];

export class Setting extends SqlModel {
  static table = 'settings';
  static fields = ['id', 'key', 'value', ...timestamps];
  static writableFields = ['key', 'value'];
  static columnMap = { key: '`key`' };
}

export class ProductionEntry extends SqlModel {
  static table = 'production_entries';
  static fields = ['id', 'date', 'model', 'serial', 'timestamp', ...timestamps];
  static writableFields = ['date', 'model', 'serial', 'timestamp'];
}

export class IdleRecord extends SqlModel {
  static table = 'idle_records';
  static fields = ['id', 'date', 'fromTime', 'toTime', 'duration', 'department', 'reason', 'slot', ...timestamps];
  static writableFields = ['date', 'fromTime', 'toTime', 'duration', 'department', 'reason', 'slot'];
  static defaults = { duration: 0 };
}

export class ReloadRecord extends SqlModel {
  static table = 'reload_records';
  static fields = ['id', 'date', 'slot', 'type', 'count', 'timestamp', ...timestamps];
  static writableFields = ['date', 'slot', 'type', 'count', 'timestamp'];
  static defaults = { count: 1 };
}

export class ProductionModel extends SqlModel {
  static table = 'production_models';
  static fields = ['id', 'name', 'customer', ...timestamps];
  static writableFields = ['name', 'customer'];
}

export class SerialRange extends SqlModel {
  static table = 'serial_ranges';
  static fields = ['id', 'date', 'model', 'start', 'end', 'expected', 'scanned', 'missing', ...timestamps];
  static writableFields = ['date', 'model', 'start', 'end', 'expected', 'scanned', 'missing'];
  static columnMap = { start: '`start`', end: '`end`' };
  static defaults = { expected: 0, scanned: 0, missing: 0 };
}

export class Manpower extends SqlModel {
  static table = 'manpower';
  static fields = ['id', 'date', 'manpower', ...timestamps];
  static writableFields = ['date', 'manpower'];
  static defaults = { manpower: 0 };
}

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
export class PackBox extends SqlModel {
  static table = 'pack_boxes';
  static fields = ['id', 'date', 'model', 'box_number', 'box_code', 'units_per_box', 'status', 'master_qr', 'packed_at', 'printed_at', ...timestamps];
  static writableFields = ['date', 'model', 'box_number', 'box_code', 'units_per_box', 'status', 'master_qr', 'packed_at', 'printed_at'];
}

export class PackBoxItem extends SqlModel {
  static table = 'pack_box_items';
  static fields = ['id', 'box_id', 'serial', 'scanned_at', ...timestamps];
  static writableFields = ['box_id', 'serial', 'scanned_at'];
}

export class PackConfig extends SqlModel {
  static table = 'pack_config';
  static fields = ['id', 'model', 'units_per_box', 'description', ...timestamps];
  static writableFields = ['model', 'units_per_box', 'description'];
  static defaults = { units_per_box: 12 };
}
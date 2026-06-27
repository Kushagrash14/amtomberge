import mongoose from 'mongoose';

const modelFor = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true },
  value: { type: String, default: '' },
}, { timestamps: true });

const productionSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true },
  model: { type: String, required: true, trim: true, index: true },
  serial: { type: String, required: true, unique: true, trim: true, index: true },
  timestamp: { type: String, required: true },
}, { timestamps: true });

const idleRecordSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true },
  fromTime: { type: String, default: '' },
  toTime: { type: String, default: '' },
  duration: { type: Number, default: 0 },
  department: { type: String, default: '' },
  reason: { type: String, default: '' },
  slot: { type: String, default: '' },
}, { timestamps: true });

const reloadSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true },
  slot: { type: String, default: '' },
  type: { type: String, default: '' },
  count: { type: Number, default: 1 },
  timestamp: { type: String, default: '' },
}, { timestamps: true });

const productionModelSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  customer: { type: String, default: '' },
}, { timestamps: true });

const serialRangeSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true },
  model: { type: String, required: true, trim: true },
  start: { type: Number, required: true },
  end: { type: Number, required: true },
  expected: { type: Number, default: 0 },
  scanned: { type: Number, default: 0 },
  missing: { type: Number, default: 0 },
}, { timestamps: true });

const manpowerSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true },
  manpower: { type: Number, default: 0 },
}, { timestamps: true });

export const Setting = modelFor('Setting', settingSchema);
export const ProductionEntry = modelFor('ProductionEntry', productionSchema);
export const IdleRecord = modelFor('IdleRecord', idleRecordSchema);
export const ReloadRecord = modelFor('ReloadRecord', reloadSchema);
export const ProductionModel = modelFor('ProductionModel', productionModelSchema);
export const SerialRange = modelFor('SerialRange', serialRangeSchema);
export const Manpower = modelFor('Manpower', manpowerSchema);

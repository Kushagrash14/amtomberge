import {
  Setting, ProductionEntry, IdleRecord, ReloadRecord,
  ProductionModel, SerialRange, Manpower
} from '../db/modules/production-models/data.models.js';
import userModel from '../db/modules/auth-models/user.model.js';
import jwt from 'jsonwebtoken';

// ── helpers ───────────────────────────────────────────────────────────────────
const ok  = (res, data)        => res.json({ success: true,  ...data });
const err = (res, msg, status = 400) => res.status(status).json({ success: false, message: msg });

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/production/settings
export const getAllSettings = async (req, res) => {
  try {
    const rows = await Setting.find({});
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    ok(res, { settings });
  } catch (e) {
    err(res, 'Failed to load settings', 500);
  }
};

// POST /api/production/settings
// body: { key, value }
export const saveSetting = async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return err(res, 'key is required');
    await Setting.findOneAndUpdate({ key }, { value: String(value ?? '') }, { upsert: true, new: true });
    ok(res, { message: 'Setting saved' });
  } catch (e) {
    err(res, 'Failed to save setting', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTION DATA
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/production/data?date=DD-MM-YYYY
export const getProductionData = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return err(res, 'date is required');
    const rows = await ProductionEntry.find({ date }).lean();
    // Return in the shape the frontend expects (matches old getSheet('ProductionData'))
    const data = [
      ['timestamp', 'date', 'model', 'serial'],
      ...rows.map(r => [r.timestamp, r.date, r.model, r.serial]),
    ];
    ok(res, { data });
  } catch (e) {
    err(res, 'Failed to load production data', 500);
  }
};

// POST /api/production/serial
// body: { date, serial, model, timestamp }
export const addSerial = async (req, res) => {
  try {
    const { date, serial, model, timestamp } = req.body;
    if (!date || !serial || !model) return err(res, 'date, serial, model required');

    // Duplicate check
    const existing = await ProductionEntry.findOne({ serial });
    if (existing) return res.json({ success: false, message: 'Duplicate serial', code: 'DUPLICATE' });

    // Sequence check — last serial for this model+date
    const last = await ProductionEntry.findOne({ date, model }).sort({ createdAt: -1 }).lean();
    if (last) {
      const lastNum  = parseInt((last.serial.match(/(\d+)$/)  || ['','0'])[1]);
      const thisNum  = parseInt((serial.match(/(\d+)$/)       || ['','0'])[1]);
      if (thisNum !== lastNum + 1) {
        return res.json({
          success: false,
          code: 'SEQUENCE_ERROR',
          message: `Expected ${lastNum + 1}, got ${thisNum} (last: ${last.serial})`,
        });
      }
    }

    await ProductionEntry.create({ date, serial, model, timestamp });
    ok(res, { message: 'Serial saved' });
  } catch (e) {
    if (e.code === 11000) return res.json({ success: false, message: 'Duplicate serial', code: 'DUPLICATE' });
    err(res, 'Failed to save serial', 500);
  }
};

// GET /api/production/serial/last?model=X&date=DD-MM-YYYY
export const getLastSerial = async (req, res) => {
  try {
    const { model, date } = req.query;
    if (!model || !date) return err(res, 'model and date required');
    const last = await ProductionEntry.findOne({ model, date }).sort({ createdAt: -1 }).lean();
    if (!last) return ok(res, { lastSerial: null, lastNum: 0 });
    const lastNum = parseInt((last.serial.match(/(\d+)$/) || ['','0'])[1]);
    ok(res, { lastSerial: last.serial, lastNum });
  } catch (e) {
    err(res, 'Failed to get last serial', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// IDLE RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/production/idle?date=DD-MM-YYYY
export const getIdleRecords = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return err(res, 'date is required');
    const rows = await IdleRecord.find({ date }).lean();
    const data = [
      ['date','fromTime','toTime','duration','department','reason','slot'],
      ...rows.map(r => [r.date, r.fromTime, r.toTime, r.duration, r.department, r.reason, r.slot]),
    ];
    ok(res, { data });
  } catch (e) {
    err(res, 'Failed to load idle records', 500);
  }
};

// POST /api/production/idle
// body: { date, fromTime, toTime, duration, department, reason, slot }
export const addIdleTime = async (req, res) => {
  try {
    const { date, fromTime, toTime, duration, department, reason, slot } = req.body;
    if (!date || !slot) return err(res, 'date and slot required');
    await IdleRecord.create({ date, fromTime, toTime, duration, department, reason, slot });
    ok(res, { message: 'Idle record saved' });
  } catch (e) {
    err(res, 'Failed to save idle record', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// RELOADS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/production/reloads?date=DD-MM-YYYY
export const getReloads = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return err(res, 'date is required');
    const rows = await ReloadRecord.find({ date }).lean();
    const data = [
      ['date','slot','type','count','timestamp'],
      ...rows.map(r => [r.date, r.slot, r.type, r.count, r.timestamp]),
    ];
    ok(res, { data });
  } catch (e) {
    err(res, 'Failed to load reloads', 500);
  }
};

// POST /api/production/reload
// body: { date, slot, type, count, timestamp }
export const addReload = async (req, res) => {
  try {
    const { date, slot, type, count, timestamp } = req.body;
    if (!date || !slot) return err(res, 'date and slot required');
    await ReloadRecord.create({ date, slot, type: type || 'Material', count: count || 1, timestamp });
    ok(res, { message: 'Reload saved' });
  } catch (e) {
    err(res, 'Failed to save reload', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/production/models
export const getModels = async (req, res) => {
  try {
    const rows = await ProductionModel.find({}).lean();
    const data = [
      ['name', 'customer'],
      ...rows.map(r => [r.name, r.customer]),
    ];
    ok(res, { data });
  } catch (e) {
    err(res, 'Failed to load models', 500);
  }
};

// POST /api/production/models
// body: { modelName, customer }
export const saveModel = async (req, res) => {
  try {
    const { modelName, customer } = req.body;
    if (!modelName) return err(res, 'modelName is required');
    await ProductionModel.findOneAndUpdate({ name: modelName }, { customer: customer || '' }, { upsert: true, new: true });
    ok(res, { message: 'Model saved' });
  } catch (e) {
    err(res, 'Failed to save model', 500);
  }
};

// DELETE /api/production/models/:name
export const deleteModel = async (req, res) => {
  try {
    const { name } = req.params;
    await ProductionModel.deleteOne({ name });
    ok(res, { message: 'Model deleted' });
  } catch (e) {
    err(res, 'Failed to delete model', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SERIAL RANGES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/production/ranges?date=DD-MM-YYYY
export const getSerialRanges = async (req, res) => {
  try {
    const { date } = req.query;
    const query = date ? { date } : {};
    const rows = await SerialRange.find(query).sort({ createdAt: -1 }).lean();
    const data = [
      ['date','model','start','end','expected','scanned','missing'],
      ...rows.map(r => [r.date, r.model, r.start, r.end, r.expected, r.scanned, r.missing]),
    ];
    ok(res, { data });
  } catch (e) {
    err(res, 'Failed to load serial ranges', 500);
  }
};

// POST /api/production/ranges
// body: { date, model, start, end, expected, scanned, missing }
export const setSerialRange = async (req, res) => {
  try {
    const { date, model, start, end, expected, scanned, missing } = req.body;
    if (!date || !model || start == null || end == null) return err(res, 'date, model, start, end required');
    await SerialRange.findOneAndUpdate(
      { date, model },
      { start, end, expected: expected ?? (end - start + 1), scanned: scanned ?? 0, missing: missing ?? (end - start + 1) },
      { upsert: true, new: true }
    );
    ok(res, { message: 'Serial range saved' });
  } catch (e) {
    err(res, 'Failed to save serial range', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MANPOWER
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/production/manpower?date=DD-MM-YYYY
export const getManpower = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return err(res, 'date is required');
    const row = await Manpower.findOne({ date }).lean();
    // Return in the old Contents sheet shape the frontend expects
    const label = (() => {
      const [d, , ] = (date || '').split('-');
      const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const m = new Date().getMonth() + 1;
      return `${parseInt(d)}-${months[m]}`;
    })();
    const data = [
      [label],
      [row ? row.manpower : 0],
    ];
    ok(res, { data, manpower: row ? row.manpower : 0 });
  } catch (e) {
    err(res, 'Failed to load manpower', 500);
  }
};

// POST /api/production/manpower
// body: { date, manpower }
export const setManpower = async (req, res) => {
  try {
    const { date, manpower } = req.body;
    if (!date || manpower == null) return err(res, 'date and manpower required');
    await Manpower.findOneAndUpdate({ date }, { manpower: Number(manpower) }, { upsert: true, new: true });
    ok(res, { message: 'Manpower saved' });
  } catch (e) {
    err(res, 'Failed to save manpower', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// USERS (Admin)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/production/users
export const getUsers = async (req, res) => {
  try {
    const rows = await userModel.find({}, { otp: 0, expireOtpAt: 0 }).lean();
    const data = [
      ['email','name','role'],
      ...rows.map(r => [r.email, r.name || r.username || '', r.role || 'user']),
    ];
    ok(res, { data });
  } catch (e) {
    err(res, 'Failed to load users', 500);
  }
};

// POST /api/production/users
// body: { email, name, role }
export const addUser = async (req, res) => {
  try {
    const { email, name } = req.body;
    const role = req.body.role || 'user';
    if (!email || !name) return err(res, 'email and name required');
    const exists = await userModel.findOne({ email: email.trim().toLowerCase() });
    if (exists) return err(res, 'User already exists');
    await userModel.create({ email: email.trim().toLowerCase(), username: name, name, role });
    ok(res, { message: 'User added' });
  } catch (e) {
    err(res, 'Failed to add user', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN AUTH
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/production/admin/verify
// body: { password }
export const verifyAdmin = async (req, res) => {
  try {
    const { password } = req.body;
    const correct = process.env.ADMIN_PASSWORD || 'admin123';
    if (password === correct) return ok(res, { verified: true });
    err(res, 'Incorrect password', 401);
  } catch (e) {
    err(res, 'Verification failed', 500);
  }
};
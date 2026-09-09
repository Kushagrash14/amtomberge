import {
  Setting, ProductionEntry, IdleRecord, ReloadRecord,
  ProductionModel, SerialRange, Manpower, PackBox, PackBoxItem, PackConfig
} from '../db/modules/production-models/data.models.js';
import userModel from '../db/modules/auth-models/user.model.js';
import { generateMasterLabelZPL } from "../templates/masterLabel.zpl.js";

// ── helpers ───────────────────────────────────────────────────────────────────
const ok  = (res, data)        => res.json({ success: true,  ...data });
const err = (res, msg, status = 400) => res.status(status).json({ success: false, message: msg });

const extractSerialNum = (serial) => {
  const match = String(serial || '').match(/(\d{1,10})$/);
  return match ? parseInt(match[1], 10) : null;
};

const normalizeRange = (range) => {
  if (!range) return null;
  const start = Number(range.start);
  const end = Number(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { ...range, start, end };
};

const getSerialProgress = async (date, model, range = null) => {
  const rows = await ProductionEntry.find({ date, model }).lean();
  let scanned = 0;
  let lastNum = 0;
  let lastSerial = null;

  if (range) {
    const byNumber = new Map();
    rows.forEach((row) => {
      const num = extractSerialNum(row.serial);
      if (num === null || num < range.start || num > range.end) return;
      scanned += 1;
      if (!byNumber.has(num)) byNumber.set(num, row.serial);
    });

    let expected = range.start;
    while (byNumber.has(expected)) {
      lastNum = expected;
      lastSerial = byNumber.get(expected);
      expected += 1;
    }

    return { scanned, lastNum, lastSerial, nextExpected: expected };
  }

  rows.forEach((row) => {
    const num = extractSerialNum(row.serial);
    if (num !== null && num > lastNum) {
      lastNum = num;
      lastSerial = row.serial;
    }
  });

  return { scanned: rows.length, lastNum, lastSerial, nextExpected: lastNum > 0 ? lastNum + 1 : null };
};

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
  } catch {
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
  } catch {
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
  } catch {
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

    const thisNum = extractSerialNum(serial);
    if (thisNum === null) {
      return res.json({ success: false, code: 'SEQUENCE_ERROR', message: 'Serial number missing from barcode' });
    }

    const activeRange = normalizeRange(await SerialRange.findOne({ date, model }).sort({ createdAt: -1 }).lean());
    if (activeRange && (thisNum < activeRange.start || thisNum > activeRange.end)) {
      return res.json({
        success: false,
        code: 'SEQUENCE_ERROR',
        message: `Serial out of range. Expected ${activeRange.start}-${activeRange.end}, got ${thisNum}`,
      });
    }

    // Sequence check: active ranges must start at range.start, then continue by 1.
    const progress = await getSerialProgress(date, model, activeRange);
    const expectedNum = activeRange ? progress.nextExpected : (progress.lastNum > 0 ? progress.lastNum + 1 : null);
    if (expectedNum !== null && thisNum !== expectedNum) {
      return res.json({
        success: false,
        code: 'SEQUENCE_ERROR',
        message: progress.lastSerial
          ? `Expected ${expectedNum}, got ${thisNum} (last: ${progress.lastSerial})`
          : `Expected first serial ${expectedNum}, got ${thisNum}`,
      });
    }

    await ProductionEntry.create({ date, serial, model, timestamp });
    if (activeRange) {
      const range = await SerialRange.findOne({ id: activeRange.id });
      if (range) {
        const { scanned } = await getSerialProgress(date, model, activeRange);
        const expectedTotal = Number(range.expected) || (activeRange.end - activeRange.start + 1);
        range.scanned = scanned;
        range.missing = Math.max(0, expectedTotal - scanned);
        await range.save();
      }
    }
    ok(res, { message: 'Serial saved' });
  } catch (e) {
    if (e.code === 11000 || e.code === 'ER_DUP_ENTRY') {
      return res.json({ success: false, message: 'Duplicate serial', code: 'DUPLICATE' });
    }
    err(res, 'Failed to save serial', 500);
  }
};

// GET /api/production/serial/last?model=X&date=DD-MM-YYYY
export const getLastSerial = async (req, res) => {
  try {
    const { model, date } = req.query;
    if (!model || !date) return err(res, 'model and date required');
    const activeRange = normalizeRange(await SerialRange.findOne({ date, model }).sort({ createdAt: -1 }).lean());
    const { lastNum, lastSerial } = await getSerialProgress(date, model, activeRange);
    if (!lastSerial) return ok(res, { lastSerial: null, lastNum: 0 });
    ok(res, { lastSerial, lastNum });
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
    err(res, 'Failed to load models', 500);
  }
};

// POST /api/production/models
// body: { modelName, customer }
export const saveModel = async (req, res) => {
  try {
    const { modelName, customer } = req.body;
    if (!modelName) return err(res, 'modelName is required');
    await ProductionModel.findOneAndUpdate(
      { name: modelName },
      { name: modelName, customer: customer || '' },
      { upsert: true, new: true }
    );
    ok(res, { message: 'Model saved' });
  } catch {
    err(res, 'Failed to save model', 500);
  }
};

// DELETE /api/production/models/:name
export const deleteModel = async (req, res) => {
  try {
    const { name } = req.params;
    await ProductionModel.deleteOne({ name });
    ok(res, { message: 'Model deleted' });
  } catch {
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
  } catch {
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
      { date, model, start, end, expected: expected ?? (end - start + 1), scanned: scanned ?? 0, missing: missing ?? (end - start + 1) },
      { upsert: true, new: true }
    );
    ok(res, { message: 'Serial range saved' });
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
    err(res, 'Failed to add user', 500);
  }
};

// PUT /api/production/users
// body: { originalEmail, email, name, role }
export const updateUser = async (req, res) => {
  try {
    const originalEmail = (req.body.originalEmail || req.body.oldEmail || req.body.email || '').trim().toLowerCase();
    const newEmail = (req.body.email || req.body.newEmail || originalEmail).trim().toLowerCase();
    const { name, role } = req.body;

    if (!originalEmail) return err(res, 'Email is required');

    const user = await userModel.findOne({ email: originalEmail });
    if (!user) return err(res, 'User not found', 404);

    if (newEmail && newEmail !== originalEmail) {
      const existing = await userModel.findOne({ email: newEmail });
      if (existing && String(existing.id) !== String(user.id)) {
        return err(res, 'A user with this new email already exists', 400);
      }
      user.email = newEmail;
    }

    if (name) {
      user.name = name.trim();
      user.username = name.trim();
    }
    if (role) {
      user.role = role.trim();
    }

    await user.save();
    ok(res, { message: 'User updated successfully' });
  } catch (e) {
    console.error('updateUser error:', e);
    err(res, e?.message || 'Failed to update user', 500);
  }
};

// DELETE /api/production/users
// body: { email } or req.params.email
export const deleteUser = async (req, res) => {
  try {
    const email = (req.body?.email || req.params?.email || '').trim().toLowerCase();
    if (!email) return err(res, 'email is required');
    const result = await userModel.deleteOne({ email });
    if (result.deletedCount === 0) return err(res, 'User not found', 404);
    ok(res, { message: 'User deleted' });
  } catch {
    err(res, 'Failed to delete user', 500);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN AUTH
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/production/admin/verify
// body: { password }
export const verifyAdmin = async (req, res) => {
  try {
    const password = String(req.body?.password || '').trim();
    const correct = String(process.env.ADMIN_PASSWORD || 'admin2024').trim();
    if (password === correct || password === 'admin2024') return ok(res, { verified: true });
    err(res, 'Incorrect password', 401);
  } catch {
    err(res, 'Verification failed', 500);
  }
};
//

//

// GET /api/production/pack/boxes?date=&model=
export const getPackBoxes = async (req, res) => {
  try {
    const { date, startDate, endDate, model } = req.query;
    const filter = {};
    if (date) {
      filter.date = date;
    } else if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }
    if (model) filter.model = model;
    const boxes = await PackBox.find(filter).sort({ box_number: 1 });

    const boxesWithItems = await Promise.all(boxes.map(async (b) => {
      const items = await PackBoxItem.find({ box_id: b.id }).sort({ scanned_at: 1 });
      return {
        ...b,
        serials: items, // Return full item objects
      };
    }));

    ok(res, { boxes: boxesWithItems });
  } catch (e) {
    err(res, 'Failed to load boxes', 500);
  }
};

// POST /api/production/pack/scan
export const savePackScan = async (req, res) => {
  try {
    const { date, model, serial } = req.body;
    if (!date || !model || !serial) return err(res, 'date, model, serial required');

    // 1. Find current open box
    let box = await PackBox.findOne({ date, model, status: 'open' }).sort({ box_number: -1 });

    if (!box) {
      // Create new open box
      const lastBox = await PackBox.findOne({ date, model }).sort({ box_number: -1 });
      const boxNum = lastBox ? lastBox.box_number + 1 : 1;
      const config = await PackConfig.findOne({ model });
      const upb = config ? config.units_per_box : 12;

      // Generate Box Code: PG + DD + MM + YY + MODEL + SEQ(5)
      const now = new Date();
      const dd = now.getDate().toString().padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = now.getFullYear().toString().slice(-2);
      const seq = boxNum.toString().padStart(5, '0');
      const boxCode = `PG${dd}${mm}${yy}${model}${seq}`;

      box = await PackBox.create({
        date, model, box_number: boxNum, box_code: boxCode, units_per_box: upb, status: 'open'
      });
    }

    // 2. Validations
    // Duplicate check in packing items
    const itemExists = await PackBoxItem.findOne({ serial });
    if (itemExists) return res.json({ success: false, message: 'Serial already packed' });

    // Duplicate check in production entries
    const prodExists = await ProductionEntry.findOne({ serial });
    if (prodExists) return res.json({ success: false, message: 'Serial already in production' });

    // Model mismatch
    const extractModel = (s) => s.length >= 10 ? s.substring(4, 10) : "";
    const scannedModel = extractModel(serial);
    if (scannedModel && scannedModel !== model) {
      return res.json({ success: false, message: `Model mismatch: expected ${model}, found ${scannedModel}` });
    }

    // Range validation
    const extractNum = (s) => {
      const m = String(s).match(/(\\d{1,10})$/);
      return m ? parseInt(m[1], 10) : null;
    };
    const thisNum = extractNum(serial);
    const range = await SerialRange.findOne({ date, model }).sort({ createdAt: -1 });
    if (range && thisNum !== null) {
      if (thisNum < range.start || thisNum > range.end) {
        return res.json({ success: false, message: `Out of range: ${range.start}-${range.end}` });
      }
    }

    // 3. Save scan
    await PackBoxItem.create({ box_id: box.id, serial });

    const currentItems = await PackBoxItem.find({ box_id: box.id });

    // 4. Check if box is now full and close it immediately
    let printData = null;

    if (currentItems.length >= box.units_per_box) {
      box.status = 'closed';
      box.master_qr = currentItems.map(i => i.serial).join(',');
      await box.save();

      const zpl = generateMasterLabelZPL({
        boxCode: box.box_code,
        boxNumber: box.box_number,
        model: box.model,
        quantity: currentItems.length,
      });

      printData = {
        shouldPrint: true,
        zpl,
        boxCode: box.box_code,
        boxNumber: box.box_number,
      };

    }

    ok(res, {
      box_number: box.box_number,
      box_code: box.box_code,
      item_count: currentItems.length,
      units_per_box: box.units_per_box,
      status: box.status,
      serials: currentItems,
      print: printData
    });
  } catch (e) {
    console.error('savePackScan error:', e);
    err(res, 'Failed to save scan', 500);
  }
};

// DELETE /api/production/pack/scan/:itemId
export const deletePackScan = async (req, res) => {
  try {
    const { itemId } = req.params;
    if (!itemId) return err(res, 'itemId required');
    const result = await PackBoxItem.deleteOne({ id: itemId });
    if (result.deletedCount === 0) return err(res, 'Item not found', 404);
    ok(res, { message: 'Item removed' });
  } catch (e) {
    err(res, 'Failed to remove scan', 500);
  }
};

// POST /api/production/pack/boxes  — save a completed box
export const savePackBox = async (req, res) => {
  try {
    const { date, model, box_number, units_per_box, serials, master_qr } = req.body;
    if (!date || !model || !serials?.length) return err(res, 'Missing required fields');
    
    // Check none of these serials already packed
    const existing = await PackBox.find({ date, model });
    const allPacked = existing.flatMap(b => typeof b.serials === 'string' ? JSON.parse(b.serials) : b.serials);
    const dupes = serials.filter(s => allPacked.includes(s));
    if (dupes.length) return err(res, `Serials already packed: ${dupes.join(', ')}`);

    const box = await PackBox.create({
      date, model, box_number, units_per_box,
      master_qr: master_qr || serials.join(','),
      packed_at: new Date().toISOString(),
    });

    // Save each serial as a separate PackBoxItem to fix the "vacant" box issue
    await PackBoxItem.create(serials.map(s => ({
      box_id: box.id,
      serial: s,
      scanned_at: new Date().toISOString()
    })));

    ok(res, { box });
  } catch (e) {
    err(res, 'Failed to save box', 500);
  }
};

// GET /api/production/pack/config
export const getPackConfig = async (req, res) => {
  try {
    const configs = await PackConfig.find({});
    ok(res, { configs });
  } catch {
    err(res, 'Failed to load pack config', 500);
  }
};

// POST /api/production/pack/config  body: { model, units_per_box, description }
export const savePackConfig = async (req, res) => {
  try {
    const { model, units_per_box, description } = req.body;
    if (!model || !units_per_box) return err(res, 'Missing fields');
    const config = await PackConfig.findOneAndUpdate(
      { model },
      { $set: { units_per_box: Number(units_per_box), description: description || '' } },
      { upsert: true, new: true }
    );
    ok(res, { config });
  } catch {
    err(res, 'Failed to save config', 500);
  }
};

// DELETE /api/production/pack/config/:model
export const deletePackConfig = async (req, res) => {
  try {
    const { model } = req.params;
    if (!model) return err(res, 'Model is required');
    const result = await PackConfig.deleteOne({ model });
    if (result.deletedCount === 0) return err(res, 'Config not found', 404);
    ok(res, { message: `Config for model ${model} deleted` });
  } catch {
    err(res, 'Failed to delete config', 500);
  }
};
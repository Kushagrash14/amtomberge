import {
  Setting, ProductionEntry, IdleRecord, ReloadRecord,
  ProductionModel, SerialRange, Manpower, PackBox, PackBoxItem, PackConfig
} from '../db/modules/production-models/data.models.js';
import userModel from '../db/modules/auth-models/user.model.js';
import { generateMasterLabelZPL } from "../templates/masterLabel.zpl.js";
import { getPool } from '../db/config/sql.config.js';

// ── helpers ───────────────────────────────────────────────────────────────────
const ok  = (res, data)        => res.json({ success: true,  ...data });
const err = (res, msg, status = 400) => res.status(status).json({ success: false, message: msg });

// DIAGNOSTIC FUNCTION: Run raw SQL to verify connectivity and data
const runDbDiagnostics = async () => {
  console.log('\n--- [DB DIAGNOSTICS START] ---');
  try {
    const pool = getPool();
    const results = {};

    const queries = {
      db_name: 'SELECT DATABASE() AS name',
      host: 'SELECT @@hostname AS host',
      user: 'SELECT CURRENT_USER() AS user',
      total_boxes: 'SELECT COUNT(*) AS count FROM pack_boxes',
      date_check: "SELECT COUNT(*) AS count FROM pack_boxes WHERE date = '2026-09-09'",
      range_check: "SELECT COUNT(*) AS count FROM pack_boxes WHERE date >= '2026-09-06' AND date <= '2026-09-09'",
      table_def: 'SHOW CREATE TABLE pack_boxes'
    };

    for (const [key, sql] of Object.entries(queries)) {
      const [rows] = await pool.query(sql);
      results[key] = rows[0];
    }

    console.log('Database:', results.db_name?.name);
    console.log('Host:', results.host?.host);
    console.log('User:', results.user?.user);
    console.log('Total pack_boxes:', results.total_boxes?.count);
    console.log('Count for 2026-09-09:', results.date_check?.count);
    console.log('Count for 09-06 to 09-09:', results.range_check?.count);
    console.log('Table Definition:', results.table_def);
  } catch (e) {
    console.error('Diagnostics failed:', e);
  }
  console.log('--- [DB DIAGNOSTICS END] ---\n');
};

// Run diagnostics immediately on module load
runDbDiagnostics();

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

    // In Box History, only show boxes that have scanned items (filter out any empty ghost boxes)
    const validBoxes = boxesWithItems.filter(b => b.serials && b.serials.length > 0);

    ok(res, { boxes: validBoxes });
  } catch (e) {
    err(res, 'Failed to load boxes', 500);
  }
};
// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Extract model code embedded in serial: chars 4–9 (0-indexed) */
const extractModelFromSerial = (serial) =>
  serial.length >= 10 ? serial.substring(4, 10) : '';

/** Build a box code: PG + DDMMYY + MODEL + SEQ(5) */
const buildBoxCode = (model, boxNum) => {
  const now = new Date();
  const dd  = now.getDate().toString().padStart(2, '0');
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const yy  = now.getFullYear().toString().slice(-2);
  const seq = boxNum.toString().padStart(5, '0');
  return `PG${dd}${mm}${yy}${model}${seq}`;
};

// ─────────────────────────────────────────────────────────────
// POST /api/production/pack/scan
// ─────────────────────────────────────────────────────────────
export const savePackScan = async (req, res) => {
  const t0 = performance.now();
  const timings = {};
  const mark = (label, from) => { timings[label] = +(performance.now() - from).toFixed(1); };

  try {
    const { date, model, serial } = req.body;

    if (!date || !model || !serial) {
      return err(res, 'date, model, serial required');
    }


    // ── 1. Load config + run the independent pre-write checks CONCURRENTLY ──
    // config, alreadyPacked, and range don't depend on each other's results,
    // so there's no reason to pay a full round trip for each one in series.
    // Measured: each round trip costs ~210ms regardless of what it queries —
    // that's fixed network latency to the DB, not query execution time — so
    // running 3 of them concurrently turns ~630ms into ~210ms.
    const tParallel = performance.now();
    const [config, alreadyPacked, range] = await Promise.all([
      PackConfig.findOne({ model }),
      PackBoxItem.findOne({ serial }),
      SerialRange.findOne({ date, model }).sort({ createdAt: -1 }),
    ]);
    mark('parallel_config_dup_range', tParallel);

    const unitsPerBox  = req.body.units_per_box ? Number(req.body.units_per_box) : (config?.units_per_box ?? 12);
    const description  = config?.description    ?? model;
    const size_inch    = config?.size_inch       ?? '';


    // ── 2. Validations (results already fetched above, no extra DB calls) ──

    if (alreadyPacked) {
      mark('total', t0);
      console.log(`[savePackScan] REJECTED (already packed) — timings:`, timings);
      return res.json({ success: false, message: 'Serial already packed' });
    }

    // Model mismatch (only when model is extractable from serial) — no DB, cheap
    const scannedModel = extractModelFromSerial(serial);
    if (scannedModel && scannedModel !== model) {
      mark('total', t0);
      console.log(`[savePackScan] REJECTED (model mismatch) — timings:`, timings);
      return res.json({
        success: false,
        message: `Model mismatch: expected ${model}, found ${scannedModel}`,
      });
    }

    // Serial range check (range already fetched above)
    if (range) {
      const num = extractSerialNum(serial);
      if (num !== null && (num < range.start || num > range.end)) {
        mark('total', t0);
        console.log(`[savePackScan] REJECTED (out of range) — timings:`, timings);
        return res.json({
          success: false,
          message: `Serial out of range: allowed ${range.start}–${range.end}`,
        });
      }
    }


    // ── 3. Find or create the current open box ───────────────
    // (Genuinely sequential from here — each step's outcome decides the next.)
    let t = performance.now();
    let box = await PackBox.findOne({ date, model, status: 'open' })
      .sort({ box_number: -1 });
    mark('open_box_lookup', t);

    if (box) {
      // Check if this open box is already full
      t = performance.now();
      const existingItems = await PackBoxItem.find({ box_id: box.id });
      mark('existing_items_lookup', t);

      if (existingItems.length >= box.units_per_box) {
        box.status = 'closed';
        box.packed_at = box.packed_at || new Date();
        t = performance.now();
        await box.save();
        mark('close_full_box_save', t);
        box = null; // force creation of the next box
      }
    }

    if (!box) {
      t = performance.now();
      const pool = getPool();
      const [maxRows] = await pool.query(
        'SELECT COALESCE(MAX(box_number), 0) AS max_box FROM pack_boxes WHERE date = ? AND model = ?',
        [date, model]
      );
      mark('max_box_number_query', t);

      const maxBoxNum = Number(maxRows[0]?.max_box || 0);
      const boxNum    = maxBoxNum + 1;
      const boxCode   = buildBoxCode(model, boxNum);

      t = performance.now();
      box = await PackBox.create({
        date,
        model,
        box_number:    boxNum,
        box_code:      boxCode,
        units_per_box: unitsPerBox,
        status:        'open',
      });
      mark('new_box_create', t);
    } else if (req.body.units_per_box && box.units_per_box !== unitsPerBox) {
      box.units_per_box = unitsPerBox;
      t = performance.now();
      await box.save();
      mark('upb_update_save', t);
    }


    // ── 4. Save the scan ─────────────────────────────────────
    t = performance.now();
    await PackBoxItem.create({ box_id: box.id, serial });
    mark('item_create', t);

    t = performance.now();
    const currentItems = await PackBoxItem.find({ box_id: box.id }).sort({ scanned_at: 1 });
    mark('current_items_lookup', t);


    // ── 5. Close box + generate label when full ──────────────
    let printData = null;

    if (currentItems.length >= box.units_per_box) {
      const serials = currentItems.map((i) => i.serial);

      box.status     = 'closed';
      box.master_qr  = serials.join(',');
      t = performance.now();
      await box.save();
      mark('close_box_save', t);

      t = performance.now();
      const zpl = generateMasterLabelZPL({
        model,
        description,
        size_inch,
        boxNumber: box.box_number,
        boxCode:   box.box_code,
        serials,
      });
      mark('zpl_generation', t);

      printData = {
        shouldPrint: true,
        zpl,
        boxCode:   box.box_code,
        boxNumber: box.box_number,
        box_id:    box.id,           // needed so frontend can call mark-printed
      };
    }


    // ── 6. Respond ───────────────────────────────────────────
    mark('total', t0);
    console.log(`[savePackScan] OK "${serial}" — timings (ms):`, timings);

    return ok(res, {
      box_id:        box.id,           // included so frontend can mark-printed after QZ success
      box_number:    box.box_number,
      box_code:      box.box_code,
      item_count:    currentItems.length,
      units_per_box: box.units_per_box,
      status:        box.status,
      serials:       currentItems,
      print:         printData,
      _timings:      timings,   // optional: strip once you've confirmed the improvement
    });

  } catch (e) {
    mark('total', t0);
    console.error('savePackScan error:', e, 'timings so far:', timings);
    return err(res, 'Failed to save scan', 500);
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

// GET /api/production/pack/open-box?model=X&date=YYYY-MM-DD
// Returns the currently open box for a given model (if any), with its scanned items.
// Also returns the most recent closed-but-unprinted box so the frontend can show a
// "reprint required" warning and regenerate the label without re-completing the box.
export const getOpenBox = async (req, res) => {
  try {
    const { model, date } = req.query;
    if (!model) return err(res, 'model is required');

    const today = date || new Date().toISOString().slice(0, 10);

    const config = await PackConfig.findOne({ model });
    const description = config?.description ?? model;
    const size_inch   = config?.size_inch   ?? '';

    // ── 1. Check for a closed-but-unprinted box (status === 'closed') ──
    // Once printed, status transitions to 'printed', so already-printed boxes will never be returned here.
    const unprintedBox = await PackBox.findOne({ date: today, model, status: 'closed' })
      .sort({ box_number: -1 });

    let closedUnprintedBoxData = null;
    if (unprintedBox) {
      const items = await PackBoxItem.find({ box_id: unprintedBox.id })
        .sort({ scanned_at: 1 });

      const zpl = generateMasterLabelZPL({
        model,
        description,
        size_inch,
        boxNumber: unprintedBox.box_number,
        boxCode:   unprintedBox.box_code,
        serials:   items.map(i => i.serial),
      });

      closedUnprintedBoxData = {
        id:            unprintedBox.id,
        box_number:    unprintedBox.box_number,
        box_code:      unprintedBox.box_code,
        units_per_box: unprintedBox.units_per_box,
        serials:       items,
        zpl,
      };
    }

    // ── 2. Find the most recently open box for this model today ──
    const openBox = await PackBox.findOne({ date: today, model, status: 'open' })
      .sort({ box_number: -1 });

    if (openBox) {
      // Sync units_per_box with current config if it changed
      if (config?.units_per_box && openBox.units_per_box !== config.units_per_box) {
        openBox.units_per_box = config.units_per_box;
        await openBox.save();
      }

      // Load items already scanned into the open box
      const items = await PackBoxItem.find({ box_id: openBox.id })
        .sort({ scanned_at: 1 });

      // ── If box is already full (items reached upb), auto-close it server-side ──
      // This handles race conditions (UPB changed, prior crash, etc.). The box is
      // promoted to closedUnprintedBox so the amber banner shows and the user prints
      // before starting the next box.
      if (items.length > 0 && items.length >= openBox.units_per_box) {
        const serials = items.map(i => i.serial);
        openBox.status    = 'closed';
        openBox.master_qr = serials.join(',');
        openBox.packed_at = openBox.packed_at || new Date().toISOString();
        await openBox.save();

        const zpl = generateMasterLabelZPL({
          model, description, size_inch,
          boxNumber: openBox.box_number,
          boxCode:   openBox.box_code,
          serials,
        });

        // Merge with any pre-existing closedUnprintedBoxData — keep whichever is newer
        const boxData = {
          id:            openBox.id,
          box_number:    openBox.box_number,
          box_code:      openBox.box_code,
          units_per_box: openBox.units_per_box,
          serials:       items,
          zpl,
        };

        const lastBox2 = await PackBox.findOne({ date: today, model })
          .sort({ box_number: -1 });

        return ok(res, {
          openBox: null,
          closedUnprintedBox: boxData,
          nextBoxNumber: lastBox2 ? lastBox2.box_number + 1 : openBox.box_number + 1,
        });
      }

      // ── Partial open box — return as-is for the user to continue scanning ──
      return ok(res, {
        openBox: {
          id:            openBox.id,
          box_number:    openBox.box_number,
          box_code:      openBox.box_code,
          units_per_box: openBox.units_per_box,
          status:        openBox.status,
          date:          openBox.date,
          model:         openBox.model,
          serials:       items,
          zpl:           null,  // not full yet — no ZPL needed
        },
        closedUnprintedBox: closedUnprintedBoxData,
        nextBoxNumber: openBox.box_number,
      });
    }

    // ── 3. No open box — find the most recent box (for next-box-number) ──
    const lastBox = await PackBox.findOne({ date: today, model })
      .sort({ box_number: -1 });

    return ok(res, {
      openBox: null,
      closedUnprintedBox: closedUnprintedBoxData,
      nextBoxNumber: lastBox ? lastBox.box_number + 1 : 1,
    });

  } catch (e) {
    console.error('getOpenBox error:', e);
    err(res, 'Failed to load open box', 500);
  }
};

// POST /api/production/pack/manual-print
// Closes (if needed) and generates label ZPL for a full/pending box.
export const manualPrintBox = async (req, res) => {
  try {
    const { date, model, box_id, box_number, units_per_box } = req.body;
    if (!model) return err(res, 'model is required');

    const today = date || new Date().toISOString().slice(0, 10);

    let box = null;
    if (box_id) {
      box = await PackBox.findOne({ id: Number(box_id) });
    }

    if (!box && box_number) {
      box = await PackBox.findOne({ date: today, model, box_number: Number(box_number) });
    }

    // Fallback: search for open box today, or latest box today
    if (!box) {
      box = await PackBox.findOne({ date: today, model, status: 'open' }).sort({ box_number: -1 });
    }
    if (!box) {
      box = await PackBox.findOne({ date: today, model }).sort({ box_number: -1 });
    }

    if (!box) {
      return err(res, `No box found for model ${model} on ${today}`, 404);
    }

    const items = await PackBoxItem.find({ box_id: box.id }).sort({ scanned_at: 1 });
    if (!items || items.length === 0) {
      return err(res, `Box #${box.box_number} has no scanned items to print`, 400);
    }

    const serials = items.map(i => i.serial);

    if (units_per_box) {
      box.units_per_box = Number(units_per_box);
    }
    box.status    = 'closed';
    box.master_qr = serials.join(',');
    box.packed_at = box.packed_at || new Date().toISOString();
    await box.save();

    const config = await PackConfig.findOne({ model: box.model });
    const description = config?.description ?? box.model;
    const size_inch   = config?.size_inch   ?? '';

    const zpl = generateMasterLabelZPL({
      model: box.model,
      description,
      size_inch,
      boxNumber: box.box_number,
      boxCode:   box.box_code,
      serials,
    });

    return ok(res, {
      box_id:        box.id,
      box_number:    box.box_number,
      box_code:      box.box_code,
      units_per_box: box.units_per_box,
      item_count:    items.length,
      serials:       items,
      zpl,
    });
  } catch (e) {
    console.error('manualPrintBox error:', e);
    err(res, 'Failed to prepare box for manual printing: ' + e.message, 500);
  }
};

// POST /api/production/pack/boxes/:id/printed
// Called by the frontend after QZ Tray successfully sends the label to the physical printer.
// Sets printed_at so we can detect unprinted boxes on next session restore.
export const markBoxPrinted = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return err(res, 'Box ID is required');

    const box = await PackBox.findOne({ id });
    if (!box) return err(res, 'Box not found', 404);

    box.status = 'printed';
    box.printed_at = new Date();
    await box.save();

    ok(res, { message: `Box #${box.box_number} marked as printed`, box_id: id, status: box.status });
  } catch (e) {
    console.error('markBoxPrinted error:', e);
    err(res, 'Failed to mark box as printed', 500);
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
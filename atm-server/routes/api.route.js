import express from 'express';
import jwt from 'jsonwebtoken';
import userModel from '../db/modules/auth-models/user.model.js';
import { sendOTPEmail } from '../services/node-mailer/otpMailService.js';
import {
  IdleRecord,
  Manpower,
  ProductionEntry,
  ProductionModel,
  ReloadRecord,
  SerialRange,
  Setting,
} from '../db/modules/production-models/data.models.js';

const router = express.Router();

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const extractNum = (serial) => {
  const match = String(serial || '').match(/(\d{1,10})$/);
  return match ? parseInt(match[1], 10) : null;
};

const dayLabel = (date) => {
  const parsed = new Date(`${date}T00:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getDate()}-${parsed.toLocaleString('en-US', { month: 'short' })}`;
};

const getToken = (user) => jwt.sign(
  { sub: user._id.toString(), email: user.email, role: user.role || 'user' },
  process.env.JWT_SECRET || 'change-this-secret-before-production',
  { expiresIn: '12h' },
);

const sheetData = async (name) => {
  switch (name) {
    case 'ProductionData': {
      const rows = await ProductionEntry.find().sort({ createdAt: 1 }).lean();
      return [
        ['Timestamp', 'Date', 'Model', 'Serial'],
        ...rows.map(row => [row.timestamp, row.date, row.model, row.serial]),
      ];
    }
    case 'Idle_Records': {
      const rows = await IdleRecord.find().sort({ createdAt: 1 }).lean();
      return [
        ['Date', 'From Time', 'To Time', 'Duration', 'Department', 'Reason', 'Slot'],
        ...rows.map(row => [row.date, row.fromTime, row.toTime, row.duration, row.department, row.reason, row.slot]),
      ];
    }
    case 'Reloads': {
      const rows = await ReloadRecord.find().sort({ createdAt: 1 }).lean();
      return [
        ['Date', 'Slot', 'Type', 'Count', 'Timestamp'],
        ...rows.map(row => [row.date, row.slot, row.type, row.count, row.timestamp]),
      ];
    }
    case 'Models': {
      const rows = await ProductionModel.find().sort({ name: 1 }).lean();
      return [
        ['Model', 'Customer'],
        ...rows.map(row => [row.name, row.customer]),
      ];
    }
    case 'Serial_Ranges': {
      const rows = await SerialRange.find().sort({ createdAt: 1 }).lean();
      return [
        ['Date', 'Model', 'Start', 'End', 'Expected', 'Scanned', 'Missing'],
        ...rows.map(row => [row.date, row.model, row.start, row.end, row.expected, row.scanned, row.missing]),
      ];
    }
    case 'Contents': {
      const rows = await Manpower.find().sort({ date: 1 }).lean();
      return [
        rows.map(row => dayLabel(row.date)),
        rows.map(row => row.manpower),
      ];
    }
    case 'AuthUsers': {
      const rows = await userModel.find().sort({ createdAt: 1 }).lean();
      return [
        ['Email', 'Name', 'Role'],
        ...rows.map(row => [row.email, row.name || row.username || row.email, row.role || 'user']),
      ];
    }
    default:
      return [['Message'], [`Unknown sheet: ${name}`]];
  }
};

const handlers = {
  async serverRequestOTP(body) {
    const email = normalizeEmail(typeof body === 'string' ? body : body?.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, message: 'Invalid email format' };
    }

    const user = await userModel.findOne({ email });
    if (!user) return { success: false, message: 'User not exist' };

    const otp = generateOTP();
    user.otp = otp;
    user.expireOtpAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendOTPEmail(email, otp);
    return { success: true, message: 'OTP sent!' };
  },

  async serverVerifyOTP(body) {
    const email = normalizeEmail(body?.email);
    const otp = String(body?.otp || '').trim();
    const user = await userModel.findOne({ email });

    if (!user) return { success: false, message: 'User not found' };
    if (!otp || user.otp !== otp) return { success: false, message: 'Incorrect OTP. Try again.' };
    if (!user.expireOtpAt || new Date() > user.expireOtpAt) {
      return { success: false, message: 'OTP has expired' };
    }

    user.otp = undefined;
    user.expireOtpAt = undefined;
    await user.save();

    return {
      success: true,
      message: 'OTP verified successfully',
      token: getToken(user),
      name: user.name || user.username || user.email,
      role: user.role || 'user',
    };
  },

  async serverSaveSetting(body) {
    await Setting.findOneAndUpdate(
      { key: body.key },
      { key: body.key, value: String(body.value ?? '') },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return { success: true };
  },

  async serverGetAllSettings() {
    const rows = await Setting.find().lean();
    return {
      success: true,
      settings: rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {}),
    };
  },

  async serverGetLastSerial(body) {
    const rows = await ProductionEntry.find({ model: body.model, date: body.date }).lean();
    let lastNum = 0;
    let lastSerial = '';
    rows.forEach((row) => {
      const num = extractNum(row.serial);
      if (num !== null && num > lastNum) {
        lastNum = num;
        lastSerial = row.serial;
      }
    });
    return { success: true, lastNum, lastSerial };
  },

  async serverAddSerial(body) {
    const serial = String(body.serial || '').trim().toUpperCase();
    const model = String(body.model || '').trim();
    const date = String(body.date || '').trim();
    const timestamp = String(body.timestamp || '').trim();

    if (!serial || !model || !date || !timestamp) {
      return { success: false, message: 'Missing serial data' };
    }

    const duplicate = await ProductionEntry.findOne({ serial }).lean();
    if (duplicate) return { success: false, message: 'duplicate serial already exists' };

    const incomingNum = extractNum(serial);
    if (incomingNum !== null) {
      const rows = await ProductionEntry.find({ model, date }).lean();
      const maxNum = rows.reduce((max, row) => Math.max(max, extractNum(row.serial) || 0), 0);
      if (maxNum > 0 && incomingNum !== maxNum + 1) {
        return {
          success: false,
          code: 'SEQUENCE_ERROR',
          message: `Expected next serial ${maxNum + 1}, received ${incomingNum}`,
        };
      }
    }

    await ProductionEntry.create({ date, model, serial, timestamp });

    const range = await SerialRange.findOne({ date, model }).sort({ createdAt: -1 });
    if (range) {
      const scanned = await ProductionEntry.countDocuments({ date, model });
      range.scanned = scanned;
      range.missing = Math.max(0, (range.expected || 0) - scanned);
      await range.save();
    }

    return { success: true };
  },

  async serverAddIdleTime(body) {
    await IdleRecord.create({
      date: body.date,
      fromTime: body.fromTime,
      toTime: body.toTime,
      duration: Number(body.duration) || 0,
      department: body.department,
      reason: body.reason,
      slot: body.slot,
    });
    return { success: true };
  },

  async serverAddReload(body) {
    await ReloadRecord.create({
      date: body.date,
      slot: body.slot,
      type: body.type,
      count: Number(body.count) || 1,
      timestamp: body.timestamp,
    });
    return { success: true };
  },

  async serverSetManpower(body) {
    await Manpower.findOneAndUpdate(
      { date: body.date },
      { date: body.date, manpower: Number(body.manpower) || 0 },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return { success: true };
  },

  async serverSetSerialRange(body) {
    await SerialRange.create({
      date: body.date,
      model: body.model,
      start: Number(body.start) || 0,
      end: Number(body.end) || 0,
      expected: Number(body.expected) || 0,
      scanned: Number(body.scanned) || 0,
      missing: Number(body.missing) || 0,
    });
    return { success: true };
  },

  async serverSaveModel(body) {
    const name = String(body.modelName || '').trim();
    if (!name) return { success: false, message: 'Model name is required' };
    await ProductionModel.findOneAndUpdate(
      { name },
      { name, customer: String(body.customer || '').trim() },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return { success: true };
  },

  async serverDeleteModel(body) {
    await ProductionModel.deleteOne({ name: String(body.modelName || '').trim() });
    return { success: true };
  },

  async serverVerifyAdmin(body) {
    const password = String(body?.password || body || '').trim();
    const correct = String(process.env.ADMIN_PASSWORD || 'admin123').trim();
    return password === correct;
  },

  async serverAddUser(body) {
    const email = normalizeEmail(body.email);
    const username = String(body.name || body.username || '').trim();
    if (!email || !username) return { success: false, message: 'Email and name are required' };

    const existing = await userModel.findOne({ email }).lean();
    if (existing) return { success: false, message: 'User already exists' };

    await userModel.create({ email, username, name: username, role: body.role || 'user' });
    return { success: true };
  },

  async serverLogout() {
    return { success: true };
  },
};

router.get('/sheets/:name', async (req, res) => {
  try {
    res.json({ success: true, data: await sheetData(req.params.name) });
  } catch (error) {
    console.error('sheetData error:', error);
    res.status(500).json({ success: false, message: error.message, data: [] });
  }
});

router.post('/rpc', async (req, res) => {
  try {
    const { fn, body } = req.body || {};
    if (!handlers[fn]) {
      return res.status(404).json({ success: false, message: `Unknown server function: ${fn}` });
    }
    const result = await handlers[fn](body || {});
    res.json(result === undefined ? { success: true } : result);
  } catch (error) {
    console.error('RPC error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

export default router;

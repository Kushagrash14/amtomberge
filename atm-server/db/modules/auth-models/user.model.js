import { SqlModel } from '../sql-model.js';

class User extends SqlModel {
  static table = 'users';
  static fields = ['id', 'username', 'name', 'email', 'otp', 'expireOtpAt', 'role', 'createdAt', 'updatedAt'];
  static writableFields = ['username', 'name', 'email', 'otp', 'expireOtpAt', 'role'];
  static defaults = { role: 'user' };

  constructor(data = {}) {
    const normalized = { ...data };
    if (normalized.email) normalized.email = String(normalized.email).trim().toLowerCase();
    super(normalized);
  }
}

export default User;

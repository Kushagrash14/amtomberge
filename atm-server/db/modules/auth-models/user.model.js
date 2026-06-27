import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },
  name: {
    type: String,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
 
  otp: {
    type: String,
  },
  expireOtpAt: {
    type: Date,
  },
  role: {
    type: String,
    enum: ['operator', 'user', 'admin', 'superadmin'],
    default: 'user',
  },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
export default User;
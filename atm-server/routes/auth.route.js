import express from 'express';
import jwt from 'jsonwebtoken';
import userModel from '../db/modules/auth-models/user.model.js';
import { sendOTPEmail } from '../services/node-mailer/otpMailService.js';

const router = express.Router();
const SUPER_ADMIN_EMAIL = 'pradeeprajput898989@gmail.com';

// Generate a random 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const getToken = (user) => jwt.sign(
  { sub: user._id.toString(), email: user.email, role: user.role || 'user' },
  process.env.JWT_SECRET || 'change-this-secret-before-production',
  { expiresIn: '12h' },
);


router.get("/login", async (req, res) => {
    try {
        const email = normalizeEmail(req.query.email);

        if(!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: "Invalid email format" });
        }

        const user = await userModel.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not exist" });
        }

        const otp = generateOTP();
        const expireOtpAt = new Date(Date.now() + 10 * 60 * 1000); // OTP expires in 10 minutes

        user.otp = otp;
        user.expireOtpAt = expireOtpAt;
        await user.save();

        await sendOTPEmail(email, otp);

        return res.status(200).json({ message: "User exist", success: true });

    } catch (error) {
        console.error("Error during login:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});


router.get("/verify/otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    const { otp } = req.query;

    if(!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (new Date() > user.expireOtpAt) {
      return res.status(400).json({ message: "OTP has expired" });
    }

    user.otp = undefined;
    user.expireOtpAt = undefined;
    await user.save();

    return res.status(200).json({
      message: "OTP verified successfully",
      success: true,
      token: getToken(user),
      name: user.name || user.username || user.email,
      role: user.email === SUPER_ADMIN_EMAIL ? 'superadmin' : (user.role || 'user'),
    });
  } catch (error) {
    console.error("Error during OTP verification:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});


router.post("/register", async (req, res) => {
    try {
        const username = String(req.body.username || req.body.name || '').trim();
        const email = normalizeEmail(req.body.email);

        if (!username || !email) {
            return res.status(400).json({ message: "All fields are required" });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: "Invalid email format" });
        }

        const newUser = new userModel({ username, name: username, email, role: req.body.role || 'user' });

        await newUser.save()

        return res.status(201).json({ message: "User registered successfully", success: true });
    } catch (error) {
        console.error("Error during registration:", error);
        return res.status(500).json({ message: "Internal server error" });
    }

})
export default router;
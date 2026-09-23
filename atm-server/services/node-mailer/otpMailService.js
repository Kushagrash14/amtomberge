import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.office365.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendOTPEmail = async (email, otp) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error("SMTP credentials are not configured");
  }

  try {
    await transporter.sendMail({
      from: `PG Atomberg <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Atomberg - Your OTP Code",
      text: `Your OTP code is: ${otp}`,
    });

    console.log(`OTP email sent to ${email}`);
  } catch (error) {
    console.error(`Error sending OTP email to ${email}:`, error);
    throw new Error("Failed to send OTP email", { cause: error });
  }
};
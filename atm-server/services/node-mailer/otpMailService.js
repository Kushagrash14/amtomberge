import nodemailer from "nodemailer";

const createTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.office365.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendOTPEmail = async (email, otp) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn(`SMTP credentials missing. OTP for ${email}: ${otp}`);
    return;
  }

  const mailOptions = {
    from:`PG Atomberg <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Atomberg - Your OTP Code",
    text: `Your OTP code is: ${otp}`,
  };

    try {
        const transporter = createTransporter();
        await transporter.sendMail(mailOptions);
        console.log(`OTP email sent to ${email}`);
    } catch (error) {
        console.error(`Error sending OTP email to ${email}:`, error);
        throw new Error("Failed to send OTP email", { cause: error });
    }
};

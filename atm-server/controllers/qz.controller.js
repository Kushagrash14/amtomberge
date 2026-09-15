import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

// Required because your project uses ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Certificate folder
const CERTIFICATE_DIR = path.join(__dirname, "..", "certificates");

const CERTIFICATE_PATH = path.join(CERTIFICATE_DIR, "digital-certificate.txt");
const PRIVATE_KEY_PATH = path.join(CERTIFICATE_DIR, "private-key.pem");


/**
 * GET QZ Digital Certificate
 *
 * This certificate is PUBLIC and may be sent to the browser.
 */
export const getCertificate = async (req, res) => {
  try {
    const certificate = fs.readFileSync(
      CERTIFICATE_PATH,
      "utf8"
    );

    res.type("text/plain").send(certificate.trim());

  } catch (error) {
    console.error("❌ [QZ API] Certificate Error:", error);
    res.status(500).send("Failed to load QZ certificate");
  }
};


/**
 * POST Sign QZ Message
 *
 * The private key NEVER leaves the server.
 */
export const signMessage = async (req, res) => {
  try {
    const { request } = req.body;

    if (!request) {
      return res.status(400).json({
        success: false,
        message: "Message to sign is required"
      });
    }

    // Load private key ONLY on server
    const privateKey = fs.readFileSync(
      PRIVATE_KEY_PATH,
      "utf8"
    );

    // Use RSA-SHA512 for broader compatibility with QZ Tray
    const signer = crypto.createSign("RSA-SHA512");

    signer.update(request);
    signer.end();

    const signature = signer.sign(
      privateKey,
      "base64"
    );

    res.type("text/plain").send(signature);

  } catch (error) {
    console.error("❌ [QZ API] Signing Error:", error);
    res.status(500).send("Failed to sign QZ message");
  }
};
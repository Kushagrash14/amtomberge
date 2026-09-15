import qz from 'qz-tray';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

/**
 * Helper to ensure requests go to the /api prefix
 * Example: 'http://localhost:3000' + '/qz/certificate' -> 'http://localhost:3000/api/qz/certificate'
 */
const getApiUrl = (path) => {
  let base = API_BASE_URL;
  if (base.endsWith('/')) base = base.slice(0, -1);

  // If base doesn't already end with /api, we must add it
  if (!base.endsWith('/api')) {
    return `${base}/api${path}`;
  }
  return `${base}${path}`;
};


// 1. Digital Certificate Promise
qz.security.setCertificatePromise(async () => {
  try {
    const url = getApiUrl('/qz/certificate');
    console.log(`🔐 QZ Security: Fetching certificate from ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const certificate = await response.text();
    console.log("✅ QZ Security: Certificate loaded successfully", certificate);
    return certificate;
  } catch (error) {
    console.error("❌ QZ Security: Certificate Error:", error);
    throw error;
  }
});


qz.security.setSignatureAlgorithm("SHA512");

// 2. Digital Signature Promise
qz.security.setSignaturePromise(async (toSign) => {
  try {
    const url = getApiUrl('/qz/sign');
    console.log(`✍️ QZ Security: Requesting signature from ${url}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        request: toSign
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const signature = await response.text();
    console.log("✅ QZ Security: Signature received successfully", response);
    return signature;
  } catch (error) {
    console.error("❌ QZ Security: Signature Error:", error);
    throw error;
  }
});

/**
 * QZ Tray Service for managing printer connectivity and printing.
 */
export const qzService = {
  async connect() {
    try {
      if (!qz.websocket.isActive()) {
        console.log('QZ Tray: Connecting to websocket...');
        await qz.websocket.connect();
        console.log('QZ Tray: Connected successfully.');
      }
      return true;
    } catch (error) {
      console.error('QZ Tray Connection Error:', error);
      throw error;
    }
  },

  isConnected() {
    return qz.websocket.isActive();
  },

  async printTest() {
    try {
      await this.connect();
      const config = qz.configs.create("default");
      const data = [{
        type: 'raw',
        value: 'QZ Tray Test Print\\nAtomberg Tracking System\\nConnectivity: OK\\n\\n\\n'
      }];
      await qz.print(config, data);
      console.log('QZ Tray: Test print sent.');
      return true;
    } catch (error) {
      console.error('QZ Tray Print Error:', error);
      throw error;
    }
  },

  async printBoxLabel(boxData) {
    try {
      await this.connect();
      const config = qz.configs.create("default");
      const data = [{
        type: 'raw',
        value: `--- BOX LABEL ---\\n` +
               `Box Code: ${boxData.boxCode}\\n` +
               `Model: ${boxData.model}\\n` +
               `Units: ${boxData.upb}\\n` +
               `Serials:\\n${boxData.serials.map(s => (typeof s === 'object' ? s.serial : s)).join('\\n')}\\n` +
               `-----------------\\n\\n\\n`
      }];
      await qz.print(config, data);
      return true;
    } catch (error) {
      console.error('QZ Tray Label Print Error:', error);
      throw error;
    }
  },

  async getPrinters() {
    try {
      await this.connect();
      const printers = await qz.printers.find();
      console.log("🖨️ Available Printers:", printers);
      return printers;
    } catch (error) {
      console.error("QZ Tray Printer Detection Error:", error);
      throw error;
    }
  },

  async printZPL(zpl, printerName = "ZDesigner ZT231-300dpi ZPL") {
    try {
      await this.connect();
      console.log("🖨️ Preparing ZPL print...");
      const config = qz.configs.create(printerName);
      const data = [
        {
          type: "raw",
          format: "command",
          flavor: "plain",
          data: zpl,
        },
      ];
      await qz.print(config, data);
      console.log("✅ ZPL successfully sent to printer!");
      return true;
    } catch (error) {
      console.error("🔴 ZPL Print Error:", error);
      throw error;
    }
  },
};

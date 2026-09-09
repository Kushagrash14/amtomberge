import { meta } from 'eslint-plugin-react-hooks';
import qz from 'qz-tray';


const API_BASE_URL = import.meta.env.VITE_API_URL; 

qz.security.setCertificatePromise((resolve, reject) => {

  fetch(`${API_BASE_URL}/qz/certificate`)
    .then(response => {

      if (!response.ok) {
        throw new Error("Failed to load QZ certificate");
      }

      return response.text();
    })
    .then(certificate => {
      console.log("🔐 QZ Certificate loaded");
      resolve(certificate);
    })
    .catch(error => {
      console.error("❌ QZ Certificate Error:", error);
      reject(error);

    });

});


qz.security.setSignaturePromise((toSign) => {

  return (resolve, reject) => {

    fetch(`${API_BASE_URL}/qz/sign`, {

      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        request: toSign
      })

    })
      .then(response => {

        if (!response.ok) {
          throw new Error("Failed to sign QZ request");
        }

        return response.text();

      })
      .then(signature => {

        console.log("✍️ QZ request signed by server");

        resolve(signature);

      })
      .catch(error => {

        console.error("❌ QZ Signature Error:", error);

        reject(error);

      });

  };

});


/**
 * QZ Tray Service for managing printer connectivity and printing.
 */
export const qzService = {

  /**
   * Establishes a connection to the local QZ Tray application.
   * @returns {Promise<boolean>} True if connected or already active.
   */
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

  /**
   * Checks if the QZ Tray application is currently connected.
   * @returns {boolean}
   */
  isConnected() {
    return qz.websocket.isActive();
  },

  /**
   * Sends a simple test print to the default printer.
   * Useful for verifying the setup.
   */
  async printTest() {
    try {
      await this.connect();

      // Find default printer
      const config = qz.configs.create("default");

      // Simple text data for test
      const data = [{
        type: 'raw',
        value: 'QZ Tray Test Print\nAtomberg Tracking System\nConnectivity: OK\n\n\n'
      }];

      await qz.print(config, data);
      console.log('QZ Tray: Test print sent.');
      return true;
    } catch (error) {
      console.error('QZ Tray Print Error:', error);
      throw error;
    }
  },

  /**
   * Prints a box label.
   * @param {Object} boxData - The box and item details to print.
   */
  async printBoxLabel(boxData) {
    try {
      await this.connect();
      const config = qz.configs.create("default");

      // This is a placeholder for actual label formatting.
      // We will refine the label design based on requirements.
      const data = [{
        type: 'raw',
        value: `--- BOX LABEL ---\n` +
               `Box Code: ${boxData.boxCode}\n` +
               `Model: ${boxData.model}\n` +
               `Units: ${boxData.upb}\n` +
               `Serials:\n${boxData.serials.map(s => (typeof s === 'object' ? s.serial : s)).join('\n')}\n` +
               `-----------------\n\n\n`
      }];

      await qz.print(config, data);
      return true;
    } catch (error) {
      console.error('QZ Tray Label Print Error:', error);
      throw error;
    }
  },


  /**
   * Get all printers available on this computer
   */
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


  /**
   * Send ZPL code directly to a Zebra printer
   */
  async printZPL(zpl, printerName = "ZDesigner ZT231-300dpi ZPL") {
    try {
      // Make sure QZ Tray is connected
      await this.connect();

      console.log("🖨️ Preparing ZPL print...");
      console.log("Printer:", printerName);
      console.log("ZPL:", zpl);

      // Select the exact Zebra printer
      const config = qz.configs.create(printerName);

      // Send RAW ZPL directly to printer
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

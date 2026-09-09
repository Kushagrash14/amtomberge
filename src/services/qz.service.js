import qz from "qz-tray";

/**
 * Connect Browser → Local QZ Tray
 */
export const connectQZ = async () => {
  try {
    if (qz.websocket.isActive()) {
      console.log("🟢 QZ Tray already connected");
      return true;
    }

    console.log("🟡 Connecting to QZ Tray...");

    await qz.websocket.connect();

    console.log("🟢 QZ Tray connected successfully!");

    return true;

  } catch (error) {
    console.error("🔴 Failed to connect QZ Tray:", error);
    throw error;
  }
};


/**
 * Get all printers installed on this computer
 */
export const getPrinters = async () => {
  try {
    await connectQZ();

    const printers = await qz.printers.find();

    console.log("🖨️ Available Printers:", printers);

    return printers;

  } catch (error) {
    console.error("🔴 Failed to get printers:", error);
    throw error;
  }
};


/**
 * Disconnect QZ Tray
 */
export const disconnectQZ = async () => {
  try {
    if (qz.websocket.isActive()) {
      await qz.websocket.disconnect();

      console.log("🟠 QZ Tray disconnected");
    }

  } catch (error) {
    console.error("🔴 QZ Disconnect Error:", error);
  }
};
export const generateMasterLabelZPL = ({
  model,
  description,
  size_inch,
  boxNumber,
  boxCode,
  serials = [],
  printedOn,
}) => {

  // ─────────────────────────────────────────────
  // Clean serial data
  // Supports:
  // [{ id, serial }, ...]
  // OR
  // ["SERIAL1", "SERIAL2"]
  // ─────────────────────────────────────────────

  const cleanSerials = serials.map((item) =>
    typeof item === "object" ? item.serial : item
  );


  // ─────────────────────────────────────────────
  // Date / Time
  // ─────────────────────────────────────────────

  const printDate = printedOn
    ? printedOn
    : new Date().toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).replace(",", "");


  // ─────────────────────────────────────────────
  // QR DATA
  //
  // QR contains complete box information
  // ─────────────────────────────────────────────

  const qrData = [
    `BOX:${boxCode}`,
    `MODEL:${model}`,
    `BOXNO:${boxNumber}`,
    `QTY:${cleanSerials.length}`,
    `SERIALS:${cleanSerials.join(",")}`,
  ].join("|");


  // ─────────────────────────────────────────────
  // GENERATE SERIAL BARCODES
  //
  // Each serial gets:
  //
  // |||||||||||||||||||||||
  //     SERIAL NUMBER
  // ─────────────────────────────────────────────

  let serialBarcodes = "";

  // Starting Y position
  let y = 480;

  cleanSerials.forEach((serial) => {

    serialBarcodes += `
^FO70,${y}
^BY2,2,55
^BCN,55,N,N,N
^FD${serial}^FS

^FO170,${y + 62}
^A0N,26,26
^FB500,1,0,C
^FD${serial}^FS
`;

    // Space between each barcode
    y += 105;
  });


  // ─────────────────────────────────────────────
  // Dynamic label height
  //
  // Important because different models may
  // have different Units Per Box
  // ─────────────────────────────────────────────

  const labelHeight = y + 30;


  // ─────────────────────────────────────────────
  // FINAL ZPL
  // ─────────────────────────────────────────────

  return `
^XA

^CI28

^PW800
^LL${labelHeight}

^LH0,0

^FO20,20
^GB760,${labelHeight - 40},3^FS


^FO45,45
^A0N,38,38
^FDATOMBERG^FS


^FO45,105
^A0N,30,30
^FDMODEL :^FS

^FO250,105
^A0N,32,32
^FD${model}^FS


^FO45,155
^A0N,28,28
^FDSize/Color:^FS


^FO45,195
^A0N,27,27
^FB700,2,5,L
^FD${description || ""} ${size_inch || ""}^FS


^FO300,240
^BQN,2,5
^FDLA,${qrData}^FS


^FO45,350
^A0N,28,28
^FDPrinted On :^FS

^FO270,350
^A0N,28,28
^FD${printDate}^FS


^FO45,415
^A0N,30,30
^FDScanned Numbers :^FS


${serialBarcodes}


^XZ
`;
};
/**
 * generateMasterLabelZPL
 *
 * Zebra ZT231 - 203 DPI
 * Master Box Label
 *
 * Layout:
 * ┌──────────────────────────────────────────────┐
 * │ MODEL :       FG0496                         │
 * │ Size/Color:                                  │
 * │ EXHAUST FAN BROWN 6 INCH                     │
 * │                                              │
 * │                 QR CODE                      │
 * │                                              │
 * │ Printed On :    04/09/2026 08:59             │
 * ├──────────────────────────────────────────────┤
 * │ Scanned Numbers :                            │
 * │                                              │
 * │        BARCODE                                │
 * │        SERIAL                                 │
 * │                                              │
 * │        BARCODE                                │
 * │        SERIAL                                 │
 * │                                              │
 * └──────────────────────────────────────────────┘
 */

export const generateMasterLabelZPL = ({
  model,
  description,
  size_inch,
  boxNumber,
  boxCode,
  serials = [],
  printedOn,
}) => {

  // ============================================================
  // 1. CLEAN SERIALS
  // ============================================================

  const cleanSerials = serials
    .map((item) =>
      typeof item === "object" ? item.serial : item
    )
    .filter(Boolean)
    .map(String);


  // ============================================================
  // 2. PRINT DATE
  // ============================================================

  const printDate = printedOn
    ? printedOn
    : new Date()
        .toLocaleString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
        .replace(",",            "   ");


  // ============================================================
  // 3. QR DATA
  // ============================================================

  const qrData = [
    `BOX:${boxCode}`,
    `MODEL:${model}`,
    `BOXNO:${boxNumber}`,
    `QTY:${cleanSerials.length}`,
    `SERIALS:${cleanSerials.join(",")}`,
  ].join("|");


  // ============================================================
  // 4. LABEL DIMENSIONS
  // ============================================================

  const PW = 900;

  // Outer border
  const BORDER_X = 25;
  const BORDER_Y = 35;
  const BORDER_W = 850;

  // ============================================================
  // 5. HEADER
  // ============================================================

  const MODEL_Y = 65;
  const SIZE_Y = 125;
  const DESCRIPTION_Y = 170;


  // ============================================================
  // 6. QR
  // ============================================================

  // Keep QR comfortably between description and Printed On.
  const QR_MAG = 4;

  // ^BQN automatically determines actual QR dimensions
  // based on data density. Do NOT calculate QR_SIZE manually.

  const QR_X = 350;
  const QR_Y = 150;


  // ============================================================
  // 7. PRINT DATE
  // ============================================================

  const PRINTED_LABEL_Y = 440;
  const PRINTED_VALUE_X = 265;


  // ============================================================
  // 8. DIVIDER
  // ============================================================

  const DIVIDER_Y = 485;


  // ============================================================
  // 9. SCANNED NUMBERS TITLE
  // ============================================================

  const SCANNED_TITLE_Y = 505;


  // ============================================================
  // 10. BARCODE SETTINGS
  // ============================================================

  const BARCODE_START_Y = 555;

  // Desired reference:
  // wide barcode + serial number below it

  const BARCODE_HEIGHT = 80;

  // Space occupied by each serial:
  //
  // barcode       80
  // gap             8
  // serial text    30
  // bottom gap     35
  //
  // total ≈ 153

  const BARCODE_SLOT_HEIGHT = 145;

  const BARCODE_TEXT_Y_OFFSET = 85;


  // ============================================================
  // 11. FIXED LABEL HEIGHT
  // ============================================================
  // Label is a fixed 6" tall label.
  // Printer resolution: 300 dots/inch
  // 6in * 300dpi = 1800 dots

  const DOTS_PER_INCH = 300;
  const LABEL_HEIGHT_INCHES = 6;

  const labelHeight = LABEL_HEIGHT_INCHES * DOTS_PER_INCH; // 1800

  const borderHeight =
    labelHeight - (BORDER_Y * 2);


  // ============================================================
  // 12. GENERATE SERIAL BARCODE BLOCKS
  // ============================================================

  let serialBarcodes = "";

  cleanSerials.forEach((serial, index) => {

    const barcodeY =
      BARCODE_START_Y +
      index * BARCODE_SLOT_HEIGHT;

    const textY =
      barcodeY +
      BARCODE_TEXT_Y_OFFSET;


    serialBarcodes += `
^FO128,${barcodeY}
^BY3,3,${BARCODE_HEIGHT}
^BCN,${BARCODE_HEIGHT},N,N,N
^FD${serial}^FS

^FO50,${textY}
^A0N,30,30
^FB800,1,0,C
^FD${serial}^FS
`;
  });


  // ============================================================
  // 13. FINAL ZPL
  // ============================================================

  return `
^XA

^CI28

^PW${PW}
^LL${labelHeight}

^LH0,0

^MMT
^MNY


^FX ============================================================
^FX OUTER BORDER (rounded corners)
^FX ============================================================

^FO${BORDER_X},${BORDER_Y}
^GB${BORDER_W},${borderHeight},3,B,1^FS


^FX ============================================================
^FX MODEL
^FX ============================================================

^FO50,${MODEL_Y}
^A0N,36,36
^FDMODEL :^FS

^FO285,${MODEL_Y}
^A0N,38,38
^FD${model}^FS


^FX ============================================================
^FX SIZE / COLOR
^FX ============================================================

^FO50,${SIZE_Y}
^A0N,32,32
^FDSize/Color:^FS


^FX ============================================================
^FX DESCRIPTION
^FX ============================================================

^FO50,${DESCRIPTION_Y}
^A0N,38,38
^FB800,2,0,L
^FD${(description || "").toUpperCase()} ${size_inch ? size_inch.toUpperCase() : ""}^FS


^FX ============================================================
^FX QR CODE
^FX ============================================================

^FO${QR_X},${QR_Y}
^BQN,2,${QR_MAG}
^FDLA,${qrData}^FS


^FX ============================================================
^FX PRINTED ON
^FX ============================================================

^FO50,${PRINTED_LABEL_Y}
^A0N,32,32
^FDPrinted On :^FS

^FO${PRINTED_VALUE_X},${PRINTED_LABEL_Y}
^A0N,32,32
^FD${printDate}^FS


^FX ============================================================
^FX DIVIDER
^FX ============================================================

^FO25,${DIVIDER_Y}
^GB850,2,2^FS


^FX ============================================================
^FX SCANNED NUMBERS
^FX ============================================================

^FO50,${SCANNED_TITLE_Y}
^A0N,36,36
^FDScanned Numbers :^FS


^FX ============================================================
^FX SERIAL BARCODES
^FX ============================================================

${serialBarcodes}


^XZ
`.trim();
};
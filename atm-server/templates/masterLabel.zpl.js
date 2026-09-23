/**
 * generateMasterLabelZPL
 *
 * Zebra ZT231 - 300 DPI
 * Master Box Label
 *
 * Label Size: 3.8" wide × 7.5" tall
 * @ 300 DPI = 1140 dots wide × 2250 dots tall
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
 * │        BARCODE                               │
 * │        SERIAL                                │
 * │                                              │
 * │        BARCODE                               │
 * │        SERIAL                                │
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

  const printDate = printedOn? printedOn : new Date().toLocaleString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
        .replace(",", "   ");


  // ============================================================
  // 3. QR DATA
  // ============================================================

  const getQrMagnification = (serialCount) => {
  if (serialCount <= 2)  return 6;
  if (serialCount <= 4)  return 5;
  if (serialCount <= 6)  return 5;
  if (serialCount <= 9)  return 4;
  return 2;
};

// const QR_MAG = getQrMagnification(cleanSerials.length);

  const qrData = cleanSerials.join("");


  // ============================================================
  // 4. LABEL DIMENSIONS
  // ============================================================
  // Label:  3.8" wide × 7.5" tall  @  300 DPI
  // Width:  3.8 × 300 = 1140 dots
  // Height: 7.5 × 300 = 2250 dots

  const DOTS_PER_INCH   = 300;
  const LABEL_WIDTH_IN  = 3.8;
  const LABEL_HEIGHT_IN = 7.5;

  const PW          = Math.round(LABEL_WIDTH_IN  * DOTS_PER_INCH); // 1140
  const labelHeight = Math.round(LABEL_HEIGHT_IN * DOTS_PER_INCH); // 2250

  // Outer border — 30 dot inset on all sides
  const BORDER_X   = 30;
  const BORDER_Y   = 120;
  const BORDER_W   = PW - (BORDER_X * 2);         // 1080
  const borderHeight = labelHeight - (BORDER_Y * 2); // 2170

  // Inner content left/right margin
  const L    = 100;          // left text start
  const R    = PW - 60;     // right text end
  const FB_W = R - L;       // ~1025 — field-block width for centred text


  // ============================================================
  // 5. HEADER  (top section — model / size / description)
  // ============================================================

  const MODEL_Y       = 150;   // "MODEL :"  label
  const SIZE_Y        = 240;  // "Size/Color:"
  const DESCRIPTION_Y = 320;  // description text (up to 2 lines, ~40px each → ends ~268)


  // ============================================================
  // 6. QR CODE
  // ============================================================

  // QR_MAG = 3 keeps the code compact (each module = 3 dots).
  // With typical data (~180 chars) this renders at version ~9-10:
  //   ~53 modules × 4 = ~212 dots square — comfortably small.
  const QR_MAG = getQrMagnification(cleanSerials.length);

  // Right-aligned so it doesn't overlap left-side text
  const QR_X = 480;
  const QR_Y = 280;
  // QR bottom ≈ 175 + 175 = 350  (conservative upper-bound for version 10)


  // ============================================================
  // 7. PRINT DATE
  // ============================================================

  const PRINTED_LABEL_Y = 570;
  const PRINTED_VALUE_X = 420;  // right-aligned to QR code (430 + 150 = 580)



  // ============================================================
  // 9. SCANNED NUMBERS TITLE
  // ============================================================

  const SCANNED_TITLE_Y = 700;


  // ============================================================
  // 10. BARCODE SETTINGS
  // ============================================================

  const BARCODE_START_Y = 800;  // first barcode top edge
  const BARCODE_HEIGHT  = 100;   // bar height in dots

  const BAR_TO_TEXT_GAP = 10;    // space between bottom of bars and serial text
  const TEXT_HEIGHT     = 35;   // matches ^A0N,28,28 below
  const SLOT_BOTTOM_GAP = 19;

  const BARCODE_TEXT_Y_OFFSET = BARCODE_HEIGHT + BAR_TO_TEXT_GAP;
  const BARCODE_SLOT_HEIGHT   = BARCODE_TEXT_Y_OFFSET + TEXT_HEIGHT + SLOT_BOTTOM_GAP;




  // ============================================================
  // 11. GENERATE SERIAL BARCODE BLOCKS
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
      ^FO150,${barcodeY}
      ^BY4,3,${BARCODE_HEIGHT}
      ^BCN,${BARCODE_HEIGHT},N,N,N
      ^FD${serial}^FS

      ^FO${L},${textY}
      ^A0N,38,38
      ^FB${FB_W},1,0,C
      ^FD${serial}^FS
      `;
  });


  // ============================================================
  // 12. FINAL ZPL
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
    ^FX OUTER BORDER
    ^FX ============================================================

    ^FO${BORDER_X},${BORDER_Y}
    ^GB${BORDER_W},${borderHeight},3,B,1^FS


    ^FX ============================================================
    ^FX MODEL
    ^FX ============================================================

    ^FO${L + 150},${MODEL_Y}
    ^A0N,60,60
    ^FDMODEL :^FS

    ^FO${L+470},${MODEL_Y}
    ^A0N,60,60
    ^FD${model}^FS


    ^FX ============================================================
    ^FX SIZE / COLOR
    ^FX ============================================================

    ^FO${L},${SIZE_Y}
    ^A0N,60,60
    ^FDSize/Color:^FS


    ^FX ============================================================
    ^FX DESCRIPTION
    ^FX ============================================================

    ^FO${L},${DESCRIPTION_Y}
    ^A0N,60,60
    ^FB${FB_W},2,0,L
    ^FD${(description || "").toUpperCase()} ${size_inch ? size_inch.toUpperCase() : ""}^FS


    ^FX ============================================================
    ^FX QR CODE
    ^FX ============================================================

    ^FO${QR_X},${QR_Y}
    ^BQN,5,${QR_MAG}
    ^FDLA,${qrData}^FS


    ^FX ============================================================
    ^FX PRINTED ON
    ^FX ============================================================

    ^FO${L},${PRINTED_LABEL_Y}
    ^A0N,60,60
    ^FDPrinted On :^FS

    ^FO${PRINTED_VALUE_X},${PRINTED_LABEL_Y}
    ^A0N,60,60
    ^FD${printDate}^FS


    ^FX ============================================================
    ^FX SCANNED NUMBERS
    ^FX ============================================================

    ^FO${L},${SCANNED_TITLE_Y}
    ^A0N,60,60
    ^FDScanned Numbers :^FS


    ^FX ============================================================
    ^FX SERIAL BARCODES
    ^FX ============================================================

    ${serialBarcodes}


    ^XZ
  `.trim();
};
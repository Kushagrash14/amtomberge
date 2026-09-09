import express from "express";

import {
  getCertificate,
  signMessage
} from "../controllers/qz.controller.js";

const router = express.Router();


/**
 * Public certificate endpoint
 */
router.get("/certificate", getCertificate);


/**
 * Secure signing endpoint
 */
router.post("/sign", signMessage);


export default router;
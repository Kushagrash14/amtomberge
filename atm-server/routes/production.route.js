import express from 'express';
import {
  getAllSettings, saveSetting,
  getProductionData, addSerial, getLastSerial,
  getIdleRecords, addIdleTime,
  getReloads, addReload,
  getModels, saveModel, deleteModel,
  getSerialRanges, setSerialRange,
  getManpower, setManpower,
  getUsers, addUser,
  verifyAdmin,
} from '../controllers/production.controller.js';

const router = express.Router();

// Settings
router.get('/settings',      getAllSettings);
router.post('/settings',     saveSetting);

// Production data
router.get('/data',          getProductionData);
router.post('/serial',       addSerial);
router.get('/serial/last',   getLastSerial);

// Idle
router.get('/idle',          getIdleRecords);
router.post('/idle',         addIdleTime);

// Reloads
router.get('/reloads',       getReloads);
router.post('/reload',       addReload);

// Models
router.get('/models',        getModels);
router.post('/models',       saveModel);
router.delete('/models/:name', deleteModel);

// Serial ranges
router.get('/ranges',        getSerialRanges);
router.post('/ranges',       setSerialRange);

// Manpower
router.get('/manpower',      getManpower);
router.post('/manpower',     setManpower);

// Users (admin)
router.get('/users',         getUsers);
router.post('/users',        addUser);

// Admin auth
router.post('/admin/verify', verifyAdmin);

export default router;
import express from 'express';
import {
  getAllSettings, saveSetting,
  getProductionData, addSerial, getLastSerial,
  getIdleRecords, addIdleTime,
  getReloads, addReload,
  getModels, saveModel, deleteModel,
  getSerialRanges, setSerialRange,
  getManpower, setManpower,
  getUsers, addUser, updateUser, deleteUser,
  verifyAdmin,
  getPackBoxes, savePackBox, getPackConfig, savePackConfig, deletePackConfig,
  savePackScan, deletePackScan, getOpenBox, markBoxPrinted, manualPrintBox
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
router.put('/users',         updateUser);
router.delete('/users',      deleteUser);
router.delete('/users/:email', deleteUser);

// Admin auth
router.post('/admin/verify', verifyAdmin);

router.get('/pack/boxes',          getPackBoxes);
router.post('/pack/boxes',         savePackBox);
router.get('/pack/open-box',       getOpenBox);
router.post('/pack/boxes/:id/printed', markBoxPrinted);
router.post('/pack/manual-print',  manualPrintBox);
router.post('/pack/scan',          savePackScan);
router.delete('/pack/scan/:itemId', deletePackScan);
router.get('/pack/config',  getPackConfig);
router.post('/pack/config', savePackConfig);
router.delete('/pack/config/:model', deletePackConfig);

export default router;
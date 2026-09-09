import mysql from 'mysql2/promise';
import fs from 'fs';
import { fileURLToPath } from 'url';

let pool;
let schemaReady;

const getDatabaseUrl = () => process.env.DATABASE_URL;
 console.log('Database configuration loaded');
const sanitizeMysqlUri = (rawUrl) => {
  const parsed = new URL(rawUrl);
  parsed.searchParams.delete('ssl-mode');
  parsed.searchParams.delete('ssl_mode');
  return parsed.toString();
};

const readCaCertificate = () => {
  if (process.env.SQL_CA_CERT) return process.env.SQL_CA_CERT.replace(/\\n/g, '\n');

  const configuredPath = process.env.SQL_CA_CERT_PATH;
  if (configuredPath && fs.existsSync(configuredPath)) {
    return fs.readFileSync(configuredPath, 'utf8');
  }

  const bundledPath = fileURLToPath(new URL('./aiven-ca.pem', import.meta.url));
  if (fs.existsSync(bundledPath)) {
    return fs.readFileSync(bundledPath, 'utf8');
  }

  return undefined;
};

const createPool = () => {
  const url = getDatabaseUrl().trim();
  if (!url) throw new Error('DATABASE_URL_MISSING');

  const sslRequired = /ssl[-_]?mode=required/i.test(url)
    || /ssl=required/i.test(url)
    || process.env.MYSQL_SSL === 'true';
  const ca = readCaCertificate();
  return mysql.createPool({
    uri: sanitizeMysqlUri(url),
    waitForConnections: true,
    connectionLimit: Number(process.env.SQL_CONNECTION_LIMIT || 5),
    queueLimit: 0,
    ssl: sslRequired ? { ca, rejectUnauthorized: Boolean(ca) } : undefined,
  });
};

export const getPool = () => {
  if (!pool) pool = createPool();
  return pool;
};

const ddl = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    name VARCHAR(255) NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    otp VARCHAR(16) NULL,
    expireOtpAt DATETIME NULL,
    role VARCHAR(64) NOT NULL DEFAULT 'user',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    \`key\` VARCHAR(191) NOT NULL UNIQUE,
    value TEXT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS production_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL,
    model VARCHAR(255) NOT NULL,
    serial VARCHAR(255) NOT NULL UNIQUE,
    timestamp VARCHAR(255) NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_production_date_model (date, model),
    INDEX idx_production_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS idle_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL,
    fromTime VARCHAR(64) NULL,
    toTime VARCHAR(64) NULL,
    duration DOUBLE NOT NULL DEFAULT 0,
    department VARCHAR(255) NULL,
    reason TEXT NULL,
    slot VARCHAR(64) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_idle_date (date),
    INDEX idx_idle_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS reload_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL,
    slot VARCHAR(64) NULL,
    type VARCHAR(255) NULL,
    count INT NOT NULL DEFAULT 1,
    timestamp VARCHAR(255) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_reload_date (date),
    INDEX idx_reload_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS production_models (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    customer VARCHAR(255) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS serial_ranges (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL,
    model VARCHAR(255) NOT NULL,
    \`start\` INT NOT NULL,
    \`end\` INT NOT NULL,
    expected INT NOT NULL DEFAULT 0,
    scanned INT NOT NULL DEFAULT 0,
    missing INT NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_range_date_model (date, model),
    INDEX idx_range_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS manpower (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL UNIQUE,
    manpower INT NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS pack_boxes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL,
    model VARCHAR(255) NOT NULL,
    box_number INT NOT NULL,
    units_per_box INT NOT NULL DEFAULT 12,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    master_qr TEXT NULL,
    packed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    printed_at DATETIME NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_box_date_model (date, model)
  )`,
  `CREATE TABLE IF NOT EXISTS pack_box_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    box_id BIGINT UNSIGNED NOT NULL,
    serial VARCHAR(255) NOT NULL,
    scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (box_id) REFERENCES pack_boxes(id) ON DELETE CASCADE,
    INDEX idx_item_serial (serial),
    INDEX idx_item_box (box_id)
  )`,
  `CREATE TABLE IF NOT EXISTS pack_config (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    model VARCHAR(255) NOT NULL UNIQUE,
    units_per_box INT NOT NULL DEFAULT 12,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
];

export const ensureSchema = async () => {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getPool();
      for (const statement of ddl) {
        await db.query(statement);
      }
      try {
        await db.query("ALTER TABLE users MODIFY COLUMN role VARCHAR(64) NOT NULL DEFAULT 'user'");
      } catch {}
      try {
        await db.query("ALTER TABLE pack_boxes ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'open'");
      } catch {}
      try {
        await db.query("ALTER TABLE pack_boxes DROP COLUMN serials");
      } catch {}
      try {
        await db.query("ALTER TABLE pack_boxes ADD COLUMN box_code VARCHAR(64) NULL");
      } catch {}
      try {
        await db.query("ALTER TABLE pack_config ADD COLUMN description TEXT NULL");
      } catch {}
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
};

export const connectDB = async () => {
  await ensureSchema();
  return getPool();
};

export default connectDB;
